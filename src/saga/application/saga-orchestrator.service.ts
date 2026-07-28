import { createHash } from "node:crypto";
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApplicationMessage,
  MESSAGE_CONSUMER,
  MESSAGE_PUBLISHER,
  MessageConsumer,
  MessagePublisher,
} from "./ports/message-broker";
import {
  BudgetRequestPayload,
  BudgetStatePayload,
  PaymentRefundFailedPayload,
  PaymentRefundedPayload,
  PaymentStatePayload,
  StockReleaseFailedPayload,
  StockReleasedPayload,
  StockReservationRequestPayload,
  StockReservationStatePayload,
} from "../../contracts/order-flow.contracts";
import { Order } from "../../order/domain/entities/order.entity";
import { OrderStatus } from "../../order/domain/enums/order-status.enum";
import { DomainException } from "../../common/exceptions/domain.exception";
import { SagaInstance, ReservedPart } from "../domain/saga-instance.entity";
import {
  CompensationActionStatus,
  SagaStatus,
  SagaStep,
} from "../domain/saga.enums";
import {
  CompensationTrigger,
  PersistedCompensationCommand,
  PersistedCompensationResult,
} from "../domain/saga-compensation";
import {
  SAGA_LOCAL_UNIT_OF_WORK,
  SagaLocalRepositories,
  SagaLocalUnitOfWork,
} from "./ports/saga-local-unit-of-work";
import {
  ORDER_FLOW_METRICS,
  type OrderFlowMetrics,
} from "./ports/order-flow-metrics.port";

const BILLING_CONSUMER = "os.billing.events";
const WORKSHOP_CONSUMER = "os.workshop.events";

type SupportedBillingEvent =
  | "budget.created"
  | "budget.approved"
  | "budget.rejected"
  | "payment.created"
  | "payment.approved"
  | "payment.failed"
  | "payment.refunded"
  | "payment.refund.failed";

type SupportedWorkshopEvent =
  | "stock.reserved"
  | "stock.reservation.failed"
  | "stock.released"
  | "stock.release.failed"
  | "execution.started"
  | "execution.finished"
  | "execution.failed";

type PublishedCommand =
  | {
      exchange: "orders.topic";
      routingKey:
        "budget.requested" | "stock.reserve.requested" | "execution.requested";
      message: ApplicationMessage;
    }
  | {
      exchange: "orders.topic";
      routingKey: "stock.release.requested" | "payment.refund.requested";
      message: PersistedCompensationCommand;
    };

@Injectable()
export class SagaOrchestratorService implements OnModuleInit {
  constructor(
    @Inject(SAGA_LOCAL_UNIT_OF_WORK)
    private readonly unitOfWork: SagaLocalUnitOfWork,
    private readonly configService: ConfigService,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    @Inject(MESSAGE_CONSUMER) private readonly consumer: MessageConsumer,
    @Inject(ORDER_FLOW_METRICS)
    private readonly orderFlowMetrics: OrderFlowMetrics,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.messagingEnabled()) return;
    await this.consumer.subscribe(BILLING_CONSUMER, (message) =>
      this.handleBillingEvent(message),
    );
    await this.consumer.subscribe(WORKSHOP_CONSUMER, (message) =>
      this.handleWorkshopEvent(message),
    );
  }

  async createOrderWithSaga(order: Order): Promise<Order> {
    return this.unitOfWork.execute(async ({ orders, sagas }) => {
      const savedOrder = await orders.save(order);
      await sagas.create(SagaInstance.create(savedOrder.id));
      return savedOrder;
    });
  }

  async requestBudget(order: Order): Promise<void> {
    const command = await this.unitOfWork.execute(async ({ orders, sagas }) => {
      const persisted = await sagas.findByOrderId(order.id);
      if (!persisted) {
        throw new DomainException("SAGA_NOT_FOUND", "Saga was not found.");
      }
      if (persisted.values.currentStep === SagaStep.ORDER_PREPARATION) {
        persisted.transitionTo(SagaStep.BUDGET_REQUESTED);
        persisted.recordCommandContext(
          SagaStep.BUDGET_REQUESTED,
          persisted.values.sagaId,
          persisted.values.sagaId,
        );
        const savedOrder = await orders.save(order);
        const savedSaga = await sagas.save(persisted, persisted.values.version);
        return this.buildBudgetRequestedCommand(savedSaga, savedOrder);
      }
      if (persisted.values.currentStep !== SagaStep.BUDGET_REQUESTED) {
        throw new DomainException(
          "SAGA_INVALID_STEP",
          "Budget request is not available.",
        );
      }
      return this.buildBudgetRequestedCommand(persisted, order);
    });
    await this.publishCommand(command);
  }

  async retryBudgetRequest(orderId: string): Promise<void> {
    const command = await this.unitOfWork.execute(async ({ orders, sagas }) => {
      const [order, saga] = await Promise.all([
        orders.findById(orderId),
        sagas.findByOrderId(orderId),
      ]);
      if (!order || !saga) {
        throw new DomainException("SAGA_NOT_FOUND", "Saga was not found.");
      }
      if (saga.values.currentStep !== SagaStep.BUDGET_REQUESTED) {
        throw new DomainException(
          "SAGA_INVALID_STEP",
          "Budget request is not pending.",
        );
      }
      return this.buildBudgetRequestedCommand(saga, order);
    });
    await this.publishCommand(command);
  }

  async cancelOrder(orderId: string, reason?: string): Promise<Order> {
    const occurredAt = new Date();
    const { order, command } = await this.unitOfWork.execute(
      async ({ orders, sagas }) => {
        const order = await this.requiredOrder(orders, orderId);
        const saga = await this.requiredSagaByOrderId(sagas, orderId);
        const trigger = this.cancellationTrigger(saga, reason, occurredAt);
        const command = this.applyCancellation(
          order,
          saga,
          trigger,
          occurredAt,
        );
        const savedOrder = await orders.save(order);
        const savedSaga = await sagas.save(saga, saga.values.version);
        return {
          order: savedOrder,
          command: command ?? this.pendingCompensationCommand(savedSaga),
        };
      },
    );
    if (command) {
      await this.publishCommand(command);
    }
    return order;
  }

  private async handleBillingEvent(message: ApplicationMessage): Promise<void> {
    this.validateEnvelope(message, [
      "budget.created",
      "budget.approved",
      "budget.rejected",
      "payment.created",
      "payment.approved",
      "payment.failed",
      "payment.refunded",
      "payment.refund.failed",
    ]);
    await this.processClaimedMessage(
      BILLING_CONSUMER,
      message,
      async (repositories) => this.applyBillingEvent(repositories, message),
    );
  }

  private async handleWorkshopEvent(
    message: ApplicationMessage,
  ): Promise<void> {
    this.validateEnvelope(message, [
      "stock.reserved",
      "stock.reservation.failed",
      "stock.released",
      "stock.release.failed",
      "execution.started",
      "execution.finished",
      "execution.failed",
    ]);
    await this.processClaimedMessage(
      WORKSHOP_CONSUMER,
      message,
      async (repositories) => this.applyWorkshopEvent(repositories, message),
    );
  }

  private async processClaimedMessage(
    consumerName: string,
    message: ApplicationMessage,
    handler: (
      repositories: SagaLocalRepositories,
    ) => Promise<PublishedCommand | null>,
  ): Promise<void> {
    const claim = await this.unitOfWork.consumedMessages.claim(
      consumerName,
      message.eventId,
    );
    if (!claim) return;

    try {
      const command = await this.unitOfWork.execute(async (repositories) => {
        const prepared = await handler(repositories);
        if (!prepared) {
          await repositories.consumedMessages.markProcessed(
            consumerName,
            message.eventId,
            claim.token,
          );
        }
        return prepared;
      });

      if (command) {
        await this.publishCommand(command);
        await this.unitOfWork.consumedMessages.markProcessed(
          consumerName,
          message.eventId,
          claim.token,
        );
      }
    } catch (error) {
      await this.unitOfWork.consumedMessages
        .markFailed(consumerName, message.eventId, claim.token)
        .catch(() => undefined);
      throw error;
    }
  }

  private async applyBillingEvent(
    { orders, sagas }: SagaLocalRepositories,
    message: ApplicationMessage,
  ): Promise<PublishedCommand | null> {
    const saga = await this.requiredSaga(sagas, message);
    const order = await this.requiredOrder(orders, message.orderId);
    const previousStatus = saga.values.status;

    switch (message.eventName as SupportedBillingEvent) {
      case "budget.created":
        this.applyBudgetCreated(saga, message);
        await sagas.save(saga, saga.values.version);
        return null;
      case "budget.approved":
        await this.withOrderSaveIfChanged(orders, order, () => {
          this.applyBudgetApproved(order, saga, message);
        });
        await sagas.save(saga, saga.values.version);
        return null;
      case "budget.rejected":
        this.applyBudgetRejected(order, saga, message);
        await orders.save(order);
        await sagas.save(saga, saga.values.version);
        recordOrderProcessingFailureTransition(
          previousStatus,
          saga.values.status,
          this.orderFlowMetrics,
        );
        return null;
      case "payment.created":
        this.applyPaymentCreated(saga, message);
        await sagas.save(saga, saga.values.version);
        return null;
      case "payment.approved": {
        let command: PublishedCommand | null = null;
        await this.withOrderSaveIfChanged(orders, order, () => {
          command = this.applyPaymentApproved(order, saga, message);
        });
        const savedSaga = await sagas.save(saga, saga.values.version);
        return command ?? this.pendingCompensationCommand(savedSaga);
      }
      case "payment.failed":
        this.applyPaymentFailed(order, saga, message);
        await orders.save(order);
        await sagas.save(saga, saga.values.version);
        recordOrderProcessingFailureTransition(
          previousStatus,
          saga.values.status,
          this.orderFlowMetrics,
        );
        return null;
      case "payment.refunded": {
        const command = this.applyPaymentRefunded(saga, message);
        await sagas.save(saga, saga.values.version);
        return command;
      }
      case "payment.refund.failed":
        this.applyPaymentRefundFailed(saga, message);
        await sagas.save(saga, saga.values.version);
        recordOrderProcessingFailureTransition(
          previousStatus,
          saga.values.status,
          this.orderFlowMetrics,
        );
        return null;
      default:
        throw new DomainException(
          "SAGA_UNSUPPORTED_EVENT",
          "Unsupported billing event.",
        );
    }
  }

  private async applyWorkshopEvent(
    { orders, sagas }: SagaLocalRepositories,
    message: ApplicationMessage,
  ): Promise<PublishedCommand | null> {
    const saga = await this.requiredSaga(sagas, message);
    const order = await this.requiredOrder(orders, message.orderId);
    const previousStatus = saga.values.status;

    switch (message.eventName as SupportedWorkshopEvent) {
      case "stock.reserved": {
        let command: PublishedCommand | null = null;
        await this.withOrderSaveIfChanged(orders, order, () => {
          command = this.applyStockReserved(order, saga, message);
        });
        const savedSaga = await sagas.save(saga, saga.values.version);
        return command ?? this.pendingCompensationCommand(savedSaga);
      }
      case "stock.reservation.failed": {
        const command = this.applyStockReservationFailed(order, saga, message);
        await orders.save(order);
        const savedSaga = await sagas.save(saga, saga.values.version);
        recordOrderProcessingFailureTransition(
          previousStatus,
          saga.values.status,
          this.orderFlowMetrics,
        );
        return command ?? this.pendingCompensationCommand(savedSaga);
      }
      case "stock.released": {
        const command = this.applyStockReleased(saga, message);
        await sagas.save(saga, saga.values.version);
        return command;
      }
      case "stock.release.failed":
        this.applyStockReleaseFailed(saga, message);
        await sagas.save(saga, saga.values.version);
        recordOrderProcessingFailureTransition(
          previousStatus,
          saga.values.status,
          this.orderFlowMetrics,
        );
        return null;
      case "execution.started":
        this.applyExecutionStarted(order, saga, message);
        await orders.save(order);
        await sagas.save(saga, saga.values.version);
        return null;
      case "execution.finished":
        this.applyExecutionFinished(order, saga, message);
        await orders.save(order);
        await sagas.save(saga, saga.values.version);
        return null;
      case "execution.failed": {
        const command = this.applyExecutionFailed(order, saga, message);
        await orders.save(order);
        const savedSaga = await sagas.save(saga, saga.values.version);
        recordOrderProcessingFailureTransition(
          previousStatus,
          saga.values.status,
          this.orderFlowMetrics,
        );
        return command ?? this.pendingCompensationCommand(savedSaga);
      }
      default:
        throw new DomainException(
          "SAGA_UNSUPPORTED_EVENT",
          "Unsupported workshop event.",
        );
    }
  }

  private applyBudgetCreated(
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    const payload = this.requireBudgetPayload(message.payload, "CREATED");
    if (
      saga.values.currentStep === SagaStep.WAITING_BUDGET_APPROVAL &&
      saga.values.budgetId === payload.budgetId
    ) {
      return;
    }
    this.requireStep(saga, SagaStep.BUDGET_REQUESTED);
    saga.setBudgetId(payload.budgetId);
    saga.transitionTo(SagaStep.WAITING_BUDGET_APPROVAL);
  }

  private applyBudgetApproved(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    const payload = this.requireBudgetPayload(message.payload, "APPROVED");
    this.requireIdentifierMatch(
      saga.values.budgetId,
      payload.budgetId,
      "budgetId",
    );
    if (
      saga.values.currentStep === SagaStep.WAITING_PAYMENT &&
      order.status === OrderStatus.BUDGET_APPROVED
    ) {
      return;
    }
    this.requireStep(saga, SagaStep.WAITING_BUDGET_APPROVAL);
    order.approveBudget();
    saga.transitionTo(SagaStep.WAITING_PAYMENT);
  }

  private applyBudgetRejected(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    const payload = this.requireBudgetPayload(message.payload, "REJECTED");
    this.requireIdentifierMatch(
      saga.values.budgetId,
      payload.budgetId,
      "budgetId",
    );
    if (
      order.status === OrderStatus.BUDGET_REJECTED &&
      saga.values.status === SagaStatus.FAILED
    ) {
      return;
    }
    this.requireStep(saga, SagaStep.WAITING_BUDGET_APPROVAL);
    order.rejectBudget(
      sanitizeReason(payload.rejectionReason ?? "BUDGET_REJECTED"),
    );
    saga.planCompensation(
      this.triggerFromMessage(
        message,
        SagaStep.WAITING_BUDGET_APPROVAL,
        payload.rejectionReason ?? "BUDGET_REJECTED",
      ),
    );
  }

  private applyPaymentCreated(
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    const payload = this.requirePaymentPayload(message.payload, "PENDING");
    this.requireIdentifierMatch(
      saga.values.budgetId,
      payload.budgetId,
      "budgetId",
    );
    if (saga.values.paymentId === payload.paymentId) {
      return;
    }
    this.requireStep(saga, SagaStep.WAITING_PAYMENT);
    saga.setPaymentId(payload.paymentId);
  }

  private applyPaymentApproved(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): PublishedCommand | null {
    const payload = this.requirePaymentPayload(message.payload, "APPROVED");
    this.requireIdentifierMatch(
      saga.values.paymentId,
      payload.paymentId,
      "paymentId",
    );
    this.requireIdentifierMatch(
      saga.values.budgetId,
      payload.budgetId,
      "budgetId",
    );
    const occurredAt = this.requireOccurredAt(message.occurredAt);

    if (saga.values.status === SagaStatus.CANCELLED) {
      saga.recordPaymentApprovedAfterCancellation(occurredAt);
      return this.nextCompensationCommandOrNull(saga, occurredAt);
    }

    if (saga.values.currentStep === SagaStep.STOCK_RESERVATION_REQUESTED) {
      saga.recordPaymentApproved(occurredAt);
      return this.buildStockReserveRequestedCommand(saga, order);
    }

    this.requireStep(saga, SagaStep.WAITING_PAYMENT);
    saga.recordPaymentApproved(occurredAt);
    saga.transitionTo(SagaStep.STOCK_RESERVATION_REQUESTED);
    saga.recordCommandContext(
      SagaStep.STOCK_RESERVATION_REQUESTED,
      message.correlationId,
      message.eventId,
    );
    return this.buildStockReserveRequestedCommand(saga, order);
  }

  private applyPaymentFailed(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    const payload = this.requirePaymentPayload(message.payload, "FAILED");
    this.requireIdentifierMatch(
      saga.values.paymentId,
      payload.paymentId,
      "paymentId",
    );
    this.requireIdentifierMatch(
      saga.values.budgetId,
      payload.budgetId,
      "budgetId",
    );
    if (saga.values.paymentApprovedAt) {
      throw new DomainException(
        "SAGA_EVENT_CONFLICT",
        "Payment failure cannot replace an approved payment.",
      );
    }
    if (
      order.status === OrderStatus.CANCELLED &&
      saga.values.status === SagaStatus.FAILED
    ) {
      return;
    }
    order.cancel(sanitizeReason("PAYMENT_FAILED"));
    saga.planCompensation(
      this.triggerFromMessage(
        message,
        SagaStep.WAITING_PAYMENT,
        "PAYMENT_FAILED",
      ),
    );
  }

  private applyPaymentRefunded(
    saga: SagaInstance,
    message: ApplicationMessage,
  ): PublishedCommand | null {
    const payload = this.requirePaymentRefundedPayload(message.payload);
    this.requireIdentifierMatch(
      saga.values.paymentId,
      payload.paymentId,
      "paymentId",
    );
    this.requireIdentifierMatch(
      saga.values.budgetId,
      payload.budgetId,
      "budgetId",
    );
    const result = this.persistedResultFromMessage(message, payload, undefined);
    saga.recordPaymentRefunded(result);
    if (saga.nextCompensationAction() === "COMPLETE") {
      saga.completeCompensation(result.occurredAt);
    }
    return null;
  }

  private applyPaymentRefundFailed(
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    const payload = this.requirePaymentRefundFailedPayload(message.payload);
    this.requireIdentifierMatch(
      saga.values.paymentId,
      payload.paymentId,
      "paymentId",
    );
    this.requireIdentifierMatch(
      saga.values.budgetId,
      payload.budgetId,
      "budgetId",
    );
    const result = this.persistedResultFromMessage(
      message,
      payload,
      payload.failureCode,
    );
    saga.recordPaymentRefundFailed(result);
  }

  private applyStockReserved(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): PublishedCommand | null {
    const payload = this.requireStockReservedPayload(message.payload);

    if (
      saga.values.stockReleaseStatus ===
      CompensationActionStatus.WAITING_RESOURCE_CONFIRMATION
    ) {
      const reservations = this.requireReservationSnapshot(order, payload);
      saga.recordReservationOutcomeAfterCancellation(reservations);
      return this.nextCompensationCommandOrNull(
        saga,
        this.requireOccurredAt(message.occurredAt),
      );
    }

    if (saga.values.currentStep === SagaStep.EXECUTION_REQUESTED) {
      this.requireSameReservations(order, payload);
      return this.buildExecutionRequestedCommand(saga);
    }

    this.requireStep(saga, SagaStep.STOCK_RESERVATION_REQUESTED);
    const reservations = this.requireReservationSnapshot(order, payload);
    saga.recordReservedParts(reservations, false);
    saga.transitionTo(SagaStep.STOCK_RESERVED);
    saga.transitionTo(SagaStep.EXECUTION_REQUESTED);
    saga.recordCommandContext(
      SagaStep.EXECUTION_REQUESTED,
      message.correlationId,
      message.eventId,
    );
    return this.buildExecutionRequestedCommand(saga);
  }

  private applyStockReservationFailed(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): PublishedCommand | null {
    const payload = this.requireStockReservationFailedPayload(
      order,
      message.payload,
    );
    const successfulReservations = payload.reservations
      .filter((item) => !item.failureCode)
      .map(({ partId, quantity }) => ({ partId, quantity }));

    if (
      saga.values.stockReleaseStatus ===
      CompensationActionStatus.WAITING_RESOURCE_CONFIRMATION
    ) {
      saga.recordReservationOutcomeAfterCancellation(successfulReservations);
      return this.nextCompensationCommandOrNull(
        saga,
        this.requireOccurredAt(message.occurredAt),
      );
    }

    order.cancel(sanitizeReason("STOCK_RESERVATION_FAILED"));
    saga.recordReservedParts(successfulReservations, true);
    saga.planCompensation(
      this.triggerFromMessage(
        message,
        SagaStep.STOCK_RESERVATION_REQUESTED,
        "STOCK_RESERVATION_FAILED",
      ),
    );
    return this.nextCompensationCommandOrNull(
      saga,
      this.requireOccurredAt(message.occurredAt),
    );
  }

  private applyStockReleased(
    saga: SagaInstance,
    message: ApplicationMessage,
  ): PublishedCommand | null {
    const payload = this.requireStockReleasedPayload(
      saga.values.stockReleaseCommand,
      message.payload,
    );
    const result = this.persistedResultFromMessage(message, payload, undefined);
    saga.recordStockReleased(result);
    const occurredAt = this.requireOccurredAt(message.occurredAt);
    const command = this.nextCompensationCommandOrNull(saga, occurredAt);
    if (!command && saga.nextCompensationAction() === "COMPLETE") {
      saga.completeCompensation(occurredAt);
    }
    return command;
  }

  private applyStockReleaseFailed(
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    const payload = this.requireStockReleaseFailedPayload(
      saga.values.stockReleaseCommand,
      message.payload,
    );
    const aggregatedFailureCode =
      payload.reservations.find((item) => item.status === "FAILED")
        ?.failureCode ?? "STOCK_RELEASE_FAILED";
    const result = this.persistedResultFromMessage(
      message,
      payload,
      aggregatedFailureCode,
    );
    saga.recordStockReleaseFailed(result);
  }

  private applyExecutionStarted(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    if (saga.values.status !== SagaStatus.ACTIVE) {
      return;
    }
    if (saga.values.currentStep === SagaStep.IN_EXECUTION) {
      return;
    }
    this.requireEmptyPayload(message.payload);
    this.requireStep(saga, SagaStep.EXECUTION_REQUESTED);
    order.startExecution();
    saga.transitionTo(SagaStep.IN_EXECUTION);
  }

  private applyExecutionFinished(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): void {
    if (saga.values.status !== SagaStatus.ACTIVE) {
      return;
    }
    if (saga.values.currentStep === SagaStep.FINISHED) {
      return;
    }
    this.requireEmptyPayload(message.payload);
    this.requireStep(saga, SagaStep.IN_EXECUTION);
    order.finish();
    saga.transitionTo(SagaStep.FINISHED);
    saga.markCompleted();
  }

  private applyExecutionFailed(
    order: Order,
    saga: SagaInstance,
    message: ApplicationMessage,
  ): PublishedCommand | null {
    const payload = this.requireExecutionFailedPayload(message.payload);
    order.cancel(sanitizeReason(payload.failureCode));
    saga.planCompensation(
      this.triggerFromMessage(
        message,
        saga.values.currentStep,
        payload.failureCode,
      ),
    );
    return this.nextCompensationCommandOrNull(
      saga,
      this.requireOccurredAt(message.occurredAt),
    );
  }

  private applyCancellation(
    order: Order,
    saga: SagaInstance,
    trigger: CompensationTrigger,
    occurredAt: Date,
  ): PublishedCommand | null {
    const waitForReservationResult =
      saga.values.currentStep === SagaStep.STOCK_RESERVATION_REQUESTED &&
      saga.values.reservedParts.length === 0 &&
      saga.values.stockReleaseStatus === CompensationActionStatus.NOT_REQUIRED;

    if (order.status !== OrderStatus.CANCELLED) {
      order.cancel(trigger.reason);
    }
    saga.cancelWithCompensationTrigger(trigger, waitForReservationResult);
    return this.nextCompensationCommandOrNull(saga, occurredAt);
  }

  private nextCompensationCommandOrNull(
    saga: SagaInstance,
    occurredAt: Date,
  ): PublishedCommand | null {
    const pending = this.pendingCompensationCommand(saga);
    if (pending) return pending;

    switch (saga.nextCompensationAction()) {
      case "STOCK_RELEASE":
        return this.commandFromPersistedSnapshot(
          saga.prepareStockReleaseCommand(occurredAt),
        );
      case "PAYMENT_REFUND":
        return this.commandFromPersistedSnapshot(
          saga.preparePaymentRefundCommand(occurredAt),
        );
      default:
        return null;
    }
  }

  private pendingCompensationCommand(
    saga: SagaInstance,
  ): PublishedCommand | null {
    if (
      saga.values.stockReleaseStatus === CompensationActionStatus.REQUESTED &&
      saga.values.stockReleaseCommand
    ) {
      return this.commandFromPersistedSnapshot(saga.values.stockReleaseCommand);
    }
    if (
      saga.values.paymentRefundStatus === CompensationActionStatus.REQUESTED &&
      saga.values.paymentRefundCommand
    ) {
      return this.commandFromPersistedSnapshot(
        saga.values.paymentRefundCommand,
      );
    }
    return null;
  }

  private async withOrderSaveIfChanged(
    orders: SagaLocalRepositories["orders"],
    order: Order,
    mutation: () => void,
  ): Promise<void> {
    const before = this.captureOrderPersistenceState(order);
    mutation();
    const after = this.captureOrderPersistenceState(order);
    if (!this.sameOrderPersistenceState(before, after)) {
      await orders.save(order);
    }
  }

  private captureOrderPersistenceState(order: Order): {
    status: string;
    updatedAt: number;
    rejectionReason: string | null;
    cancellationReason: string | null;
  } {
    return {
      status: order.status,
      updatedAt: order.updatedAt.getTime(),
      rejectionReason: order.rejectionReason ?? null,
      cancellationReason: order.cancellationReason ?? null,
    };
  }

  private sameOrderPersistenceState(
    left: ReturnType<SagaOrchestratorService["captureOrderPersistenceState"]>,
    right: ReturnType<SagaOrchestratorService["captureOrderPersistenceState"]>,
  ): boolean {
    return (
      left.status === right.status &&
      left.updatedAt === right.updatedAt &&
      left.rejectionReason === right.rejectionReason &&
      left.cancellationReason === right.cancellationReason
    );
  }

  private commandFromPersistedSnapshot(
    command: PersistedCompensationCommand,
  ): PublishedCommand {
    return {
      exchange: "orders.topic",
      routingKey: command.eventName,
      message: command,
    };
  }

  private buildBudgetRequestedCommand(
    saga: SagaInstance,
    order: Order,
  ): PublishedCommand {
    const payload: BudgetRequestPayload = {
      orderNumber: order.number.value,
      customer: {
        customerId: order.customerId,
        customerDocument: order.customerDocument ?? "",
        customerName: order.customerName ?? "",
      },
      vehicle: order.vehicleId
        ? {
            vehicleId: order.vehicleId,
            vehiclePlate: order.vehiclePlate ?? "",
            vehicleBrand: order.vehicleBrand ?? "",
            vehicleModel: order.vehicleModel ?? "",
            vehicleYear: order.vehicleYear ?? 0,
          }
        : undefined,
      serviceItems: order.serviceItems.map((item) => ({
        serviceId: item.serviceCatalogItemId,
        serviceName: item.serviceName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
      partItems: order.partItems.map((item) => ({
        partId: item.partId,
        partCode: item.partCode,
        partName: item.partName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
    };
    return this.happyPathCommand(
      "budget.requested",
      SagaStep.BUDGET_REQUESTED,
      saga,
      payload,
    );
  }

  private buildStockReserveRequestedCommand(
    saga: SagaInstance,
    order: Order,
  ): PublishedCommand {
    const payload: StockReservationRequestPayload = {
      reservations: order.partItems.map((item) => ({
        partId: item.partId,
        quantity: item.quantity,
      })),
    };
    return this.happyPathCommand(
      "stock.reserve.requested",
      SagaStep.STOCK_RESERVATION_REQUESTED,
      saga,
      payload,
    );
  }

  private buildExecutionRequestedCommand(saga: SagaInstance): PublishedCommand {
    return this.happyPathCommand(
      "execution.requested",
      SagaStep.EXECUTION_REQUESTED,
      saga,
      {},
    );
  }

  private happyPathCommand(
    eventName:
      "budget.requested" | "stock.reserve.requested" | "execution.requested",
    step: SagaStep,
    saga: SagaInstance,
    payload: unknown,
  ): PublishedCommand {
    const context = saga.commandContext(step);
    return {
      exchange: "orders.topic",
      routingKey: eventName,
      message: {
        eventId: deterministicEventId(eventName, saga.values.sagaId, step),
        eventName,
        eventVersion: 1,
        occurredAt: saga.stepTimestamp(step).toISOString(),
        correlationId: context.correlationId,
        causationId: context.causationId,
        sagaId: saga.values.sagaId,
        orderId: saga.values.orderId,
        payload,
      },
    };
  }

  private async publishCommand(command: PublishedCommand): Promise<void> {
    if (!this.messagingEnabled()) return;
    await this.publisher.publish(
      command.exchange,
      command.routingKey,
      command.message as ApplicationMessage,
    );
  }

  private validateEnvelope(
    message: ApplicationMessage,
    allowedEvents: string[],
  ): void {
    if (
      !allowedEvents.includes(message.eventName) ||
      message.eventVersion !== 1 ||
      !normalizeString(message.eventId) ||
      !normalizeString(message.sagaId) ||
      !normalizeString(message.orderId) ||
      !normalizeString(message.correlationId) ||
      !normalizeString(message.causationId) ||
      !this.isIsoDate(message.occurredAt) ||
      typeof message.payload === "undefined"
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Message envelope is invalid.",
      );
    }
  }

  private async requiredSaga(
    sagas: SagaLocalRepositories["sagas"],
    message: ApplicationMessage,
  ): Promise<SagaInstance> {
    const saga = await sagas.findById(message.sagaId);
    if (!saga || saga.values.orderId !== message.orderId) {
      throw new DomainException(
        "SAGA_MESSAGE_MISMATCH",
        "Saga does not match the message order.",
      );
    }
    return saga;
  }

  private async requiredSagaByOrderId(
    sagas: SagaLocalRepositories["sagas"],
    orderId: string,
  ): Promise<SagaInstance> {
    const saga = await sagas.findByOrderId(orderId);
    if (!saga) {
      throw new DomainException("SAGA_NOT_FOUND", "Saga was not found.");
    }
    return saga;
  }

  private async requiredOrder(
    orders: SagaLocalRepositories["orders"],
    orderId: string,
  ): Promise<Order> {
    const order = await orders.findById(orderId);
    if (!order) {
      throw new DomainException("ORDER_NOT_FOUND", "Order was not found.");
    }
    return order;
  }

  private requireStep(saga: SagaInstance, expected: SagaStep): void {
    if (saga.values.currentStep !== expected) {
      throw new DomainException(
        "SAGA_EVENT_OUT_OF_ORDER",
        "Message is not valid for the current saga step.",
      );
    }
  }

  private requireBudgetPayload(
    payload: unknown,
    status: BudgetStatePayload["status"],
  ): BudgetStatePayload {
    const candidate = payload as BudgetStatePayload;
    if (
      !candidate ||
      candidate.status !== status ||
      !normalizeString(candidate.budgetId)
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Budget payload is invalid.",
      );
    }
    return {
      ...candidate,
      budgetId: normalizeString(candidate.budgetId) as string,
      rejectionReason: candidate.rejectionReason
        ? sanitizeReason(candidate.rejectionReason)
        : undefined,
    };
  }

  private requirePaymentPayload(
    payload: unknown,
    status: PaymentStatePayload["status"],
  ): PaymentStatePayload {
    const candidate = payload as PaymentStatePayload;
    if (
      !candidate ||
      candidate.status !== status ||
      !normalizeString(candidate.paymentId) ||
      !normalizeString(candidate.budgetId)
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Payment payload is invalid.",
      );
    }
    return {
      ...candidate,
      paymentId: normalizeString(candidate.paymentId) as string,
      budgetId: normalizeString(candidate.budgetId) as string,
      providerPaymentId:
        normalizeString(candidate.providerPaymentId) ?? undefined,
    };
  }

  private requirePaymentRefundedPayload(
    payload: unknown,
  ): PaymentRefundedPayload {
    const candidate = payload as PaymentRefundedPayload;
    if (
      !candidate ||
      candidate.status !== "REFUNDED" ||
      !normalizeString(candidate.paymentId) ||
      !normalizeString(candidate.budgetId)
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Refund success payload is invalid.",
      );
    }
    return {
      ...candidate,
      paymentId: normalizeString(candidate.paymentId) as string,
      budgetId: normalizeString(candidate.budgetId) as string,
      providerPaymentId:
        normalizeString(candidate.providerPaymentId) ?? undefined,
      providerRefundId:
        normalizeString(candidate.providerRefundId) ?? undefined,
    };
  }

  private requirePaymentRefundFailedPayload(
    payload: unknown,
  ): PaymentRefundFailedPayload {
    const candidate = payload as PaymentRefundFailedPayload;
    if (
      !candidate ||
      candidate.status !== "REFUND_FAILED" ||
      !normalizeString(candidate.paymentId) ||
      !normalizeString(candidate.budgetId) ||
      !normalizeString(candidate.failureCode)
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Refund failure payload is invalid.",
      );
    }
    return {
      ...candidate,
      paymentId: normalizeString(candidate.paymentId) as string,
      budgetId: normalizeString(candidate.budgetId) as string,
      providerPaymentId:
        normalizeString(candidate.providerPaymentId) ?? undefined,
      failureCode: sanitizeFailureCode(candidate.failureCode),
    };
  }

  private requireStockReservedPayload(
    payload: unknown,
  ): StockReservationStatePayload {
    const candidate = payload as StockReservationStatePayload;
    if (
      !candidate ||
      !Array.isArray(candidate.reservations) ||
      candidate.reservations.length === 0
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Stock reservations are required.",
      );
    }
    return {
      reservations: candidate.reservations.map((reservation) => {
        const partId = normalizeString(reservation.partId);
        if (
          !partId ||
          !Number.isInteger(reservation.quantity) ||
          reservation.quantity <= 0
        ) {
          throw new DomainException(
            "SAGA_INVALID_MESSAGE",
            "Stock reservation is invalid.",
          );
        }
        return {
          partId,
          quantity: reservation.quantity,
        };
      }),
    };
  }

  private requireStockReservationFailedPayload(
    order: Order,
    payload: unknown,
  ): StockReservationStatePayload {
    const candidate = payload as StockReservationStatePayload;
    if (
      !candidate ||
      !Array.isArray(candidate.reservations) ||
      candidate.reservations.length === 0
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Stock reservation failure payload is invalid.",
      );
    }
    const seen = new Set<string>();
    let hasFailure = false;
    const reservations = candidate.reservations.map((reservation) => {
      const partId = normalizeString(reservation.partId);
      if (
        !partId ||
        !Number.isInteger(reservation.quantity) ||
        reservation.quantity <= 0 ||
        seen.has(partId)
      ) {
        throw new DomainException(
          "SAGA_INVALID_MESSAGE",
          "Stock reservation failure payload is invalid.",
        );
      }
      seen.add(partId);
      const failureCode = reservation.failureCode
        ? sanitizeFailureCode(reservation.failureCode)
        : undefined;
      if (failureCode) hasFailure = true;
      return { partId, quantity: reservation.quantity, failureCode };
    });
    if (!hasFailure) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Stock reservation failure must contain at least one failed item.",
      );
    }
    this.requireSameReservationItems(
      order,
      reservations.map(({ partId, quantity }) => ({ partId, quantity })),
    );
    return { reservations };
  }

  private requireStockReleasedPayload(
    command: PersistedCompensationCommand | null | undefined,
    payload: unknown,
  ): StockReleasedPayload {
    const persistedCommand = command as
      | PersistedCompensationCommand<StockReservationRequestPayload>
      | null
      | undefined;
    const candidate = payload as StockReleasedPayload;
    if (
      !persistedCommand ||
      persistedCommand.eventName !== "stock.release.requested"
    ) {
      throw new DomainException(
        "SAGA_COMPENSATION_COMMAND_MISSING",
        "Stock release command was not persisted.",
      );
    }
    if (
      !candidate ||
      !Array.isArray(candidate.reservations) ||
      candidate.reservations.length !==
        persistedCommand.payload.reservations.length
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Stock release result payload is invalid.",
      );
    }
    const reservations = candidate.reservations.map((item, index) => {
      const expected = persistedCommand.payload.reservations[index];
      if (
        item.status !== "RELEASED" ||
        normalizeString(item.partId) !== expected.partId ||
        item.quantity !== expected.quantity
      ) {
        throw new DomainException(
          "SAGA_COMPENSATION_RESULT_CONFLICT",
          "Stock release result does not match the persisted command.",
        );
      }
      return {
        partId: expected.partId,
        quantity: expected.quantity,
        status: "RELEASED" as const,
      };
    });
    return { reservations };
  }

  private requireStockReleaseFailedPayload(
    command: PersistedCompensationCommand | null | undefined,
    payload: unknown,
  ): StockReleaseFailedPayload {
    const persistedCommand = command as
      | PersistedCompensationCommand<StockReservationRequestPayload>
      | null
      | undefined;
    const candidate = payload as StockReleaseFailedPayload;
    if (
      !persistedCommand ||
      persistedCommand.eventName !== "stock.release.requested"
    ) {
      throw new DomainException(
        "SAGA_COMPENSATION_COMMAND_MISSING",
        "Stock release command was not persisted.",
      );
    }
    if (
      !candidate ||
      !Array.isArray(candidate.reservations) ||
      candidate.reservations.length !==
        persistedCommand.payload.reservations.length
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Stock release failure payload is invalid.",
      );
    }
    let hasFailure = false;
    const reservations = candidate.reservations.map((item, index) => {
      const expected = persistedCommand.payload.reservations[index];
      const partId = normalizeString(item.partId);
      if (
        !partId ||
        partId !== expected.partId ||
        item.quantity !== expected.quantity
      ) {
        throw new DomainException(
          "SAGA_COMPENSATION_RESULT_CONFLICT",
          "Stock release result does not match the persisted command.",
        );
      }
      if (item.status === "RELEASED") {
        if (item.failureCode) {
          throw new DomainException(
            "SAGA_INVALID_MESSAGE",
            "Released stock items cannot contain failure codes.",
          );
        }
        return { partId, quantity: item.quantity, status: "RELEASED" as const };
      }
      if (item.status !== "FAILED" || !normalizeString(item.failureCode)) {
        throw new DomainException(
          "SAGA_INVALID_MESSAGE",
          "Failed stock release items require a failure code.",
        );
      }
      hasFailure = true;
      const failureCode = sanitizeFailureCode(item.failureCode as string);
      return {
        partId,
        quantity: item.quantity,
        status: "FAILED" as const,
        failureCode,
      };
    });
    if (!hasFailure) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Stock release failure payload must contain at least one failed item.",
      );
    }
    return { reservations };
  }

  private requireExecutionFailedPayload(payload: unknown): {
    failureCode: string;
  } {
    const candidate = payload as { failureCode?: string };
    if (!candidate?.failureCode) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Execution failure payload is invalid.",
      );
    }
    return { failureCode: sanitizeFailureCode(candidate.failureCode) };
  }

  private requireEmptyPayload(payload: unknown): void {
    if (
      !payload ||
      typeof payload !== "object" ||
      Object.keys(payload as Record<string, unknown>).length !== 0
    ) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Event payload must be empty.",
      );
    }
  }

  private requireReservationSnapshot(
    order: Order,
    payload: StockReservationStatePayload,
  ): ReservedPart[] {
    this.requireSameReservations(order, payload);
    return payload.reservations.map(({ partId, quantity }) => ({
      partId,
      quantity,
    }));
  }

  private requireSameReservations(
    order: Order,
    payload: StockReservationStatePayload,
  ): void {
    this.requireSameReservationItems(
      order,
      payload.reservations.map(({ partId, quantity }) => ({
        partId,
        quantity,
      })),
    );
  }

  private requireSameReservationItems(
    order: Order,
    reservations: Array<{ partId: string; quantity: number }>,
  ): void {
    const expected = order.partItems
      .map((item) => `${item.partId}:${item.quantity}`)
      .sort();
    const actual = reservations
      .map((item) => `${item.partId}:${item.quantity}`)
      .sort();
    if (
      expected.length !== actual.length ||
      expected.some((value, index) => value !== actual[index])
    ) {
      throw new DomainException(
        "SAGA_RESERVATION_MISMATCH",
        "Stock reservations do not match order parts.",
      );
    }
  }

  private requireIdentifierMatch(
    actual: string | null | undefined,
    expected: string,
    field: string,
  ): void {
    if (!actual || actual !== expected) {
      throw new DomainException(
        "SAGA_IDENTIFIER_MISMATCH",
        `${field} does not match the saga.`,
      );
    }
  }

  private requireOccurredAt(value: string): Date {
    const occurredAt = new Date(value);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new DomainException(
        "SAGA_INVALID_MESSAGE",
        "Message timestamp is invalid.",
      );
    }
    return occurredAt;
  }

  private triggerFromMessage(
    message: ApplicationMessage,
    failedStep: SagaStep,
    reason: string,
  ): CompensationTrigger {
    return {
      eventId: message.eventId,
      eventName: message.eventName,
      occurredAt: this.requireOccurredAt(message.occurredAt),
      correlationId: message.correlationId,
      causationId: message.causationId,
      failedStep,
      reason: sanitizeReason(reason),
    };
  }

  private cancellationTrigger(
    saga: SagaInstance,
    reason: string | undefined,
    occurredAt: Date,
  ): CompensationTrigger {
    if (saga.values.compensationTrigger?.eventName === "order.cancelled") {
      if (
        reason &&
        sanitizeReason(reason) !== saga.values.compensationTrigger.reason
      ) {
        throw new DomainException(
          "SAGA_COMPENSATION_TRIGGER_CONFLICT",
          "Cancellation reason cannot replace the persisted trigger.",
        );
      }
      return saga.values.compensationTrigger;
    }
    return {
      eventId: deterministicEventId(
        "order.cancelled",
        saga.values.sagaId,
        "CANCELLED",
      ),
      eventName: "order.cancelled",
      occurredAt,
      correlationId: deterministicEventId(
        "order.cancelled.correlation",
        saga.values.sagaId,
        "CANCELLED",
      ),
      causationId: deterministicEventId(
        "order.cancelled.causation",
        saga.values.sagaId,
        "CANCELLED",
      ),
      failedStep: saga.values.currentStep,
      reason: sanitizeReason(reason ?? "ORDER_CANCELLED"),
    };
  }

  private persistedResultFromMessage(
    message: ApplicationMessage,
    payload: unknown,
    failureCode: string | undefined,
  ): PersistedCompensationResult {
    return {
      eventId: message.eventId,
      eventName: message.eventName as PersistedCompensationResult["eventName"],
      eventVersion: 1,
      occurredAt: this.requireOccurredAt(message.occurredAt),
      correlationId: message.correlationId,
      causationId: message.causationId,
      sagaId: message.sagaId,
      orderId: message.orderId,
      payload: cloneJson(payload),
      ...(failureCode ? { failureCode } : {}),
    };
  }

  private messagingEnabled(): boolean {
    return this.configService.get<boolean>("MESSAGING_ENABLED", false);
  }

  private isIsoDate(value: string): boolean {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
  }
}

function recordOrderProcessingFailureTransition(
  previousStatus: SagaStatus,
  currentStatus: SagaStatus,
  metrics: OrderFlowMetrics,
): void {
  if (
    previousStatus !== currentStatus &&
    (currentStatus === SagaStatus.FAILED ||
      currentStatus === SagaStatus.MANUAL_INTERVENTION_REQUIRED)
  ) {
    metrics.recordTerminalProcessingFailure();
  }
}

function deterministicEventId(
  eventName: string,
  sagaId: string,
  transition: string,
): string {
  return createHash("sha256")
    .update(`${eventName}:${sagaId}:${transition}`)
    .digest("hex");
}

function normalizeString(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sanitizeReason(value: string): string {
  const withoutControlCharacters = Array.from(value ?? "", (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const normalized = withoutControlCharacters
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  if (!normalized) {
    throw new DomainException(
      "SAGA_INVALID_REASON",
      "A business reason is required.",
    );
  }
  return normalized;
}

function sanitizeFailureCode(value: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new DomainException(
      "SAGA_INVALID_FAILURE_CODE",
      "A failure code is required.",
    );
  }
  const sanitized = normalized
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  if (!sanitized) {
    throw new DomainException(
      "SAGA_INVALID_FAILURE_CODE",
      "A failure code is required.",
    );
  }
  return sanitized;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
