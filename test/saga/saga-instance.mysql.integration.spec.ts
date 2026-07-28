import { DataSource } from "typeorm";
import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import {
  CompensationActionStatus,
  CompensationStatus,
  SagaStatus,
  SagaStep,
} from "../../src/saga/domain/saga.enums";

const runIntegration = process.env.RUN_MYSQL_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("SagaInstance MySQL integration", () => {
  let dataSource: DataSource;
  let repository: {
    create: (saga: SagaInstance) => Promise<SagaInstance>;
    findById: (sagaId: string) => Promise<SagaInstance | null>;
    findByOrderId: (orderId: string) => Promise<SagaInstance | null>;
    save: (
      saga: SagaInstance,
      expectedVersion: number,
    ) => Promise<SagaInstance>;
  };
  let sagaInstanceOrmEntity: typeof import("../../src/saga/infrastructure/typeorm/saga-instance.orm-entity").SagaInstanceOrmEntity;
  let TypeOrmSagaInstanceRepositoryCtor: typeof import("../../src/saga/infrastructure/repositories/typeorm-saga-instance.repository").TypeOrmSagaInstanceRepository;

  beforeAll(async () => {
    jest.resetModules();
    const [dataSourceModule, repositoryModule, ormModule] = await Promise.all([
      import("../../src/database/typeorm-cli.config"),
      import("../../src/saga/infrastructure/repositories/typeorm-saga-instance.repository"),
      import("../../src/saga/infrastructure/typeorm/saga-instance.orm-entity"),
    ]);
    dataSource = dataSourceModule.default;
    TypeOrmSagaInstanceRepositoryCtor =
      repositoryModule.TypeOrmSagaInstanceRepository;
    sagaInstanceOrmEntity = ormModule.SagaInstanceOrmEntity;
    await dataSource.initialize();
    repository = new TypeOrmSagaInstanceRepositoryCtor(
      dataSource.getRepository(sagaInstanceOrmEntity),
    );
  });

  beforeEach(async () => {
    await dataSource.query("DELETE FROM saga_instances");
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it("persists JSON, enforces local keys and rejects stale compare-and-swap", async () => {
    const initial = SagaInstance.create(
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
    );
    initial.setBudgetId("30000000-0000-4000-8000-000000000001");
    initial.setReservedParts([{ partId: "part-001", quantity: 2 }]);
    const created = await repository.create(initial);
    expect(created.values.version).toBe(1);
    expect(created.values.reservedParts).toEqual([
      { partId: "part-001", quantity: 2 },
    ]);

    await expect(
      repository.create(
        SagaInstance.create(
          "10000000-0000-4000-8000-000000000002",
          "20000000-0000-4000-8000-000000000001",
        ),
      ),
    ).rejects.toMatchObject({ code: "SAGA_ID_CONFLICT" });
    await expect(
      repository.create(
        SagaInstance.create(
          "10000000-0000-4000-8000-000000000001",
          "20000000-0000-4000-8000-000000000002",
        ),
      ),
    ).rejects.toMatchObject({ code: "SAGA_ORDER_CONFLICT" });

    const firstCopy = await repository.findById(created.values.sagaId);
    const secondCopy = await repository.findById(created.values.sagaId);
    if (!firstCopy || !secondCopy)
      throw new Error("Persisted saga was not found.");

    firstCopy.setPaymentId("40000000-0000-4000-8000-000000000001");
    const firstSaved = await repository.save(firstCopy, 1);
    expect(firstSaved.values.version).toBe(2);

    secondCopy.markFailed(secondCopy.values.currentStep, "stale worker");
    await expect(repository.save(secondCopy, 1)).rejects.toMatchObject({
      code: "SAGA_CONCURRENCY_CONFLICT",
      message: expect.stringContaining(created.values.sagaId),
    });

    const persisted = await repository.findById(created.values.sagaId);
    expect(persisted?.values).toEqual(
      expect.objectContaining({
        version: 2,
        paymentId: "40000000-0000-4000-8000-000000000001",
        failedStep: null,
        reservedParts: [{ partId: "part-001", quantity: 2 }],
      }),
    );

    await dataSource.destroy();
    jest.resetModules();
    const [reconnectModule, repositoryModule, ormModule] = await Promise.all([
      import("../../src/database/typeorm-cli.config"),
      import("../../src/saga/infrastructure/repositories/typeorm-saga-instance.repository"),
      import("../../src/saga/infrastructure/typeorm/saga-instance.orm-entity"),
    ]);
    dataSource = reconnectModule.default;
    TypeOrmSagaInstanceRepositoryCtor =
      repositoryModule.TypeOrmSagaInstanceRepository;
    sagaInstanceOrmEntity = ormModule.SagaInstanceOrmEntity;
    await dataSource.initialize();
    repository = new TypeOrmSagaInstanceRepositoryCtor(
      dataSource.getRepository(sagaInstanceOrmEntity),
    );
    expect(await repository.findByOrderId(created.values.orderId)).toEqual(
      expect.objectContaining({
        values: expect.objectContaining({ version: 2 }),
      }),
    );
  });

  it("persists and reloads complete compensation snapshots and timestamps", async () => {
    const saga = SagaInstance.create(
      "10000000-0000-4000-8000-000000000010",
      "20000000-0000-4000-8000-000000000010",
    );
    saga.setPaymentId("40000000-0000-4000-8000-000000000010");
    saga.recordPaymentApproved(new Date("2026-07-20T10:00:00.123Z"));
    saga.setReservedParts([{ partId: "part-001", quantity: 2 }]);
    saga.planCompensation({
      eventId: "failure-event-010",
      eventName: "execution.failed",
      occurredAt: new Date("2026-07-20T10:01:00.123Z"),
      correlationId: "correlation-010",
      causationId: "execution-command-010",
      failedStep: SagaStep.IN_EXECUTION,
      reason: "execution failed",
    });
    const release = saga.prepareStockReleaseCommand(
      new Date("2026-07-20T10:02:00.123Z"),
    );
    saga.recordStockReleased({
      eventId: "stock-result-010",
      eventName: "stock.released",
      eventVersion: 1,
      occurredAt: new Date("2026-07-20T10:03:00.123Z"),
      correlationId: "correlation-010",
      causationId: release.eventId,
      sagaId: "20000000-0000-4000-8000-000000000010",
      orderId: "10000000-0000-4000-8000-000000000010",
      payload: {
        reservations: [{ partId: "part-001", quantity: 2, status: "RELEASED" }],
      },
    });
    const refund = saga.preparePaymentRefundCommand(
      new Date("2026-07-20T10:04:00.123Z"),
    );
    saga.recordPaymentRefunded({
      eventId: "payment-result-010",
      eventName: "payment.refunded",
      eventVersion: 1,
      occurredAt: new Date("2026-07-20T10:05:00.123Z"),
      correlationId: "correlation-010",
      causationId: refund.eventId,
      sagaId: "20000000-0000-4000-8000-000000000010",
      orderId: "10000000-0000-4000-8000-000000000010",
      payload: {
        paymentId: "40000000-0000-4000-8000-000000000010",
        budgetId: null,
        status: "REFUNDED",
      },
    });
    saga.completeCompensation(new Date("2026-07-20T10:06:00.123Z"));

    const created = await repository.create(saga);
    expect(created.values).toEqual(
      expect.objectContaining({
        status: SagaStatus.COMPENSATED,
        compensationStatus: CompensationStatus.COMPLETED,
        stockReleaseStatus: CompensationActionStatus.COMPLETED,
        paymentRefundStatus: CompensationActionStatus.COMPLETED,
        paymentApprovedAt: new Date("2026-07-20T10:00:00.123Z"),
        completedAt: new Date("2026-07-20T10:06:00.123Z"),
      }),
    );
    expect(created.values.stockReleaseCommand).toEqual(release);
    expect(created.values.paymentRefundCommand).toEqual(refund);
    expect(created.values.stockReleaseResult?.eventId).toBe("stock-result-010");
    expect(created.values.paymentRefundResult?.eventId).toBe(
      "payment-result-010",
    );

    await dataSource.destroy();
    jest.resetModules();
    const [reconnectModule, repositoryModule, ormModule] = await Promise.all([
      import("../../src/database/typeorm-cli.config"),
      import("../../src/saga/infrastructure/repositories/typeorm-saga-instance.repository"),
      import("../../src/saga/infrastructure/typeorm/saga-instance.orm-entity"),
    ]);
    dataSource = reconnectModule.default;
    TypeOrmSagaInstanceRepositoryCtor =
      repositoryModule.TypeOrmSagaInstanceRepository;
    sagaInstanceOrmEntity = ormModule.SagaInstanceOrmEntity;
    await dataSource.initialize();
    repository = new TypeOrmSagaInstanceRepositoryCtor(
      dataSource.getRepository(sagaInstanceOrmEntity),
    );
    const reloaded = await repository.findById(created.values.sagaId);
    expect(reloaded?.values.stockReleaseCommand).toEqual(release);
    expect(reloaded?.values.paymentRefundCommand).toEqual(refund);
    expect(reloaded?.values.status).toBe(SagaStatus.COMPENSATED);
  });

  it("keeps the winning compensation command under real optimistic concurrency", async () => {
    const initial = SagaInstance.create(
      "10000000-0000-4000-8000-000000000020",
      "20000000-0000-4000-8000-000000000020",
    );
    initial.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    const created = await repository.create(initial);
    const first = await repository.findById(created.values.sagaId);
    const second = await repository.findById(created.values.sagaId);
    if (!first || !second) throw new Error("Saga copies were not loaded.");

    first.planCompensation({
      eventId: "failure-event-winner",
      eventName: "execution.failed",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
      correlationId: "correlation-winner",
      causationId: "execution-command-winner",
      failedStep: SagaStep.IN_EXECUTION,
      reason: "first worker",
    });
    const winningCommand = first.prepareStockReleaseCommand(
      new Date("2026-07-20T11:01:00.000Z"),
    );

    second.planCompensation({
      eventId: "failure-event-stale",
      eventName: "execution.failed",
      occurredAt: new Date("2026-07-20T11:00:01.000Z"),
      correlationId: "correlation-stale",
      causationId: "execution-command-stale",
      failedStep: SagaStep.IN_EXECUTION,
      reason: "stale worker",
    });
    second.prepareStockReleaseCommand(new Date("2026-07-20T11:01:01.000Z"));

    const winner = await repository.save(first, 1);
    expect(winner.values.version).toBe(2);
    await expect(repository.save(second, 1)).rejects.toMatchObject({
      code: "SAGA_CONCURRENCY_CONFLICT",
      message: expect.stringContaining(created.values.sagaId),
    });
    const persisted = await repository.findById(created.values.sagaId);
    expect(persisted?.values.version).toBe(2);
    expect(persisted?.values.stockReleaseCommand).toEqual(winningCommand);
    expect(persisted?.values.compensationTrigger?.eventId).toBe(
      "failure-event-winner",
    );
  });

  it("rolls back saga compensation persistence with the local transaction", async () => {
    const sagaId = "20000000-0000-4000-8000-000000000030";
    await expect(
      dataSource.transaction(async (manager) => {
        const transactionalRepository = new TypeOrmSagaInstanceRepositoryCtor(
          manager.getRepository(sagaInstanceOrmEntity),
        );
        const saga = SagaInstance.create(
          "10000000-0000-4000-8000-000000000030",
          sagaId,
        );
        saga.planCompensation({
          eventId: "failure-event-030",
          eventName: "stock.reservation.failed",
          occurredAt: new Date("2026-07-20T12:00:00.000Z"),
          correlationId: "correlation-030",
          causationId: "stock-command-030",
          failedStep: SagaStep.STOCK_RESERVATION_REQUESTED,
          reason: "no stock reserved",
        });
        await transactionalRepository.create(saga);
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    expect(await repository.findById(sagaId)).toBeNull();
  });
});
