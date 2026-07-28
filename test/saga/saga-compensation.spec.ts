import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import {
  CompensationActionStatus,
  CompensationStatus,
  SagaStatus,
  SagaStep,
} from "../../src/saga/domain/saga.enums";
import {
  CompensationTrigger,
  PersistedCompensationResult,
  PersistedStockReleaseCommand,
} from "../../src/saga/domain/saga-compensation";

const approvalAt = new Date("2026-07-20T12:00:00.000Z");
const commandAt = new Date("2026-07-20T12:01:00.000Z");
const resultAt = new Date("2026-07-20T12:02:00.000Z");

describe("SagaInstance compensation", () => {
  it("starts with independent actions not required", () => {
    expect(SagaInstance.create("order-001", "saga-001").values).toEqual(
      expect.objectContaining({
        paymentApprovedAt: null,
        compensationTrigger: null,
        stockReleaseStatus: CompensationActionStatus.NOT_REQUIRED,
        paymentRefundStatus: CompensationActionStatus.NOT_REQUIRED,
      }),
    );
  });

  it("records the first payment approval idempotently and rejects conflicts", () => {
    const saga = approvedPaymentSaga();
    const changedAt = saga.values.updatedAt;
    saga.recordPaymentApproved(new Date(approvalAt));
    expect(saga.values.updatedAt).toEqual(changedAt);
    expect(saga.values.paymentApprovedAt).toEqual(approvalAt);
    expect(() =>
      saga.recordPaymentApproved(new Date("2026-07-20T12:00:01.000Z")),
    ).toThrow("cannot be replaced");
    expect(() =>
      SagaInstance.create("order-002").recordPaymentApproved(approvalAt),
    ).toThrow("Payment must be recorded");
    expect(() => saga.recordPaymentApproved(new Date("invalid"))).toThrow(
      "valid timestamp",
    );
  });

  it("plans no compensation when no compensable resource exists", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.planCompensation(trigger());
    expect(saga.values).toEqual(
      expect.objectContaining({
        status: SagaStatus.FAILED,
        compensationStatus: CompensationStatus.NOT_REQUIRED,
        stockReleaseStatus: CompensationActionStatus.NOT_REQUIRED,
        paymentRefundStatus: CompensationActionStatus.NOT_REQUIRED,
      }),
    );
    expect(saga.nextCompensationAction()).toBe("NONE");
    expect(saga.values.completedAt).toBeNull();
  });

  it("plans and completes stock release as the only action", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setReservedParts([{ partId: "part-001", quantity: 2 }]);
    saga.planCompensation(trigger());
    expect(saga.nextCompensationAction()).toBe("STOCK_RELEASE");

    const command = saga.prepareStockReleaseCommand(commandAt);
    expect(command).toEqual(
      expect.objectContaining({
        eventName: "stock.release.requested",
        occurredAt: commandAt,
        causationId: "failure-event-001",
        payload: {
          reservations: [{ partId: "part-001", quantity: 2 }],
        },
      }),
    );
    expect(saga.values.status).toBe(SagaStatus.COMPENSATING);
    expect(saga.nextCompensationAction()).toBe("NONE");

    saga.recordStockReleased(successResult("stock.released", command.eventId));
    expect(saga.nextCompensationAction()).toBe("COMPLETE");
    saga.completeCompensation(resultAt);
    expect(saga.values).toEqual(
      expect.objectContaining({
        status: SagaStatus.COMPENSATED,
        compensationStatus: CompensationStatus.COMPLETED,
        completedAt: resultAt,
      }),
    );
  });

  it("plans refund only for an explicitly approved payment", () => {
    const unapproved = SagaInstance.create("order-001", "saga-001");
    unapproved.setPaymentId("payment-001");
    unapproved.planCompensation(trigger());
    expect(unapproved.values.paymentRefundStatus).toBe(
      CompensationActionStatus.NOT_REQUIRED,
    );

    const approved = approvedPaymentSaga();
    approved.planCompensation(trigger());
    expect(approved.nextCompensationAction()).toBe("PAYMENT_REFUND");
    const command = approved.preparePaymentRefundCommand(commandAt);
    expect(command.payload).toEqual({
      paymentId: "payment-001",
      reason: "stock reservation failed",
    });
  });

  it("enforces release before refund and completes only after both results", () => {
    const saga = approvedPaymentSaga();
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    saga.planCompensation(trigger());
    expect(() => saga.preparePaymentRefundCommand(commandAt)).toThrow(
      "Stock release must complete",
    );

    const release = saga.prepareStockReleaseCommand(commandAt);
    saga.recordStockReleased(successResult("stock.released", release.eventId));
    expect(saga.nextCompensationAction()).toBe("PAYMENT_REFUND");
    const refund = saga.preparePaymentRefundCommand(
      new Date("2026-07-20T12:03:00.000Z"),
    );
    expect(refund.causationId).toBe(saga.values.stockReleaseResult?.eventId);
    saga.recordPaymentRefunded(
      successResult("payment.refunded", refund.eventId),
    );
    expect(saga.nextCompensationAction()).toBe("COMPLETE");
    saga.completeCompensation(new Date("2026-07-20T12:04:00.000Z"));
    expect(saga.values.status).toBe(SagaStatus.COMPENSATED);
  });

  it.each([
    ["stock.release.failed", "stock"],
    ["payment.refund.failed", "payment"],
  ] as const)(
    "moves %s to manual intervention without completing compensation",
    (eventName, action) => {
      const saga = approvedPaymentSaga();
      if (action === "stock") {
        saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
      }
      saga.planCompensation(trigger());
      const command =
        action === "stock"
          ? saga.prepareStockReleaseCommand(commandAt)
          : saga.preparePaymentRefundCommand(commandAt);
      const result = failedResult(eventName, command.eventId);
      if (action === "stock") saga.recordStockReleaseFailed(result);
      else saga.recordPaymentRefundFailed(result);

      expect(saga.values).toEqual(
        expect.objectContaining({
          status: SagaStatus.MANUAL_INTERVENTION_REQUIRED,
          compensationStatus: CompensationStatus.FAILED,
          compensationFailureCode: "COMPENSATION_REJECTED",
          completedAt: null,
        }),
      );
      expect(saga.nextCompensationAction()).toBe("NONE");
      expect(() => saga.completeCompensation()).toThrow("Only a compensating");
    },
  );

  it("keeps trigger, commands and results immutable and idempotent", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    const firstTrigger = trigger();
    saga.planCompensation(firstTrigger);
    saga.planCompensation({
      ...firstTrigger,
      occurredAt: new Date(firstTrigger.occurredAt),
    });
    expect(() =>
      saga.planCompensation({ ...firstTrigger, eventId: "other-event" }),
    ).toThrow("cannot be replaced");
    expect(saga.values.compensationTrigger?.reason).toBe(
      "stock reservation failed",
    );

    const command = saga.prepareStockReleaseCommand(commandAt);
    const commandRetry = saga.prepareStockReleaseCommand(
      new Date("2027-01-01T00:00:00.000Z"),
    );
    expect(commandRetry).toEqual(command);
    commandRetry.payload.reservations[0].quantity = 999;
    expect(saga.values.stockReleaseCommand).toEqual(command);

    const result = successResult("stock.released", command.eventId);
    saga.recordStockReleased(result);
    saga.recordStockReleased({ ...result, occurredAt: new Date(resultAt) });
    expect(() =>
      saga.recordStockReleased({ ...result, eventId: "other-result" }),
    ).toThrow("cannot be replaced");

    const conflicting = SagaInstance.restore({
      ...saga.values,
      stockReleaseCommand: {
        ...(saga.values.stockReleaseCommand as PersistedStockReleaseCommand),
        payload: {
          reservations: [{ partId: "part-001", quantity: 99 }],
        },
      },
    });
    expect(() => conflicting.prepareStockReleaseCommand()).toThrow(
      "conflicts with saga state",
    );
  });

  it("reconstructs the same deterministic command from equivalent persisted state", () => {
    const first = SagaInstance.create("order-001", "saga-001");
    first.setReservedParts([
      { partId: "part-002", quantity: 2 },
      { partId: "part-001", quantity: 1 },
    ]);
    first.planCompensation(trigger());
    const firstCommand = first.prepareStockReleaseCommand(commandAt);

    const restored = SagaInstance.restore({
      ...first.values,
      stockReleaseCommand: null,
      stockReleaseStatus: CompensationActionStatus.PENDING,
      compensationStartedAt: null,
      status: SagaStatus.FAILED,
      compensationStatus: CompensationStatus.PENDING,
    });
    const restoredCommand = restored.prepareStockReleaseCommand(commandAt);

    expect(restoredCommand).toEqual(firstCommand);
    expect(restoredCommand.payload.reservations).toEqual([
      { partId: "part-002", quantity: 2 },
      { partId: "part-001", quantity: 1 },
    ]);
  });

  it("rejects out-of-order and causally incompatible results", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    saga.planCompensation(trigger());
    expect(() =>
      saga.recordStockReleased(successResult("stock.released", "missing")),
    ).toThrow("not persisted");
    const command = saga.prepareStockReleaseCommand(commandAt);
    expect(() =>
      saga.recordStockReleased(successResult("stock.released", "wrong")),
    ).toThrow("does not match");
    expect(() =>
      saga.recordStockReleased({
        ...successResult("stock.released", command.eventId),
        failureCode: "INVALID",
      }),
    ).toThrow("cannot contain");
  });

  it("supports empty and partial reservation snapshots but rejects replacement", () => {
    const empty = SagaInstance.create("order-001", "saga-001");
    empty.recordReservedParts([]);
    expect(empty.values.reservedParts).toEqual([]);

    const partial = SagaInstance.create("order-002", "saga-002");
    partial.recordReservedParts([{ partId: "part-001", quantity: 1 }]);
    expect(() =>
      partial.recordReservedParts([{ partId: "part-002", quantity: 1 }]),
    ).toThrow("cannot be replaced");
    expect(() =>
      partial.recordReservedParts([
        { partId: "part-001", quantity: 1 },
        { partId: "part-001", quantity: 1 },
      ]),
    ).toThrow("unique");
  });

  it("allows direct cancellation without approved resources and requires planning otherwise", () => {
    const unapproved = SagaInstance.create("order-001", "saga-001");
    unapproved.setPaymentId("payment-001");
    unapproved.cancel();
    expect(unapproved.values.status).toBe(SagaStatus.CANCELLED);

    const approved = approvedPaymentSaga("order-002", "saga-002");
    expect(() => approved.cancel()).toThrow("require compensation");
    approved.planCompensation({
      ...trigger(),
      eventName: "order.cancelled",
      failedStep: approved.values.currentStep,
      reason: "customer cancellation",
    });
    expect(approved.nextCompensationAction()).toBe("PAYMENT_REFUND");

    const reserved = SagaInstance.create("order-003", "saga-003");
    reserved.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    expect(() => reserved.cancel()).toThrow("require compensation");
  });

  it("blocks late happy-path mutations and terminal resurrection", () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.planCompensation(trigger());
    expect(() => saga.transitionTo(SagaStep.BUDGET_REQUESTED)).toThrow(
      "cannot transition",
    );
    expect(() => saga.setBudgetId("budget-001")).toThrow(
      "cannot return to happy path",
    );

    const cancelled = SagaInstance.create("order-002", "saga-002");
    cancelled.cancel();
    expect(() => cancelled.setPaymentId("payment-001")).toThrow(
      "cannot return to happy path",
    );
  });

  it("keeps a late payment approval idempotent after cancellation and rejects invalid contexts", () => {
    const saga = waitingPaymentSaga("order-010", "saga-010", "payment-010");
    saga.cancelWithCompensationTrigger(
      {
        ...trigger(),
        eventName: "order.cancelled",
        failedStep: SagaStep.WAITING_PAYMENT,
        reason: "customer cancellation",
      },
      false,
    );

    saga.recordPaymentApprovedAfterCancellation(approvalAt);
    expect(saga.values.paymentApprovedAt).toEqual(approvalAt);
    expect(saga.nextCompensationAction()).toBe("PAYMENT_REFUND");
    expect(() =>
      saga.recordPaymentApprovedAfterCancellation(new Date(approvalAt)),
    ).toThrow("only valid for a cancelled saga");

    const invalidStatus = SagaInstance.create("order-011", "saga-011");
    invalidStatus.setPaymentId("payment-011");
    expect(() =>
      invalidStatus.recordPaymentApprovedAfterCancellation(approvalAt),
    ).toThrow("only valid for a cancelled saga");

    const invalidStep = SagaInstance.restore({
      ...waitingPaymentSaga("order-012", "saga-012", "payment-012").values,
      status: SagaStatus.CANCELLED,
      currentStep: SagaStep.STOCK_RESERVED,
    });
    expect(() =>
      invalidStep.recordPaymentApprovedAfterCancellation(approvalAt),
    ).toThrow("only valid while waiting for payment");
  });

  it("resolves the waiting resource confirmation window after cancellation", () => {
    const saga = waitingPaymentSaga("order-020", "saga-020", "payment-020");
    saga.recordPaymentApproved(approvalAt);
    saga.transitionTo(SagaStep.STOCK_RESERVATION_REQUESTED);
    saga.cancelWithCompensationTrigger(
      {
        ...trigger(),
        eventName: "order.cancelled",
        failedStep: SagaStep.STOCK_RESERVATION_REQUESTED,
        reason: "customer cancellation",
      },
      true,
    );

    expect(saga.nextCompensationAction()).toBe("NONE");
    saga.recordReservationOutcomeAfterCancellation([]);
    expect(saga.values.stockReleaseStatus).toBe(
      CompensationActionStatus.NOT_REQUIRED,
    );
    expect(saga.nextCompensationAction()).toBe("PAYMENT_REFUND");

    const reserved = waitingPaymentSaga("order-021", "saga-021", "payment-021");
    reserved.recordPaymentApproved(approvalAt);
    reserved.transitionTo(SagaStep.STOCK_RESERVATION_REQUESTED);
    reserved.cancelWithCompensationTrigger(
      {
        ...trigger(),
        eventName: "order.cancelled",
        failedStep: SagaStep.STOCK_RESERVATION_REQUESTED,
        reason: "customer cancellation",
      },
      true,
    );
    reserved.recordReservationOutcomeAfterCancellation([
      { partId: "part-001", quantity: 1 },
    ]);
    expect(reserved.values.stockReleaseStatus).toBe(
      CompensationActionStatus.PENDING,
    );
    expect(reserved.nextCompensationAction()).toBe("STOCK_RELEASE");
    expect(() =>
      reserved.recordReservationOutcomeAfterCancellation([]),
    ).toThrow("not pending for compensation");
  });

  it("keeps requested compensation commands immutable and ordered", () => {
    const saga = approvedPaymentSaga("order-030", "saga-030");
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    saga.planCompensation(trigger());
    const release = saga.prepareStockReleaseCommand(commandAt);

    expect(saga.nextCompensationAction()).toBe("NONE");
    expect(() => saga.preparePaymentRefundCommand(commandAt)).toThrow(
      "Stock release must complete",
    );
    expect(
      saga.prepareStockReleaseCommand(new Date("2027-01-01T00:00:00.000Z")),
    ).toEqual(release);
  });

  it("treats duplicated persisted results as no-op and rejects conflicting causal snapshots", () => {
    const saga = approvedPaymentSaga("order-040", "saga-040");
    saga.setReservedParts([{ partId: "part-001", quantity: 1 }]);
    saga.planCompensation(trigger());
    const release = saga.prepareStockReleaseCommand(commandAt);
    const released = {
      ...successResult("stock.released", release.eventId),
      sagaId: "saga-040",
      orderId: "order-040",
    };
    saga.recordStockReleased(released);
    saga.recordStockReleased({
      ...released,
      occurredAt: new Date(released.occurredAt),
    });

    expect(() =>
      saga.recordStockReleased({
        ...released,
        correlationId: "different-correlation",
      }),
    ).toThrow("does not match");
  });

  it("allows terminal no-op helpers only in their explicit terminal states", () => {
    const manual = approvedPaymentSaga("order-050", "saga-050");
    manual.planCompensation(trigger());
    const refund = manual.preparePaymentRefundCommand(commandAt);
    manual.recordPaymentRefundFailed({
      ...failedResult("payment.refund.failed", refund.eventId),
      sagaId: "saga-050",
      orderId: "order-050",
    });
    manual.failCompensation();
    manual.markManualInterventionRequired();

    const compensating = approvedPaymentSaga("order-051", "saga-051");
    compensating.planCompensation(trigger());
    compensating.preparePaymentRefundCommand(commandAt);
    compensating.startCompensating();
    expect(compensating.values.status).toBe(SagaStatus.COMPENSATING);
  });
});

function approvedPaymentSaga(
  orderId = "order-001",
  sagaId = "saga-001",
): SagaInstance {
  const saga = waitingPaymentSaga(orderId, sagaId);
  saga.recordPaymentApproved(approvalAt);
  return saga;
}

function waitingPaymentSaga(
  orderId = "order-001",
  sagaId = "saga-001",
  paymentId = "payment-001",
): SagaInstance {
  const saga = SagaInstance.create(orderId, sagaId);
  saga.transitionTo(SagaStep.BUDGET_REQUESTED);
  saga.setBudgetId("budget-001");
  saga.transitionTo(SagaStep.WAITING_BUDGET_APPROVAL);
  saga.transitionTo(SagaStep.WAITING_PAYMENT);
  saga.setPaymentId(paymentId);
  return saga;
}

function trigger(): CompensationTrigger {
  return {
    eventId: "failure-event-001",
    eventName: "stock.reservation.failed",
    occurredAt: new Date("2026-07-20T12:00:30.000Z"),
    correlationId: "correlation-001",
    causationId: "stock-command-001",
    failedStep: SagaStep.STOCK_RESERVATION_REQUESTED,
    reason: " stock\u0000 reservation   failed ",
  };
}

function successResult(
  eventName: "stock.released" | "payment.refunded",
  causationId: string,
): PersistedCompensationResult {
  const payload =
    eventName === "stock.released"
      ? {
          reservations: [
            { partId: "part-001", quantity: 1, status: "RELEASED" },
          ],
        }
      : {
          paymentId: "payment-001",
          budgetId: "budget-001",
          status: "REFUNDED",
          providerPaymentId: "provider-payment-001",
          providerRefundId: "provider-refund-001",
        };
  return {
    eventId: `${eventName}-001`,
    eventName,
    eventVersion: 1,
    occurredAt: new Date(resultAt),
    correlationId: "correlation-001",
    causationId,
    sagaId: "saga-001",
    orderId: "order-001",
    payload,
  };
}

function failedResult(
  eventName: "stock.release.failed" | "payment.refund.failed",
  causationId: string,
): PersistedCompensationResult {
  const payload =
    eventName === "stock.release.failed"
      ? {
          reservations: [
            {
              partId: "part-001",
              quantity: 1,
              status: "FAILED",
              failureCode: "COMPENSATION_REJECTED",
            },
          ],
        }
      : {
          paymentId: "payment-001",
          budgetId: "budget-001",
          status: "REFUND_FAILED",
          providerPaymentId: "provider-payment-001",
          failureCode: "COMPENSATION_REJECTED",
        };
  return {
    eventId: `${eventName}-001`,
    eventName,
    eventVersion: 1,
    occurredAt: new Date(resultAt),
    correlationId: "correlation-001",
    causationId,
    sagaId: "saga-001",
    orderId: "order-001",
    payload,
    failureCode: "COMPENSATION_REJECTED",
  };
}
