import { DataSource } from "typeorm";
import { SagaOrchestratorService } from "../../src/saga/application/saga-orchestrator.service";
import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import {
  CompensationActionStatus,
  CompensationStatus,
  SagaStatus,
} from "../../src/saga/domain/saga.enums";
import { createOrder } from "../order/order.factory";

const runIntegration = process.env.RUN_MYSQL_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("SagaOrchestrator MySQL integration", () => {
  let dataSource: DataSource;
  let service: SagaOrchestratorService;
  let publisher: { publish: jest.Mock };
  let sagaInstanceOrmEntity: typeof import("../../src/saga/infrastructure/typeorm/saga-instance.orm-entity").SagaInstanceOrmEntity;
  let orderOrmEntity: typeof import("../../src/order/infrastructure/typeorm/order.orm-entity").OrderOrmEntity;
  let TypeOrmSagaInstanceRepositoryCtor: typeof import("../../src/saga/infrastructure/repositories/typeorm-saga-instance.repository").TypeOrmSagaInstanceRepository;
  let TypeOrmSagaLocalUnitOfWorkCtor: typeof import("../../src/saga/infrastructure/typeorm/typeorm-saga-local-unit-of-work").TypeOrmSagaLocalUnitOfWork;

  beforeAll(async () => {
    jest.resetModules();
    const [
      dataSourceModule,
      sagaRepositoryModule,
      sagaUnitOfWorkModule,
      sagaOrmModule,
      orderOrmModule,
    ] = await Promise.all([
      import("../../src/database/typeorm-cli.config"),
      import("../../src/saga/infrastructure/repositories/typeorm-saga-instance.repository"),
      import("../../src/saga/infrastructure/typeorm/typeorm-saga-local-unit-of-work"),
      import("../../src/saga/infrastructure/typeorm/saga-instance.orm-entity"),
      import("../../src/order/infrastructure/typeorm/order.orm-entity"),
    ]);
    dataSource = dataSourceModule.default;
    TypeOrmSagaInstanceRepositoryCtor =
      sagaRepositoryModule.TypeOrmSagaInstanceRepository;
    TypeOrmSagaLocalUnitOfWorkCtor =
      sagaUnitOfWorkModule.TypeOrmSagaLocalUnitOfWork;
    sagaInstanceOrmEntity = sagaOrmModule.SagaInstanceOrmEntity;
    orderOrmEntity = orderOrmModule.OrderOrmEntity;
    await dataSource.initialize();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new SagaOrchestratorService(
      new TypeOrmSagaLocalUnitOfWorkCtor(dataSource, {
        get: jest.fn().mockReturnValue(300000),
      } as never),
      { get: jest.fn().mockReturnValue(true) } as never,
      publisher,
      { subscribe: jest.fn() },
      {
        recordOrderCreated: jest.fn(),
        recordTerminalProcessingFailure: jest.fn(),
      },
    );
  });

  beforeEach(async () => {
    await dataSource.query("DELETE FROM consumed_messages");
    await dataSource.query("DELETE FROM order_history");
    await dataSource.query("DELETE FROM order_service_items");
    await dataSource.query("DELETE FROM order_part_items");
    await dataSource.query("DELETE FROM saga_instances");
    await dataSource.query("DELETE FROM orders");
    publisher.publish.mockClear();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it("persists the local happy path, histories and processed ledger entries", async () => {
    const order = createOrder({
      id: "10000000-0000-4000-8000-000000000101",
    });
    await service.createOrderWithSaga(order);
    const sagaEntity = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ orderId: order.id });

    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, sagaEntity.sagaId, order.id, "budget.created", {
      budgetId: "30000000-0000-4000-8000-000000000101",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, sagaEntity.sagaId, order.id, "budget.approved", {
      budgetId: "30000000-0000-4000-8000-000000000101",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, sagaEntity.sagaId, order.id, "payment.created", {
      paymentId: "40000000-0000-4000-8000-000000000101",
      budgetId: "30000000-0000-4000-8000-000000000101",
      status: "PENDING",
    });
    await billing(service, sagaEntity.sagaId, order.id, "payment.approved", {
      paymentId: "40000000-0000-4000-8000-000000000101",
      budgetId: "30000000-0000-4000-8000-000000000101",
      status: "APPROVED",
    });
    await workshop(service, sagaEntity.sagaId, order.id, "stock.reserved", {
      reservations: [{ partId: "part-1", quantity: 3 }],
    });
    await workshop(
      service,
      sagaEntity.sagaId,
      order.id,
      "execution.started",
      {},
    );
    await workshop(
      service,
      sagaEntity.sagaId,
      order.id,
      "execution.finished",
      {},
    );

    const persistedOrder = await dataSource
      .getRepository(orderOrmEntity)
      .findOne({
        where: { id: order.id },
        relations: { history_entries: true },
      });
    const persistedSaga = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ sagaId: sagaEntity.sagaId });
    const ledger = await dataSource.query(
      "SELECT status FROM consumed_messages WHERE consumer_name = ? ORDER BY event_id",
      ["os.billing.events"],
    );

    expect(persistedOrder?.status).toBe("FINISHED");
    expect(
      persistedOrder?.history_entries.map((entry) => entry.status).sort(),
    ).toEqual(
      [
        "RECEIVED",
        "WAITING_BUDGET_APPROVAL",
        "BUDGET_APPROVED",
        "IN_EXECUTION",
        "FINISHED",
      ].sort(),
    );
    expect(persistedSaga.status).toBe("COMPLETED");
    expect(persistedSaga.currentStep).toBe("FINISHED");
    expect(persistedSaga.paymentApprovedAt).toEqual(
      new Date("2026-01-18T12:00:00.000Z"),
    );
    expect(ledger).toEqual([
      { status: "PROCESSED" },
      { status: "PROCESSED" },
      { status: "PROCESSED" },
      { status: "PROCESSED" },
    ]);
    expect(publisher.publish).toHaveBeenCalledTimes(3);
  });

  it("rolls back the order and its relations when the real orderId uniqueness constraint rejects saga creation", async () => {
    const order = createOrder({
      id: "10000000-0000-4000-8000-000000000102",
    });
    const sagaRepository = new TypeOrmSagaInstanceRepositoryCtor(
      dataSource.getRepository(sagaInstanceOrmEntity),
    );
    const existingSaga = await sagaRepository.create(
      SagaInstance.create(order.id, "20000000-0000-4000-8000-000000000102"),
    );

    await expect(service.createOrderWithSaga(order)).rejects.toMatchObject({
      code: "SAGA_ORDER_CONFLICT",
    });

    const [orders, histories, serviceItems, partItems, sagas, ledger] =
      await Promise.all([
        dataSource.query("SELECT id FROM orders WHERE id = ?", [order.id]),
        dataSource.query(
          "SELECT order_id FROM order_history WHERE order_id = ?",
          [order.id],
        ),
        dataSource.query(
          "SELECT order_id FROM order_service_items WHERE order_id = ?",
          [order.id],
        ),
        dataSource.query(
          "SELECT order_id FROM order_part_items WHERE order_id = ?",
          [order.id],
        ),
        dataSource.query("SELECT saga_id, order_id FROM saga_instances"),
        dataSource.query("SELECT id FROM consumed_messages"),
      ]);

    expect(orders).toEqual([]);
    expect(histories).toEqual([]);
    expect(serviceItems).toEqual([]);
    expect(partItems).toEqual([]);
    expect(sagas).toEqual([
      { saga_id: existingSaga.values.sagaId, order_id: order.id },
    ]);
    expect(ledger).toEqual([]);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("persists cancel -> late payment.approved -> payment.refunded as explicit compensation", async () => {
    const order = createOrder({
      id: "10000000-0000-4000-8000-000000000103",
    });
    await service.createOrderWithSaga(order);
    const sagaEntity = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ orderId: order.id });

    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, sagaEntity.sagaId, order.id, "budget.created", {
      budgetId: "30000000-0000-4000-8000-000000000103",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, sagaEntity.sagaId, order.id, "budget.approved", {
      budgetId: "30000000-0000-4000-8000-000000000103",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, sagaEntity.sagaId, order.id, "payment.created", {
      paymentId: "40000000-0000-4000-8000-000000000103",
      budgetId: "30000000-0000-4000-8000-000000000103",
      status: "PENDING",
    });
    publisher.publish.mockClear();

    await service.cancelOrder(order.id, "customer cancellation");
    await billing(service, sagaEntity.sagaId, order.id, "payment.approved", {
      paymentId: "40000000-0000-4000-8000-000000000103",
      budgetId: "30000000-0000-4000-8000-000000000103",
      status: "APPROVED",
    });

    let persistedSaga = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ sagaId: sagaEntity.sagaId });
    const refundCommand = persistedSaga.paymentRefundCommand as {
      eventId: string;
      correlationId: string;
    };

    expect(persistedSaga.status).toBe(SagaStatus.COMPENSATING);
    expect(refundCommand.eventId).toBeTruthy();
    expect(publisher.publish).toHaveBeenCalledWith(
      "orders.topic",
      "payment.refund.requested",
      expect.objectContaining({
        eventId: refundCommand.eventId,
        correlationId: refundCommand.correlationId,
      }),
    );

    await billingWithMessage(service, {
      eventId: "payment.refunded-integration-001",
      eventName: "payment.refunded",
      eventVersion: 1,
      occurredAt: "2026-01-18T12:05:00.000Z",
      correlationId: refundCommand.correlationId,
      causationId: refundCommand.eventId,
      sagaId: sagaEntity.sagaId,
      orderId: order.id,
      payload: {
        paymentId: "40000000-0000-4000-8000-000000000103",
        budgetId: "30000000-0000-4000-8000-000000000103",
        status: "REFUNDED",
        providerPaymentId: "provider-payment-103",
        providerRefundId: "provider-refund-103",
      },
    });

    const persistedOrder = await dataSource
      .getRepository(orderOrmEntity)
      .findOne({
        where: { id: order.id },
        relations: { history_entries: true },
      });
    persistedSaga = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ sagaId: sagaEntity.sagaId });

    expect(persistedOrder?.status).toBe("CANCELLED");
    expect(
      persistedOrder?.history_entries.filter(
        (entry) => entry.status === "CANCELLED",
      ),
    ).toHaveLength(1);
    expect(persistedSaga.status).toBe(SagaStatus.COMPENSATED);
    expect(persistedSaga.compensationStatus).toBe(CompensationStatus.COMPLETED);
    expect(persistedSaga.paymentRefundStatus).toBe(
      CompensationActionStatus.COMPLETED,
    );
    expect(
      (persistedSaga.paymentRefundResult as { eventName?: string })?.eventName,
    ).toBe("payment.refunded");
  });

  it("persists cancel with pending stock result and moves to manual intervention after stock.release.failed", async () => {
    const order = createOrder({
      id: "10000000-0000-4000-8000-000000000104",
    });
    await service.createOrderWithSaga(order);
    const sagaEntity = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ orderId: order.id });

    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, sagaEntity.sagaId, order.id, "budget.created", {
      budgetId: "30000000-0000-4000-8000-000000000104",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, sagaEntity.sagaId, order.id, "budget.approved", {
      budgetId: "30000000-0000-4000-8000-000000000104",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, sagaEntity.sagaId, order.id, "payment.created", {
      paymentId: "40000000-0000-4000-8000-000000000104",
      budgetId: "30000000-0000-4000-8000-000000000104",
      status: "PENDING",
    });
    await billing(service, sagaEntity.sagaId, order.id, "payment.approved", {
      paymentId: "40000000-0000-4000-8000-000000000104",
      budgetId: "30000000-0000-4000-8000-000000000104",
      status: "APPROVED",
    });
    publisher.publish.mockClear();

    await service.cancelOrder(order.id, "cancel while reserve pending");
    await workshop(service, sagaEntity.sagaId, order.id, "stock.reserved", {
      reservations: [{ partId: "part-1", quantity: 3 }],
    });

    let persistedSaga = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ sagaId: sagaEntity.sagaId });
    const releaseCommand = persistedSaga.stockReleaseCommand as {
      eventId: string;
      correlationId: string;
    };
    expect(persistedSaga.stockReleaseStatus).toBe(
      CompensationActionStatus.REQUESTED,
    );

    await workshopWithMessage(service, {
      eventId: "stock.release.failed-integration-001",
      eventName: "stock.release.failed",
      eventVersion: 1,
      occurredAt: "2026-01-18T12:06:00.000Z",
      correlationId: releaseCommand.correlationId,
      causationId: releaseCommand.eventId,
      sagaId: sagaEntity.sagaId,
      orderId: order.id,
      payload: {
        reservations: [
          {
            partId: "part-1",
            quantity: 3,
            status: "FAILED",
            failureCode: "STOCK_RESERVATION_ALREADY_COMMITTED",
          },
        ],
      },
    });

    const persistedOrder = await dataSource
      .getRepository(orderOrmEntity)
      .findOne({
        where: { id: order.id },
        relations: { history_entries: true },
      });
    persistedSaga = await dataSource
      .getRepository(sagaInstanceOrmEntity)
      .findOneByOrFail({ sagaId: sagaEntity.sagaId });

    expect(persistedOrder?.status).toBe("CANCELLED");
    expect(
      persistedOrder?.history_entries.filter(
        (entry: { status: string }) => entry.status === "CANCELLED",
      ),
    ).toHaveLength(1);
    expect(persistedSaga.status).toBe(SagaStatus.MANUAL_INTERVENTION_REQUIRED);
    expect(persistedSaga.compensationStatus).toBe(CompensationStatus.FAILED);
    expect(persistedSaga.stockReleaseStatus).toBe(
      CompensationActionStatus.FAILED,
    );
    expect(persistedSaga.paymentRefundCommand).toBeNull();
  });
});

function message(
  sagaId: string,
  orderId: string,
  eventName: string,
  payload: unknown,
) {
  return {
    eventId: `${eventName}-integration-001`,
    eventName,
    eventVersion: 1,
    occurredAt: "2026-01-18T12:00:00.000Z",
    correlationId: "correlation-integration-001",
    causationId: "causation-integration-001",
    sagaId,
    orderId,
    payload,
  };
}

function billing(
  service: SagaOrchestratorService,
  sagaId: string,
  orderId: string,
  eventName: string,
  payload: unknown,
) {
  return (
    service as never as {
      handleBillingEvent: (value: unknown) => Promise<void>;
    }
  ).handleBillingEvent(message(sagaId, orderId, eventName, payload));
}

function billingWithMessage(
  service: SagaOrchestratorService,
  payload: ReturnType<typeof message>,
) {
  return (
    service as never as {
      handleBillingEvent: (value: unknown) => Promise<void>;
    }
  ).handleBillingEvent(payload);
}

function workshop(
  service: SagaOrchestratorService,
  sagaId: string,
  orderId: string,
  eventName: string,
  payload: unknown,
) {
  return (
    service as never as {
      handleWorkshopEvent: (value: unknown) => Promise<void>;
    }
  ).handleWorkshopEvent(message(sagaId, orderId, eventName, payload));
}

function workshopWithMessage(
  service: SagaOrchestratorService,
  payload: ReturnType<typeof message>,
) {
  return (
    service as never as {
      handleWorkshopEvent: (value: unknown) => Promise<void>;
    }
  ).handleWorkshopEvent(payload);
}
