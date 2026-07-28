import { SagaStep } from "./saga.enums";

export interface CompensationTrigger {
  eventId: string;
  eventName: string;
  occurredAt: Date;
  correlationId: string;
  causationId: string;
  failedStep: SagaStep;
  reason: string;
}

export interface StockReleaseCommandPayload {
  reservations: Array<{
    partId: string;
    quantity: number;
  }>;
}

export interface PaymentRefundCommandPayload {
  paymentId: string;
  reason: string;
}

export interface PersistedCompensationCommand<TPayload = unknown> {
  eventId: string;
  eventName: "stock.release.requested" | "payment.refund.requested";
  eventVersion: 1;
  occurredAt: Date;
  correlationId: string;
  causationId: string;
  sagaId: string;
  orderId: string;
  payload: TPayload;
}

export type PersistedStockReleaseCommand =
  PersistedCompensationCommand<StockReleaseCommandPayload>;

export type PersistedPaymentRefundCommand =
  PersistedCompensationCommand<PaymentRefundCommandPayload>;

export interface PersistedCompensationResult {
  eventId: string;
  eventName:
    | "stock.released"
    | "stock.release.failed"
    | "payment.refunded"
    | "payment.refund.failed";
  eventVersion: 1;
  occurredAt: Date;
  correlationId: string;
  causationId: string;
  sagaId: string;
  orderId: string;
  payload: unknown;
  failureCode?: string;
}
