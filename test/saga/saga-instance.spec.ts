import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import {
  CompensationStatus,
  SagaStatus,
  SagaStep,
} from "../../src/saga/domain/saga.enums";

describe("SagaInstance", () => {
  it("creates and restores the order preparation state", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    expect(saga.values.currentStep).toBe(SagaStep.ORDER_PREPARATION);
    expect(SagaInstance.restore(saga.values).values.sagaId).toBe("saga-001");
  });

  it("allows each forward step once and rejects jumps or terminal regressions", () => {
    const saga = SagaInstance.create("order-001");
    saga.transitionTo(SagaStep.BUDGET_REQUESTED);
    saga.transitionTo(SagaStep.BUDGET_REQUESTED);
    expect(saga.values.completedSteps).toEqual([SagaStep.ORDER_PREPARATION]);
    expect(() => saga.transitionTo(SagaStep.STOCK_RESERVED)).toThrow(
      "exactly once",
    );
    saga.transitionTo(SagaStep.WAITING_BUDGET_APPROVAL);
    saga.transitionTo(SagaStep.WAITING_PAYMENT);
    saga.transitionTo(SagaStep.STOCK_RESERVATION_REQUESTED);
    saga.transitionTo(SagaStep.STOCK_RESERVED);
    saga.transitionTo(SagaStep.EXECUTION_REQUESTED);
    saga.transitionTo(SagaStep.IN_EXECUTION);
    saga.transitionTo(SagaStep.FINISHED);
    saga.markCompleted();
    expect(saga.values.status).toBe(SagaStatus.COMPLETED);
    expect(() => saga.transitionTo(SagaStep.IN_EXECUTION)).toThrow("terminal");
  });

  it("records idempotent failure and terminal timestamps", () => {
    const saga = SagaInstance.create("order-001");
    saga.markFailed(SagaStep.ORDER_PREPARATION, "validation failed");
    saga.markFailed(SagaStep.ORDER_PREPARATION, "validation failed");
    expect(saga.values.status).toBe(SagaStatus.FAILED);
    expect(saga.values.failedAt).toBeInstanceOf(Date);
    expect(() => saga.startCompensating()).toThrow("command is required");
    expect(() => saga.markCompensated()).toThrow("Only a compensating");
  });

  it("rejects completion and failure transitions outside their valid lifecycle", () => {
    const incomplete = SagaInstance.create("order-010", "saga-010");
    expect(() => incomplete.markCompleted()).toThrow("finished active saga");

    const completed = SagaInstance.create("order-011", "saga-011");
    completed.transitionTo(SagaStep.BUDGET_REQUESTED);
    completed.transitionTo(SagaStep.WAITING_BUDGET_APPROVAL);
    completed.transitionTo(SagaStep.WAITING_PAYMENT);
    completed.transitionTo(SagaStep.STOCK_RESERVATION_REQUESTED);
    completed.transitionTo(SagaStep.STOCK_RESERVED);
    completed.transitionTo(SagaStep.EXECUTION_REQUESTED);
    completed.transitionTo(SagaStep.IN_EXECUTION);
    completed.transitionTo(SagaStep.FINISHED);
    completed.markCompleted();
    expect(() => completed.markFailed(SagaStep.FINISHED, "too late")).toThrow(
      "terminal",
    );
  });

  it("guards identifiers, reservations and externally mutable values", () => {
    expect(() => SagaInstance.create("   ", "saga-001")).toThrow("identifier");
    const saga = SagaInstance.create(" order-001 ", " saga-001 ");
    const parts = [{ partId: " part-001 ", quantity: 2 }];

    saga.setBudgetId(" budget-001 ");
    saga.setPaymentId(" payment-001 ");
    saga.setReservedParts(parts);
    parts[0].quantity = 999;
    const firstValues = saga.values;
    firstValues.reservedParts[0].quantity = 1000;
    firstValues.updatedAt.setFullYear(2000);

    expect(saga.values).toEqual(
      expect.objectContaining({
        orderId: "order-001",
        sagaId: "saga-001",
        budgetId: "budget-001",
        paymentId: "payment-001",
        reservedParts: [{ partId: "part-001", quantity: 2 }],
      }),
    );
    expect(() =>
      saga.setReservedParts([
        { partId: "part-001", quantity: 1 },
        { partId: "part-001", quantity: 1 },
      ]),
    ).toThrow("unique");
    expect(() =>
      saga.setReservedParts([{ partId: "part-002", quantity: 1.5 }]),
    ).toThrow("positive");
  });

  it("does not update timestamps for idempotent mutations", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setBudgetId("budget-001");
    const changedAt = saga.values.updatedAt;
    jest.setSystemTime(new Date("2026-01-01T11:00:00.000Z"));
    saga.setBudgetId("budget-001");
    expect(saga.values.updatedAt).toEqual(changedAt);
    jest.useRealTimers();
  });

  it("requires compensation instead of terminal cancellation when resources exist", () => {
    const directCancellation = SagaInstance.create("order-001", "saga-001");
    directCancellation.cancel();
    expect(directCancellation.values.status).toBe(SagaStatus.CANCELLED);

    const compensatingSaga = SagaInstance.create("order-002", "saga-002");
    compensatingSaga.setPaymentId("payment-001");
    compensatingSaga.recordPaymentApproved(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(() => compensatingSaga.cancel()).toThrow("require compensation");
    compensatingSaga.planCompensation(
      compensationTrigger(SagaStep.WAITING_PAYMENT),
    );
    expect(compensatingSaga.nextCompensationAction()).toBe("PAYMENT_REFUND");
  });

  it("keeps compensation operations idempotent and rejects incompatible calls", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    expect(() => saga.scheduleCompensation()).toThrow(
      "persisted business trigger",
    );
    saga.markFailed(SagaStep.ORDER_PREPARATION, "validation failed");
    saga.planCompensation(compensationTrigger(SagaStep.ORDER_PREPARATION));
    expect(() => saga.scheduleCompensation()).toThrow(
      "persisted business trigger",
    );
    expect(saga.values.compensationStatus).toBe(
      CompensationStatus.NOT_REQUIRED,
    );
    expect(() => saga.startCompensating()).toThrow("command is required");
    expect(() => saga.markManualInterventionRequired()).toThrow(
      "failed compensation result",
    );
    expect(() => saga.markCompensated()).toThrow("Only a compensating");
  });

  it("rejects planning compensation from compensating or terminal states", () => {
    const compensating = SagaInstance.create("order-020", "saga-020");
    compensating.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    compensating.planCompensation(
      compensationTrigger(SagaStep.ORDER_PREPARATION),
    );
    compensating.prepareStockReleaseCommand();
    expect(() =>
      compensating.planCompensation({
        ...compensationTrigger(SagaStep.ORDER_PREPARATION),
        eventId: "other-trigger",
      }),
    ).toThrow("cannot be replaced");

    const terminal = SagaInstance.create("order-021", "saga-021");
    terminal.cancel();
    expect(() =>
      terminal.planCompensation(
        compensationTrigger(SagaStep.ORDER_PREPARATION),
      ),
    ).toThrow("cannot be planned again");
  });

  it("keeps repeated cancellation planning idempotent and blocks terminal cancellation", () => {
    const cancelled = SagaInstance.create("order-030", "saga-030");
    const trigger = compensationTrigger(SagaStep.ORDER_PREPARATION);
    cancelled.cancelWithCompensationTrigger(trigger);
    cancelled.cancelWithCompensationTrigger({ ...trigger });
    expect(cancelled.values.status).toBe(SagaStatus.CANCELLED);

    const completed = SagaInstance.create("order-031", "saga-031");
    completed.transitionTo(SagaStep.BUDGET_REQUESTED);
    completed.transitionTo(SagaStep.WAITING_BUDGET_APPROVAL);
    completed.transitionTo(SagaStep.WAITING_PAYMENT);
    completed.transitionTo(SagaStep.STOCK_RESERVATION_REQUESTED);
    completed.transitionTo(SagaStep.STOCK_RESERVED);
    completed.transitionTo(SagaStep.EXECUTION_REQUESTED);
    completed.transitionTo(SagaStep.IN_EXECUTION);
    completed.transitionTo(SagaStep.FINISHED);
    completed.markCompleted();
    expect(() => completed.cancelWithCompensationTrigger(trigger)).toThrow(
      "cannot cancel",
    );
  });

  it("rejects conflicting identifiers and preserves no-op transitions", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setBudgetId("budget-001");
    saga.setPaymentId("payment-001");
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    expect(() => saga.setBudgetId("budget-002")).toThrow("cannot be replaced");
    expect(() => saga.setPaymentId("payment-002")).toThrow(
      "cannot be replaced",
    );
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    expect(saga.values.reservedParts).toEqual([
      { partId: "part-001", quantity: 1 },
    ]);
  });

  it("handles every compensation terminal state explicitly", () => {
    const completed = SagaInstance.create("order-001", "saga-001");
    completed.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    completed.planCompensation(compensationTrigger(SagaStep.ORDER_PREPARATION));
    const release = completed.prepareStockReleaseCommand();
    completed.startCompensating();
    completed.recordStockReleased({
      eventId: "release-result-001",
      eventName: "stock.released",
      eventVersion: 1,
      occurredAt: new Date(),
      correlationId: "correlation-001",
      causationId: release.eventId,
      sagaId: "saga-001",
      orderId: "order-001",
      payload: {
        reservations: [{ partId: "part-001", quantity: 1, status: "RELEASED" }],
      },
    });
    completed.markCompensated();
    expect(completed.values.status).toBe(SagaStatus.COMPENSATED);

    const failed = SagaInstance.create("order-002", "saga-002");
    expect(() => failed.failCompensation()).toThrow("result is required");
    expect(() => failed.markManualInterventionRequired()).toThrow(
      "failed compensation result",
    );
    failed.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    failed.planCompensation(compensationTrigger(SagaStep.ORDER_PREPARATION));
    const failedRelease = failed.prepareStockReleaseCommand();
    failed.recordStockReleaseFailed({
      eventId: "release-result-002",
      eventName: "stock.release.failed",
      eventVersion: 1,
      occurredAt: new Date(),
      correlationId: "correlation-001",
      causationId: failedRelease.eventId,
      sagaId: "saga-002",
      orderId: "order-002",
      payload: {
        reservations: [
          {
            partId: "part-001",
            quantity: 1,
            status: "FAILED",
            failureCode: "RELEASE_FAILED",
          },
        ],
      },
      failureCode: "RELEASE_FAILED",
    });
    failed.failCompensation();
    failed.markManualInterventionRequired();
  });

  it("restores defensively and rejects invalid failures and reservations", () => {
    const restored = SagaInstance.restore({
      ...SagaInstance.create("order-001", "saga-001").values,
      completedAt: new Date("2026-01-01T00:00:00.000Z"),
      failedAt: new Date("2026-01-02T00:00:00.000Z"),
      reservedParts: [{ partId: "part-001", quantity: 1 }],
    });
    const values = restored.values;
    const completedAt = values.completedAt?.getTime();
    const failedAt = values.failedAt?.getTime();
    values.completedAt?.setFullYear(2000);
    values.failedAt?.setFullYear(2000);
    expect(restored.values.completedAt?.getTime()).toBe(completedAt);
    expect(restored.values.failedAt?.getTime()).toBe(failedAt);
    expect(() => restored.markFailed(SagaStep.ORDER_PREPARATION, " ")).toThrow(
      "Failure reason",
    );
    expect(() => restored.setReservedParts([])).toThrow("positive");
    expect(() =>
      restored.setReservedParts([{ partId: " ", quantity: 1 }]),
    ).toThrow("positive");
  });

  it("persists immutable command context for a reached step", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    expect(() => saga.commandContext(SagaStep.BUDGET_REQUESTED)).toThrow(
      "not persisted",
    );
    expect(() => saga.stepTimestamp(SagaStep.BUDGET_REQUESTED)).toThrow(
      "not been reached",
    );
    saga.transitionTo(SagaStep.BUDGET_REQUESTED);
    saga.recordCommandContext(
      SagaStep.BUDGET_REQUESTED,
      "correlation-001",
      "causation-001",
    );
    saga.recordCommandContext(
      SagaStep.BUDGET_REQUESTED,
      "correlation-001",
      "causation-001",
    );
    expect(saga.commandContext(SagaStep.BUDGET_REQUESTED)).toEqual({
      correlationId: "correlation-001",
      causationId: "causation-001",
    });
    expect(() =>
      saga.recordCommandContext(
        SagaStep.BUDGET_REQUESTED,
        "correlation-002",
        "causation-001",
      ),
    ).toThrow("cannot be replaced");
  });
});

function compensationTrigger(failedStep: SagaStep) {
  return {
    eventId: "failure-event-001",
    eventName: "operation.failed",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    correlationId: "correlation-001",
    causationId: "causation-001",
    failedStep,
    reason: "operation failed",
  };
}
