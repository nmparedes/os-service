import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import {
  CompensationActionStatus,
  CompensationStatus,
  SagaStatus,
  SagaStep,
} from "../../src/saga/domain/saga.enums";
import { SagaInstanceMapper } from "../../src/saga/infrastructure/mappers/saga-instance.mapper";

describe("SagaInstanceMapper", () => {
  it("maps domain values to independent ORM values", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setReservedParts([{ partId: "part-001", quantity: 2 }]);

    const orm = SagaInstanceMapper.toOrm(saga.values);
    orm.reservedParts[0].quantity = 99;
    orm.createdAt.setFullYear(2000);

    expect(saga.values.reservedParts).toEqual([
      { partId: "part-001", quantity: 2 },
    ]);
    expect(saga.values.createdAt.getFullYear()).not.toBe(2000);
  });

  it("maps ORM values, nullable values, JSON fields and version to domain", () => {
    const createdAt = new Date("2026-02-01T10:00:00.000Z");
    const orm = SagaInstanceMapper.toOrm({
      sagaId: "saga-001",
      orderId: "order-001",
      status: SagaStatus.FAILED,
      currentStep: SagaStep.WAITING_PAYMENT,
      completedSteps: [SagaStep.ORDER_PREPARATION],
      budgetId: null,
      paymentId: null,
      reservedParts: [{ partId: "part-001", quantity: 1 }],
      failedStep: SagaStep.WAITING_PAYMENT,
      failureReason: "provider unavailable",
      compensationStatus: CompensationStatus.PENDING,
      stockReleaseStatus: CompensationActionStatus.PENDING,
      paymentRefundStatus: CompensationActionStatus.NOT_REQUIRED,
      version: 7,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      failedAt: null,
    });

    const saga = SagaInstanceMapper.toDomain(orm);
    const values = saga.values;
    values.completedSteps.push(SagaStep.BUDGET_REQUESTED);
    values.reservedParts[0].quantity = 9;
    values.createdAt.setFullYear(2000);

    expect(saga.values).toEqual(
      expect.objectContaining({
        budgetId: null,
        paymentId: null,
        version: 7,
        completedSteps: [SagaStep.ORDER_PREPARATION],
        reservedParts: [{ partId: "part-001", quantity: 1 }],
      }),
    );
    expect(saga.values.createdAt).toEqual(createdAt);
  });

  it("round-trips compensation snapshots and keeps both sides independent", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setPaymentId("payment-001");
    saga.recordPaymentApproved(new Date("2026-07-20T10:00:00.000Z"));
    saga.setReservedParts([{ partId: "part-001", quantity: 2 }]);
    saga.planCompensation({
      eventId: "failure-event-001",
      eventName: "execution.failed",
      occurredAt: new Date("2026-07-20T10:01:00.000Z"),
      correlationId: "correlation-001",
      causationId: "execution-command-001",
      failedStep: SagaStep.IN_EXECUTION,
      reason: "execution failed",
    });
    const release = saga.prepareStockReleaseCommand(
      new Date("2026-07-20T10:02:00.000Z"),
    );
    saga.recordStockReleased({
      eventId: "stock-result-001",
      eventName: "stock.released",
      eventVersion: 1,
      occurredAt: new Date("2026-07-20T10:03:00.000Z"),
      correlationId: "correlation-001",
      causationId: release.eventId,
      sagaId: "saga-001",
      orderId: "order-001",
      payload: {
        reservations: [{ partId: "part-001", quantity: 2, status: "RELEASED" }],
      },
    });
    saga.preparePaymentRefundCommand(new Date("2026-07-20T10:04:00.000Z"));

    const orm = SagaInstanceMapper.toOrm(saga.values);
    const restored = SagaInstanceMapper.toDomain(orm);
    const restoredValues = restored.values;
    expect(restoredValues).toEqual(
      expect.objectContaining({
        paymentApprovedAt: new Date("2026-07-20T10:00:00.000Z"),
        stockReleaseStatus: CompensationActionStatus.COMPLETED,
        paymentRefundStatus: CompensationActionStatus.REQUESTED,
        compensationStatus: CompensationStatus.IN_PROGRESS,
      }),
    );
    expect(restoredValues.compensationTrigger?.occurredAt).toEqual(
      new Date("2026-07-20T10:01:00.000Z"),
    );
    expect(restoredValues.stockReleaseCommand).toEqual(release);
    expect(restoredValues.paymentRefundCommand?.payload).toEqual({
      paymentId: "payment-001",
      reason: "execution failed",
    });

    const ormTrigger = orm.compensationTrigger as { eventId: string };
    ormTrigger.eventId = "mutated";
    const command = restoredValues.stockReleaseCommand;
    if (command) command.payload.reservations[0].quantity = 999;
    restoredValues.paymentApprovedAt?.setFullYear(2000);
    expect(restored.values.compensationTrigger?.eventId).toBe(
      "failure-event-001",
    );
    expect(
      restored.values.stockReleaseCommand?.payload.reservations[0].quantity,
    ).toBe(2);
    expect(restored.values.paymentApprovedAt?.getUTCFullYear()).toBe(2026);
  });

  it("round-trips a failed compensation result and nullable command fields", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    saga.planCompensation({
      eventId: "failure-event-002",
      eventName: "execution.failed",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
      correlationId: "correlation-002",
      causationId: "execution-command-002",
      failedStep: SagaStep.IN_EXECUTION,
      reason: "execution failed",
    });
    const command = saga.prepareStockReleaseCommand(
      new Date("2026-07-20T11:01:00.000Z"),
    );
    saga.recordStockReleaseFailed({
      eventId: "stock-failure-002",
      eventName: "stock.release.failed",
      eventVersion: 1,
      occurredAt: new Date("2026-07-20T11:02:00.000Z"),
      correlationId: "correlation-002",
      causationId: command.eventId,
      sagaId: "saga-001",
      orderId: "order-001",
      payload: {
        reservations: [
          {
            partId: "part-001",
            quantity: 1,
            status: "FAILED",
            failureCode: "PART_RELEASE_FAILED",
          },
        ],
      },
      failureCode: "PART_RELEASE_FAILED",
    });

    const restored = SagaInstanceMapper.toDomain(
      SagaInstanceMapper.toOrm(saga.values),
    );
    expect(restored.values).toEqual(
      expect.objectContaining({
        status: SagaStatus.MANUAL_INTERVENTION_REQUIRED,
        compensationStatus: CompensationStatus.FAILED,
        stockReleaseStatus: CompensationActionStatus.FAILED,
        paymentRefundCommand: null,
        paymentRefundResult: null,
        compensationFailureCode: "PART_RELEASE_FAILED",
      }),
    );
    expect(restored.values.stockReleaseResult).toEqual(
      expect.objectContaining({
        eventName: "stock.release.failed",
        failureCode: "PART_RELEASE_FAILED",
      }),
    );
  });
});
