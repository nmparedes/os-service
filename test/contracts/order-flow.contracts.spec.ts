import type {
  BudgetRequestedMessage,
  PaymentRefundFailedMessage,
  PaymentRefundRequestedMessage,
  StockReservedMessage,
  StockReleaseFailedMessage,
  StockReleasedMessage,
} from "../../src/contracts/order-flow.contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Order flow contracts", () => {
  it("keeps published budget requests versioned and correlated", () => {
    const message: BudgetRequestedMessage = {
      eventId: "event-001",
      eventName: "budget.requested",
      eventVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
      correlationId: "correlation-001",
      causationId: "cause-001",
      sagaId: "saga-001",
      orderId: "order-001",
      payload: {
        orderNumber: "OS-001",
        customer: {
          customerId: "customer-001",
          customerDocument: "52998224725",
          customerName: "Customer",
        },
        serviceItems: [],
        partItems: [],
      },
    };

    expect(message.eventName).toBe("budget.requested");
    expect(message.payload.customer.customerId).toBe("customer-001");
  });

  it("keeps consumed stock events correlated to the same order flow", () => {
    const message: StockReservedMessage = {
      eventId: "event-002",
      eventName: "stock.reserved",
      eventVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
      correlationId: "correlation-001",
      causationId: "event-001",
      sagaId: "saga-001",
      orderId: "order-001",
      payload: { reservations: [{ partId: "part-001", quantity: 1 }] },
    };

    expect(message.causationId).toBe("event-001");
    expect(message.payload.reservations).toHaveLength(1);
  });

  it("defines compensation commands and results with the shared v1 envelope", () => {
    const refundRequest: PaymentRefundRequestedMessage = {
      eventId: "event-003",
      eventName: "payment.refund.requested",
      eventVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
      correlationId: "correlation-001",
      causationId: "event-002",
      sagaId: "saga-001",
      orderId: "order-001",
      payload: { paymentId: "payment-001", reason: "EXECUTION_FAILED" },
    };
    const refundFailure: PaymentRefundFailedMessage = {
      ...refundRequest,
      eventId: "event-004",
      eventName: "payment.refund.failed",
      payload: {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "REFUND_FAILED",
        failureCode: "PROVIDER_UNAVAILABLE",
      },
    };
    const released: StockReleasedMessage = {
      ...refundRequest,
      eventId: "event-005",
      eventName: "stock.released",
      payload: {
        reservations: [{ partId: "part-001", quantity: 1, status: "RELEASED" }],
      },
    };
    const releaseFailure: StockReleaseFailedMessage = {
      ...released,
      eventId: "event-006",
      eventName: "stock.release.failed",
      payload: {
        reservations: [
          {
            partId: "part-001",
            quantity: 1,
            status: "FAILED",
            failureCode: "PART_NOT_FOUND",
          },
        ],
      },
    };

    expect(refundRequest.payload.reason).toBe("EXECUTION_FAILED");
    expect(refundFailure.payload.status).toBe("REFUND_FAILED");
    expect(released.payload.reservations[0].status).toBe("RELEASED");
    expect(releaseFailure.payload.reservations[0].failureCode).toBe(
      "PART_NOT_FOUND",
    );
  });

  it("keeps the local compensation contract declarations structurally aligned", () => {
    const billingContracts = readFileSync(
      join(
        process.cwd(),
        "../billing-service/src/contracts/order-flow.contracts.ts",
      ),
      "utf8",
    );
    const workshopContracts = readFileSync(
      join(
        process.cwd(),
        "../workshop-service/src/contracts/order-flow.contracts.ts",
      ),
      "utf8",
    );

    for (const declaration of [
      "interface PaymentRefundRequestPayload",
      "payment.refund.requested",
      "interface PaymentRefundedPayload",
      "payment.refunded",
      "interface PaymentRefundFailedPayload",
      "payment.refund.failed",
    ]) {
      expect(billingContracts).toContain(declaration);
    }
    for (const declaration of [
      "interface StockReleasedPayload",
      "stock.released",
      "interface StockReleaseFailedPayload",
      "stock.release.failed",
    ]) {
      expect(workshopContracts).toContain(declaration);
    }
  });
});
