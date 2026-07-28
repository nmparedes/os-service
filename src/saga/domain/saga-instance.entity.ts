import { createHash, randomUUID } from "node:crypto";
import { DomainException } from "../../common/exceptions/domain.exception";
import {
  CompensationActionStatus,
  CompensationStatus,
  NextCompensationAction,
  SagaStatus,
  SagaStep,
} from "./saga.enums";
import {
  CompensationTrigger,
  PaymentRefundCommandPayload,
  PersistedCompensationCommand,
  PersistedCompensationResult,
  PersistedPaymentRefundCommand,
  PersistedStockReleaseCommand,
  StockReleaseCommandPayload,
} from "./saga-compensation";

export interface ReservedPart {
  partId: string;
  quantity: number;
}

export interface SagaInstanceProps {
  sagaId: string;
  orderId: string;
  status: SagaStatus;
  currentStep: SagaStep;
  completedSteps: SagaStep[];
  budgetId?: string | null;
  paymentId?: string | null;
  paymentApprovedAt?: Date | null;
  reservedParts: ReservedPart[];
  failedStep?: SagaStep | null;
  failureReason?: string | null;
  compensationStatus: CompensationStatus;
  compensationTrigger?: CompensationTrigger | null;
  compensationStartedAt?: Date | null;
  stockReleaseStatus: CompensationActionStatus;
  paymentRefundStatus: CompensationActionStatus;
  stockReleaseCommand?: PersistedStockReleaseCommand | null;
  paymentRefundCommand?: PersistedPaymentRefundCommand | null;
  stockReleaseResult?: PersistedCompensationResult | null;
  paymentRefundResult?: PersistedCompensationResult | null;
  compensationFailureCode?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  failedAt?: Date | null;
  stepOccurredAt?: Partial<Record<SagaStep, Date>>;
  commandContexts?: Partial<Record<SagaStep, SagaCommandContext>>;
}

export interface SagaCommandContext {
  correlationId: string;
  causationId: string;
}

const steps = Object.values(SagaStep);
const terminalStatuses = new Set<SagaStatus>([
  SagaStatus.COMPLETED,
  SagaStatus.COMPENSATED,
  SagaStatus.MANUAL_INTERVENTION_REQUIRED,
  SagaStatus.CANCELLED,
]);

const happyPathBlockedStatuses = new Set<SagaStatus>([
  SagaStatus.FAILED,
  SagaStatus.COMPENSATING,
  ...terminalStatuses,
]);

export class SagaInstance {
  private constructor(private readonly props: SagaInstanceProps) {}

  static create(orderId: string, sagaId: string = randomUUID()): SagaInstance {
    const normalizedOrderId = normalizeRequiredId(
      orderId,
      "SAGA_INVALID_ORDER",
    );
    const normalizedSagaId = normalizeRequiredId(sagaId, "SAGA_INVALID_ID");
    const now = new Date();
    return new SagaInstance({
      sagaId: normalizedSagaId,
      orderId: normalizedOrderId,
      status: SagaStatus.ACTIVE,
      currentStep: SagaStep.ORDER_PREPARATION,
      completedSteps: [],
      reservedParts: [],
      compensationStatus: CompensationStatus.NOT_REQUIRED,
      stockReleaseStatus: CompensationActionStatus.NOT_REQUIRED,
      paymentRefundStatus: CompensationActionStatus.NOT_REQUIRED,
      version: 1,
      createdAt: now,
      updatedAt: now,
      stepOccurredAt: { [SagaStep.ORDER_PREPARATION]: now },
      commandContexts: {},
    });
  }

  static restore(props: SagaInstanceProps): SagaInstance {
    return new SagaInstance({
      ...props,
      sagaId: normalizeRequiredId(props.sagaId, "SAGA_INVALID_ID"),
      orderId: normalizeRequiredId(props.orderId, "SAGA_INVALID_ORDER"),
      createdAt: new Date(props.createdAt),
      updatedAt: new Date(props.updatedAt),
      completedAt: props.completedAt ? new Date(props.completedAt) : null,
      failedAt: props.failedAt ? new Date(props.failedAt) : null,
      paymentApprovedAt: props.paymentApprovedAt
        ? new Date(props.paymentApprovedAt)
        : null,
      compensationStartedAt: props.compensationStartedAt
        ? new Date(props.compensationStartedAt)
        : null,
      completedSteps: [...props.completedSteps],
      reservedParts: cloneReservedParts(props.reservedParts),
      stepOccurredAt: cloneStepOccurredAt(props.stepOccurredAt),
      commandContexts: cloneCommandContexts(props.commandContexts),
      compensationTrigger: cloneCompensationTrigger(props.compensationTrigger),
      stockReleaseStatus:
        props.stockReleaseStatus ?? CompensationActionStatus.NOT_REQUIRED,
      paymentRefundStatus:
        props.paymentRefundStatus ?? CompensationActionStatus.NOT_REQUIRED,
      stockReleaseCommand: cloneCompensationCommand(
        props.stockReleaseCommand,
      ) as PersistedStockReleaseCommand | null,
      paymentRefundCommand: cloneCompensationCommand(
        props.paymentRefundCommand,
      ) as PersistedPaymentRefundCommand | null,
      stockReleaseResult: cloneCompensationResult(props.stockReleaseResult),
      paymentRefundResult: cloneCompensationResult(props.paymentRefundResult),
      compensationFailureCode: props.compensationFailureCode ?? null,
    });
  }

  transitionTo(step: SagaStep): void {
    if (step === this.props.currentStep) return;
    if (happyPathBlockedStatuses.has(this.props.status)) {
      throw new DomainException(
        "SAGA_TERMINAL",
        "A terminal saga cannot transition.",
      );
    }
    const currentIndex = steps.indexOf(this.props.currentStep);
    const nextIndex = steps.indexOf(step);
    if (nextIndex !== currentIndex + 1) {
      throw new DomainException(
        "SAGA_INVALID_TRANSITION",
        "Saga steps must advance exactly once.",
      );
    }
    const now = new Date();
    this.props.completedSteps.push(this.props.currentStep);
    this.props.currentStep = step;
    this.props.stepOccurredAt ??= {};
    this.props.stepOccurredAt[step] = now;
    this.props.updatedAt = now;
  }

  recordCommandContext(
    step: SagaStep,
    correlationId: string,
    causationId: string,
  ): void {
    const normalizedCorrelationId = normalizeRequiredId(
      correlationId,
      "SAGA_INVALID_CORRELATION",
    );
    const normalizedCausationId = normalizeRequiredId(
      causationId,
      "SAGA_INVALID_CAUSATION",
    );
    this.props.commandContexts ??= {};
    const existing = this.props.commandContexts[step];
    if (
      existing &&
      existing.correlationId === normalizedCorrelationId &&
      existing.causationId === normalizedCausationId
    )
      return;
    if (existing) {
      throw new DomainException(
        "SAGA_COMMAND_CONTEXT_CONFLICT",
        "Command context cannot be replaced.",
      );
    }
    this.props.commandContexts[step] = {
      correlationId: normalizedCorrelationId,
      causationId: normalizedCausationId,
    };
    this.props.updatedAt = new Date();
  }

  commandContext(step: SagaStep): SagaCommandContext {
    const context = this.props.commandContexts?.[step];
    const occurredAt = this.props.stepOccurredAt?.[step];
    if (!context || !occurredAt) {
      throw new DomainException(
        "SAGA_COMMAND_NOT_PERSISTED",
        "The command transition was not persisted.",
      );
    }
    return { ...context };
  }

  stepTimestamp(step: SagaStep): Date {
    const occurredAt = this.props.stepOccurredAt?.[step];
    if (!occurredAt) {
      throw new DomainException(
        "SAGA_STEP_NOT_REACHED",
        "The requested saga step has not been reached.",
      );
    }
    return new Date(occurredAt);
  }

  markCompleted(): void {
    if (this.props.status === SagaStatus.COMPLETED) return;
    if (
      this.props.currentStep !== SagaStep.FINISHED ||
      this.props.status !== SagaStatus.ACTIVE
    ) {
      throw new DomainException(
        "SAGA_INVALID_COMPLETION",
        "Only a finished active saga can complete.",
      );
    }
    this.props.status = SagaStatus.COMPLETED;
    this.props.completedAt = this.props.updatedAt = new Date();
  }

  markFailed(step: SagaStep, reason: string): void {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new DomainException(
        "SAGA_INVALID_FAILURE_REASON",
        "Failure reason is required.",
      );
    }
    if (
      this.props.status === SagaStatus.FAILED &&
      this.props.failedStep === step &&
      this.props.failureReason === normalizedReason
    )
      return;
    if (happyPathBlockedStatuses.has(this.props.status))
      throw new DomainException(
        "SAGA_TERMINAL",
        "A terminal saga cannot fail.",
      );
    this.props.status = SagaStatus.FAILED;
    this.props.failedStep = step;
    this.props.failureReason = normalizedReason;
    this.props.failedAt = this.props.updatedAt = new Date();
  }
  setBudgetId(budgetId: string): void {
    budgetId = normalizeRequiredId(budgetId, "SAGA_INVALID_BUDGET");
    if (this.props.budgetId && this.props.budgetId !== budgetId)
      throw new DomainException(
        "SAGA_BUDGET_CONFLICT",
        "Budget ID cannot be replaced.",
      );
    if (this.props.budgetId === budgetId) return;
    this.assertHappyPathMutable();
    this.props.budgetId = budgetId;
    this.props.updatedAt = new Date();
  }
  setPaymentId(paymentId: string): void {
    paymentId = normalizeRequiredId(paymentId, "SAGA_INVALID_PAYMENT");
    if (this.props.paymentId && this.props.paymentId !== paymentId)
      throw new DomainException(
        "SAGA_PAYMENT_CONFLICT",
        "Payment ID cannot be replaced.",
      );
    if (this.props.paymentId === paymentId) return;
    this.assertHappyPathMutable();
    this.props.paymentId = paymentId;
    this.props.updatedAt = new Date();
  }

  recordPaymentApproved(occurredAt: Date): void {
    if (!this.props.paymentId) {
      throw new DomainException(
        "SAGA_PAYMENT_NOT_RECORDED",
        "Payment must be recorded before approval.",
      );
    }
    const normalizedOccurredAt = normalizeDate(
      occurredAt,
      "SAGA_INVALID_PAYMENT_APPROVAL_DATE",
    );
    if (this.props.paymentApprovedAt) {
      if (
        this.props.paymentApprovedAt.getTime() ===
        normalizedOccurredAt.getTime()
      )
        return;
      throw new DomainException(
        "SAGA_PAYMENT_APPROVAL_CONFLICT",
        "Payment approval timestamp cannot be replaced.",
      );
    }
    this.assertHappyPathMutable();
    this.props.paymentApprovedAt = normalizedOccurredAt;
    this.props.updatedAt = new Date();
  }

  recordPaymentApprovedAfterCancellation(occurredAt: Date): void {
    if (this.props.status !== SagaStatus.CANCELLED) {
      throw new DomainException(
        "SAGA_INVALID_PAYMENT_APPROVAL",
        "Late payment approval is only valid for a cancelled saga.",
      );
    }
    if (this.props.currentStep !== SagaStep.WAITING_PAYMENT) {
      throw new DomainException(
        "SAGA_INVALID_PAYMENT_APPROVAL",
        "Late payment approval is only valid while waiting for payment.",
      );
    }
    this.recordPaymentApprovedWithoutHappyPathGuard(occurredAt);
    this.ensureCancellationTriggerForCompensation();
    this.props.status = SagaStatus.FAILED;
    this.props.compensationStatus = CompensationStatus.PENDING;
    this.props.stockReleaseStatus =
      this.props.stockReleaseStatus ===
      CompensationActionStatus.WAITING_RESOURCE_CONFIRMATION
        ? CompensationActionStatus.WAITING_RESOURCE_CONFIRMATION
        : this.props.reservedParts.length > 0
          ? CompensationActionStatus.PENDING
          : CompensationActionStatus.NOT_REQUIRED;
    this.props.paymentRefundStatus = CompensationActionStatus.PENDING;
    this.props.completedAt = null;
    this.props.updatedAt = new Date();
  }

  setReservedParts(parts: ReservedPart[]): void {
    this.recordReservedParts(parts, false);
  }

  recordReservedParts(parts: ReservedPart[], allowEmpty = true): void {
    const normalized = normalizeReservedParts(parts, allowEmpty);
    if (sameValue(normalized, this.props.reservedParts)) return;
    this.assertHappyPathMutable();
    if (this.props.reservedParts.length > 0) {
      throw new DomainException(
        "SAGA_RESERVED_PARTS_CONFLICT",
        "Reserved parts snapshot cannot be replaced.",
      );
    }
    this.props.reservedParts = normalized;
    this.props.updatedAt = new Date();
  }

  planCompensation(trigger: CompensationTrigger): void {
    const normalizedTrigger = normalizeCompensationTrigger(trigger);
    if (this.props.compensationTrigger) {
      if (sameValue(this.props.compensationTrigger, normalizedTrigger)) return;
      throw new DomainException(
        "SAGA_COMPENSATION_TRIGGER_CONFLICT",
        "Compensation trigger cannot be replaced.",
      );
    }
    if (
      terminalStatuses.has(this.props.status) ||
      this.props.status === SagaStatus.COMPENSATING
    ) {
      throw new DomainException(
        "SAGA_TERMINAL",
        "A terminal or compensating saga cannot be planned again.",
      );
    }

    const releaseRequired = this.props.reservedParts.length > 0;
    const refundRequired = Boolean(
      this.props.paymentId && this.props.paymentApprovedAt,
    );
    this.props.compensationTrigger = normalizedTrigger;
    this.props.failedStep = normalizedTrigger.failedStep;
    this.props.failureReason = normalizedTrigger.reason;
    this.props.failedAt ??= new Date(normalizedTrigger.occurredAt);
    this.props.status = SagaStatus.FAILED;
    this.props.stockReleaseStatus = releaseRequired
      ? CompensationActionStatus.PENDING
      : CompensationActionStatus.NOT_REQUIRED;
    this.props.paymentRefundStatus = refundRequired
      ? CompensationActionStatus.PENDING
      : CompensationActionStatus.NOT_REQUIRED;
    this.props.compensationStatus =
      releaseRequired || refundRequired
        ? CompensationStatus.PENDING
        : CompensationStatus.NOT_REQUIRED;
    this.props.updatedAt = new Date();
  }

  cancelWithCompensationTrigger(
    trigger: CompensationTrigger,
    waitForReservationResult = false,
  ): void {
    const normalizedTrigger = normalizeCompensationTrigger(trigger);
    if (this.props.compensationTrigger) {
      if (!sameValue(this.props.compensationTrigger, normalizedTrigger)) {
        throw new DomainException(
          "SAGA_COMPENSATION_TRIGGER_CONFLICT",
          "Compensation trigger cannot be replaced.",
        );
      }
      if (
        this.props.status === SagaStatus.CANCELLED ||
        this.props.status === SagaStatus.FAILED ||
        this.props.status === SagaStatus.COMPENSATING ||
        this.props.status === SagaStatus.COMPENSATED ||
        this.props.status === SagaStatus.MANUAL_INTERVENTION_REQUIRED
      ) {
        return;
      }
    }
    if (
      this.props.status === SagaStatus.COMPENSATED ||
      this.props.status === SagaStatus.MANUAL_INTERVENTION_REQUIRED ||
      this.props.status === SagaStatus.COMPLETED
    ) {
      throw new DomainException(
        "SAGA_TERMINAL",
        "A terminal saga cannot cancel.",
      );
    }

    const releaseRequired = this.props.reservedParts.length > 0;
    const refundRequired = Boolean(
      this.props.paymentId && this.props.paymentApprovedAt,
    );

    this.props.compensationTrigger = normalizedTrigger;
    this.props.failedStep = normalizedTrigger.failedStep;
    this.props.failureReason = normalizedTrigger.reason;
    this.props.failedAt ??= new Date(normalizedTrigger.occurredAt);
    this.props.completedAt = null;

    if (!releaseRequired && !refundRequired && !waitForReservationResult) {
      this.props.status = SagaStatus.CANCELLED;
      this.props.compensationStatus = CompensationStatus.NOT_REQUIRED;
      this.props.stockReleaseStatus = CompensationActionStatus.NOT_REQUIRED;
      this.props.paymentRefundStatus = CompensationActionStatus.NOT_REQUIRED;
      this.props.updatedAt = new Date();
      return;
    }

    this.props.status = SagaStatus.FAILED;
    this.props.compensationStatus = CompensationStatus.PENDING;
    this.props.stockReleaseStatus = waitForReservationResult
      ? CompensationActionStatus.WAITING_RESOURCE_CONFIRMATION
      : releaseRequired
        ? CompensationActionStatus.PENDING
        : CompensationActionStatus.NOT_REQUIRED;
    this.props.paymentRefundStatus = refundRequired
      ? CompensationActionStatus.PENDING
      : CompensationActionStatus.NOT_REQUIRED;
    this.props.updatedAt = new Date();
  }

  recordReservationOutcomeAfterCancellation(parts: ReservedPart[]): void {
    if (
      this.props.stockReleaseStatus !==
      CompensationActionStatus.WAITING_RESOURCE_CONFIRMATION
    ) {
      throw new DomainException(
        "SAGA_INVALID_RESERVATION_OUTCOME",
        "Reservation outcome is not pending for compensation.",
      );
    }
    const normalized = normalizeReservedParts(parts, true);
    if (this.props.reservedParts.length > 0) {
      throw new DomainException(
        "SAGA_RESERVED_PARTS_CONFLICT",
        "Reserved parts snapshot cannot be replaced.",
      );
    }
    this.props.reservedParts = normalized;
    this.props.stockReleaseStatus =
      normalized.length > 0
        ? CompensationActionStatus.PENDING
        : CompensationActionStatus.NOT_REQUIRED;
    if (
      this.props.stockReleaseStatus === CompensationActionStatus.NOT_REQUIRED &&
      this.props.paymentRefundStatus === CompensationActionStatus.NOT_REQUIRED
    ) {
      this.props.status = SagaStatus.CANCELLED;
      this.props.compensationStatus = CompensationStatus.NOT_REQUIRED;
    } else {
      this.props.status = SagaStatus.FAILED;
      this.props.compensationStatus = CompensationStatus.PENDING;
    }
    this.props.updatedAt = new Date();
  }

  prepareStockReleaseCommand(
    occurredAt: Date = new Date(),
  ): PersistedStockReleaseCommand {
    if (this.props.stockReleaseCommand) {
      const expected = this.buildStockReleaseCommand(
        this.props.stockReleaseCommand.occurredAt,
      );
      if (!sameValue(this.props.stockReleaseCommand, expected)) {
        throw new DomainException(
          "SAGA_COMPENSATION_COMMAND_CONFLICT",
          "Persisted stock release command conflicts with saga state.",
        );
      }
      return cloneCompensationCommand(
        this.props.stockReleaseCommand,
      ) as PersistedStockReleaseCommand;
    }
    this.requirePlannedAction(
      this.props.stockReleaseStatus,
      "SAGA_STOCK_RELEASE_NOT_PENDING",
    );
    const command = this.buildStockReleaseCommand(occurredAt);
    this.props.stockReleaseCommand = command;
    this.props.stockReleaseStatus = CompensationActionStatus.REQUESTED;
    this.startCompensation(command.occurredAt);
    return cloneCompensationCommand(command) as PersistedStockReleaseCommand;
  }

  recordStockReleased(result: PersistedCompensationResult): void {
    const normalized = this.normalizeResult(
      result,
      "stock.released",
      this.props.stockReleaseCommand,
      false,
    );
    if (this.acceptExistingResult(this.props.stockReleaseResult, normalized))
      return;
    this.requireActionRequested(
      this.props.stockReleaseStatus,
      "SAGA_STOCK_RELEASE_OUT_OF_ORDER",
    );
    this.props.stockReleaseResult = normalized;
    this.props.stockReleaseStatus = CompensationActionStatus.COMPLETED;
    this.props.updatedAt = new Date();
  }

  recordStockReleaseFailed(result: PersistedCompensationResult): void {
    const normalized = this.normalizeResult(
      result,
      "stock.release.failed",
      this.props.stockReleaseCommand,
      true,
    );
    if (this.acceptExistingResult(this.props.stockReleaseResult, normalized))
      return;
    this.requireActionRequested(
      this.props.stockReleaseStatus,
      "SAGA_STOCK_RELEASE_OUT_OF_ORDER",
    );
    this.props.stockReleaseResult = normalized;
    this.failCompensationAction("stock", normalized.failureCode as string);
  }

  preparePaymentRefundCommand(
    occurredAt: Date = new Date(),
  ): PersistedPaymentRefundCommand {
    if (!this.props.paymentId || !this.props.paymentApprovedAt) {
      throw new DomainException(
        "SAGA_PAYMENT_NOT_COMPENSABLE",
        "Only an approved recorded payment can be refunded.",
      );
    }
    if (this.props.paymentRefundCommand) {
      const expected = this.buildPaymentRefundCommand(
        this.props.paymentRefundCommand.occurredAt,
      );
      if (!sameValue(this.props.paymentRefundCommand, expected)) {
        throw new DomainException(
          "SAGA_COMPENSATION_COMMAND_CONFLICT",
          "Persisted payment refund command conflicts with saga state.",
        );
      }
      return cloneCompensationCommand(
        this.props.paymentRefundCommand,
      ) as PersistedPaymentRefundCommand;
    }
    this.requirePlannedAction(
      this.props.paymentRefundStatus,
      "SAGA_PAYMENT_REFUND_NOT_PENDING",
    );
    if (
      this.props.stockReleaseStatus !== CompensationActionStatus.NOT_REQUIRED &&
      this.props.stockReleaseStatus !== CompensationActionStatus.COMPLETED
    ) {
      throw new DomainException(
        "SAGA_COMPENSATION_ORDER_VIOLATION",
        "Stock release must complete before payment refund.",
      );
    }
    const command = this.buildPaymentRefundCommand(occurredAt);
    this.props.paymentRefundCommand = command;
    this.props.paymentRefundStatus = CompensationActionStatus.REQUESTED;
    this.startCompensation(command.occurredAt);
    return cloneCompensationCommand(command) as PersistedPaymentRefundCommand;
  }

  recordPaymentRefunded(result: PersistedCompensationResult): void {
    const normalized = this.normalizeResult(
      result,
      "payment.refunded",
      this.props.paymentRefundCommand,
      false,
    );
    if (this.acceptExistingResult(this.props.paymentRefundResult, normalized))
      return;
    this.requireActionRequested(
      this.props.paymentRefundStatus,
      "SAGA_PAYMENT_REFUND_OUT_OF_ORDER",
    );
    this.props.paymentRefundResult = normalized;
    this.props.paymentRefundStatus = CompensationActionStatus.COMPLETED;
    this.props.updatedAt = new Date();
  }

  recordPaymentRefundFailed(result: PersistedCompensationResult): void {
    const normalized = this.normalizeResult(
      result,
      "payment.refund.failed",
      this.props.paymentRefundCommand,
      true,
    );
    if (this.acceptExistingResult(this.props.paymentRefundResult, normalized))
      return;
    this.requireActionRequested(
      this.props.paymentRefundStatus,
      "SAGA_PAYMENT_REFUND_OUT_OF_ORDER",
    );
    this.props.paymentRefundResult = normalized;
    this.failCompensationAction("payment", normalized.failureCode as string);
  }

  nextCompensationAction(): NextCompensationAction {
    if (
      terminalStatuses.has(this.props.status) ||
      this.props.compensationStatus === CompensationStatus.NOT_REQUIRED
    )
      return "NONE";
    if (
      this.props.stockReleaseStatus ===
      CompensationActionStatus.WAITING_RESOURCE_CONFIRMATION
    )
      return "NONE";
    if (this.props.stockReleaseStatus === CompensationActionStatus.PENDING)
      return "STOCK_RELEASE";
    if (
      this.props.stockReleaseStatus === CompensationActionStatus.REQUESTED ||
      this.props.stockReleaseStatus === CompensationActionStatus.FAILED
    )
      return "NONE";
    if (this.props.paymentRefundStatus === CompensationActionStatus.PENDING)
      return "PAYMENT_REFUND";
    if (
      this.props.paymentRefundStatus === CompensationActionStatus.REQUESTED ||
      this.props.paymentRefundStatus === CompensationActionStatus.FAILED
    )
      return "NONE";
    if (
      this.props.compensationStatus === CompensationStatus.IN_PROGRESS &&
      this.allCompensationActionsCompleted()
    )
      return "COMPLETE";
    return "NONE";
  }

  completeCompensation(completedAt: Date = new Date()): void {
    if (this.props.status === SagaStatus.COMPENSATED) return;
    if (this.props.status !== SagaStatus.COMPENSATING) {
      throw new DomainException(
        "SAGA_INVALID_COMPENSATION",
        "Only a compensating saga can complete compensation.",
      );
    }
    if (this.nextCompensationAction() !== "COMPLETE") {
      throw new DomainException(
        "SAGA_COMPENSATION_INCOMPLETE",
        "Compensation results are incomplete.",
      );
    }
    const normalizedCompletedAt = normalizeDate(
      completedAt,
      "SAGA_INVALID_COMPENSATION_DATE",
    );
    this.props.status = SagaStatus.COMPENSATED;
    this.props.compensationStatus = CompensationStatus.COMPLETED;
    this.props.completedAt = normalizedCompletedAt;
    this.props.updatedAt = new Date();
  }

  scheduleCompensation(): void {
    if (
      this.props.compensationTrigger &&
      this.props.status === SagaStatus.FAILED &&
      this.props.compensationStatus === CompensationStatus.PENDING
    )
      return;
    throw new DomainException(
      "SAGA_COMPENSATION_TRIGGER_REQUIRED",
      "Compensation must be planned from a persisted business trigger.",
    );
  }

  failCompensation(): void {
    if (this.props.status === SagaStatus.MANUAL_INTERVENTION_REQUIRED) return;
    throw new DomainException(
      "SAGA_COMPENSATION_RESULT_REQUIRED",
      "An explicit failed compensation result is required.",
    );
  }

  markManualInterventionRequired(): void {
    if (this.props.status === SagaStatus.MANUAL_INTERVENTION_REQUIRED) return;
    throw new DomainException(
      "SAGA_COMPENSATION_RESULT_REQUIRED",
      "An explicit failed compensation result is required.",
    );
  }
  cancel(): void {
    if (terminalStatuses.has(this.props.status))
      throw new DomainException(
        "SAGA_TERMINAL",
        "A terminal saga cannot cancel.",
      );
    if (this.props.paymentApprovedAt || this.props.reservedParts.length)
      throw new DomainException(
        "SAGA_COMPENSATION_REQUIRED",
        "Resources require compensation before cancellation.",
      );
    this.props.status = SagaStatus.CANCELLED;
    this.props.completedAt = this.props.updatedAt = new Date();
  }

  startCompensating(): void {
    if (this.props.status === SagaStatus.COMPENSATING) return;
    throw new DomainException(
      "SAGA_COMPENSATION_COMMAND_REQUIRED",
      "A persisted compensation command is required.",
    );
  }

  markCompensated(): void {
    this.completeCompensation();
  }

  private requiredCompensationTrigger(): CompensationTrigger {
    if (!this.props.compensationTrigger) {
      throw new DomainException(
        "SAGA_COMPENSATION_NOT_PLANNED",
        "Compensation trigger was not persisted.",
      );
    }
    return cloneCompensationTrigger(
      this.props.compensationTrigger,
    ) as CompensationTrigger;
  }

  private buildStockReleaseCommand(
    occurredAt: Date,
  ): PersistedStockReleaseCommand {
    const trigger = this.requiredCompensationTrigger();
    return normalizeCompensationCommand<StockReleaseCommandPayload>({
      eventId: deterministicCompensationEventId(
        "stock.release.requested",
        this.props.sagaId,
        trigger.eventId,
      ),
      eventName: "stock.release.requested",
      eventVersion: 1,
      occurredAt,
      correlationId: trigger.correlationId,
      causationId: trigger.eventId,
      sagaId: this.props.sagaId,
      orderId: this.props.orderId,
      payload: { reservations: cloneReservedParts(this.props.reservedParts) },
    }) as PersistedStockReleaseCommand;
  }

  private buildPaymentRefundCommand(
    occurredAt: Date,
  ): PersistedPaymentRefundCommand {
    const trigger = this.requiredCompensationTrigger();
    if (!this.props.paymentId) {
      throw new DomainException(
        "SAGA_PAYMENT_NOT_COMPENSABLE",
        "Only an approved recorded payment can be refunded.",
      );
    }
    return normalizeCompensationCommand<PaymentRefundCommandPayload>({
      eventId: deterministicCompensationEventId(
        "payment.refund.requested",
        this.props.sagaId,
        trigger.eventId,
      ),
      eventName: "payment.refund.requested",
      eventVersion: 1,
      occurredAt,
      correlationId: trigger.correlationId,
      causationId: this.props.stockReleaseResult?.eventId ?? trigger.eventId,
      sagaId: this.props.sagaId,
      orderId: this.props.orderId,
      payload: {
        paymentId: this.props.paymentId,
        reason: trigger.reason,
      },
    }) as PersistedPaymentRefundCommand;
  }

  private assertHappyPathMutable(): void {
    if (happyPathBlockedStatuses.has(this.props.status)) {
      throw new DomainException(
        "SAGA_TERMINAL",
        "A failed, compensating or terminal saga cannot return to happy path.",
      );
    }
  }

  private requirePlannedAction(
    status: CompensationActionStatus,
    code: string,
  ): void {
    const compensationCanAdvance =
      (this.props.status === SagaStatus.FAILED &&
        this.props.compensationStatus === CompensationStatus.PENDING) ||
      (this.props.status === SagaStatus.COMPENSATING &&
        this.props.compensationStatus === CompensationStatus.IN_PROGRESS);
    if (
      !compensationCanAdvance ||
      status !== CompensationActionStatus.PENDING
    ) {
      throw new DomainException(code, "Compensation action is not pending.");
    }
  }

  private requireActionRequested(
    status: CompensationActionStatus,
    code: string,
  ): void {
    if (
      this.props.status !== SagaStatus.COMPENSATING ||
      this.props.compensationStatus !== CompensationStatus.IN_PROGRESS ||
      status !== CompensationActionStatus.REQUESTED
    ) {
      throw new DomainException(code, "Compensation result is out of order.");
    }
  }

  private startCompensation(occurredAt: Date): void {
    if (
      this.props.status === SagaStatus.FAILED ||
      this.props.status === SagaStatus.CANCELLED
    ) {
      this.props.status = SagaStatus.COMPENSATING;
      this.props.compensationStatus = CompensationStatus.IN_PROGRESS;
      this.props.compensationStartedAt = new Date(occurredAt);
      this.props.completedAt = null;
    }
    this.props.updatedAt = new Date();
  }

  private normalizeResult(
    result: PersistedCompensationResult,
    expectedEventName: PersistedCompensationResult["eventName"],
    command:
      | PersistedStockReleaseCommand
      | PersistedPaymentRefundCommand
      | null
      | undefined,
    failureExpected: boolean,
  ): PersistedCompensationResult {
    if (!command) {
      throw new DomainException(
        "SAGA_COMPENSATION_COMMAND_MISSING",
        "Compensation command was not persisted.",
      );
    }
    const normalized = normalizeCompensationResult(result);
    if (
      normalized.eventName !== expectedEventName ||
      normalized.eventVersion !== 1 ||
      normalized.correlationId !== command.correlationId ||
      normalized.causationId !== command.eventId ||
      normalized.sagaId !== command.sagaId ||
      normalized.orderId !== command.orderId
    ) {
      throw new DomainException(
        "SAGA_COMPENSATION_RESULT_CONFLICT",
        "Compensation result does not match the persisted command.",
      );
    }
    if (failureExpected !== Boolean(normalized.failureCode)) {
      throw new DomainException(
        "SAGA_COMPENSATION_RESULT_INVALID",
        failureExpected
          ? "A failed compensation result requires a failure code."
          : "A successful compensation result cannot contain a failure code.",
      );
    }
    return normalized;
  }

  private acceptExistingResult(
    existing: PersistedCompensationResult | null | undefined,
    incoming: PersistedCompensationResult,
  ): boolean {
    if (!existing) return false;
    if (sameValue(existing, incoming)) return true;
    throw new DomainException(
      "SAGA_COMPENSATION_RESULT_CONFLICT",
      "Compensation result cannot be replaced.",
    );
  }

  private failCompensationAction(
    action: "stock" | "payment",
    failureCode: string,
  ): void {
    if (action === "stock") {
      this.props.stockReleaseStatus = CompensationActionStatus.FAILED;
    } else {
      this.props.paymentRefundStatus = CompensationActionStatus.FAILED;
    }
    this.props.compensationFailureCode = failureCode;
    this.props.compensationStatus = CompensationStatus.FAILED;
    this.props.status = SagaStatus.MANUAL_INTERVENTION_REQUIRED;
    this.props.updatedAt = new Date();
  }

  private allCompensationActionsCompleted(): boolean {
    return [
      this.props.stockReleaseStatus,
      this.props.paymentRefundStatus,
    ].every(
      (status) =>
        status === CompensationActionStatus.NOT_REQUIRED ||
        status === CompensationActionStatus.COMPLETED,
    );
  }

  private recordPaymentApprovedWithoutHappyPathGuard(occurredAt: Date): void {
    if (!this.props.paymentId) {
      throw new DomainException(
        "SAGA_PAYMENT_NOT_RECORDED",
        "Payment must be recorded before approval.",
      );
    }
    const normalizedOccurredAt = normalizeDate(
      occurredAt,
      "SAGA_INVALID_PAYMENT_APPROVAL_DATE",
    );
    if (this.props.paymentApprovedAt) {
      if (
        this.props.paymentApprovedAt.getTime() ===
        normalizedOccurredAt.getTime()
      ) {
        return;
      }
      throw new DomainException(
        "SAGA_PAYMENT_APPROVAL_CONFLICT",
        "Payment approval timestamp cannot be replaced.",
      );
    }
    this.props.paymentApprovedAt = normalizedOccurredAt;
    this.props.updatedAt = new Date();
  }

  private ensureCancellationTriggerForCompensation(): void {
    if (!this.props.compensationTrigger) {
      throw new DomainException(
        "SAGA_COMPENSATION_TRIGGER_REQUIRED",
        "A persisted cancellation trigger is required.",
      );
    }
    if (this.props.compensationTrigger.eventName !== "order.cancelled") {
      throw new DomainException(
        "SAGA_COMPENSATION_TRIGGER_REQUIRED",
        "Late payment compensation requires the cancellation trigger.",
      );
    }
  }

  get values(): SagaInstanceProps {
    return {
      ...this.props,
      createdAt: new Date(this.props.createdAt),
      updatedAt: new Date(this.props.updatedAt),
      completedAt: this.props.completedAt
        ? new Date(this.props.completedAt)
        : null,
      failedAt: this.props.failedAt ? new Date(this.props.failedAt) : null,
      paymentApprovedAt: this.props.paymentApprovedAt
        ? new Date(this.props.paymentApprovedAt)
        : null,
      compensationStartedAt: this.props.compensationStartedAt
        ? new Date(this.props.compensationStartedAt)
        : null,
      completedSteps: [...this.props.completedSteps],
      reservedParts: cloneReservedParts(this.props.reservedParts),
      stepOccurredAt: cloneStepOccurredAt(this.props.stepOccurredAt),
      commandContexts: cloneCommandContexts(this.props.commandContexts),
      compensationTrigger: cloneCompensationTrigger(
        this.props.compensationTrigger,
      ),
      stockReleaseCommand: cloneCompensationCommand(
        this.props.stockReleaseCommand,
      ) as PersistedStockReleaseCommand | null,
      paymentRefundCommand: cloneCompensationCommand(
        this.props.paymentRefundCommand,
      ) as PersistedPaymentRefundCommand | null,
      stockReleaseResult: cloneCompensationResult(
        this.props.stockReleaseResult,
      ),
      paymentRefundResult: cloneCompensationResult(
        this.props.paymentRefundResult,
      ),
      compensationFailureCode: this.props.compensationFailureCode,
    };
  }
}

function normalizeRequiredId(value: string, code: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new DomainException(code, "A non-empty identifier is required.");
  }
  return normalized;
}

function normalizeReservedParts(
  parts: ReservedPart[],
  allowEmpty = false,
): ReservedPart[] {
  if (!Array.isArray(parts) || (!allowEmpty && parts.length === 0)) {
    throw new DomainException(
      "SAGA_INVALID_RESERVED_PARTS",
      "Reserved parts must be unique with positive quantities.",
    );
  }

  const partIds = new Set<string>();
  const normalized = parts.map((part) => {
    const partId = part?.partId?.trim();
    if (
      !partId ||
      !Number.isInteger(part.quantity) ||
      part.quantity <= 0 ||
      partIds.has(partId)
    ) {
      throw new DomainException(
        "SAGA_INVALID_RESERVED_PARTS",
        "Reserved parts must be unique with positive quantities.",
      );
    }
    partIds.add(partId);
    return { partId, quantity: part.quantity };
  });

  return normalized;
}

function cloneReservedParts(parts: ReservedPart[]): ReservedPart[] {
  return parts.map((part) => ({ ...part }));
}

function cloneStepOccurredAt(
  values: Partial<Record<SagaStep, Date>> | undefined,
): Partial<Record<SagaStep, Date>> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([step, value]) => [
      step,
      new Date(value),
    ]),
  ) as Partial<Record<SagaStep, Date>>;
}

function cloneCommandContexts(
  values: Partial<Record<SagaStep, SagaCommandContext>> | undefined,
): Partial<Record<SagaStep, SagaCommandContext>> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([step, value]) => [step, { ...value }]),
  ) as Partial<Record<SagaStep, SagaCommandContext>>;
}

function normalizeDate(value: Date, code: string): Date {
  const normalized = new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    throw new DomainException(code, "A valid timestamp is required.");
  }
  return normalized;
}

function normalizeCompensationTrigger(
  trigger: CompensationTrigger,
): CompensationTrigger {
  if (!Object.values(SagaStep).includes(trigger?.failedStep)) {
    throw new DomainException(
      "SAGA_INVALID_COMPENSATION_TRIGGER",
      "Compensation failed step is invalid.",
    );
  }
  return {
    eventId: normalizeRequiredId(
      trigger.eventId,
      "SAGA_INVALID_COMPENSATION_TRIGGER",
    ),
    eventName: normalizeRequiredId(
      trigger.eventName,
      "SAGA_INVALID_COMPENSATION_TRIGGER",
    ),
    occurredAt: normalizeDate(
      trigger.occurredAt,
      "SAGA_INVALID_COMPENSATION_TRIGGER",
    ),
    correlationId: normalizeRequiredId(
      trigger.correlationId,
      "SAGA_INVALID_COMPENSATION_TRIGGER",
    ),
    causationId: normalizeRequiredId(
      trigger.causationId,
      "SAGA_INVALID_COMPENSATION_TRIGGER",
    ),
    failedStep: trigger.failedStep,
    reason: sanitizeReason(trigger.reason),
  };
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
      "SAGA_INVALID_COMPENSATION_REASON",
      "Compensation reason is required.",
    );
  }
  return normalized;
}

function normalizeCompensationCommand<TPayload>(
  command: PersistedCompensationCommand<TPayload>,
): PersistedCompensationCommand<TPayload> {
  if (
    command.eventVersion !== 1 ||
    !["stock.release.requested", "payment.refund.requested"].includes(
      command.eventName,
    )
  ) {
    throw new DomainException(
      "SAGA_INVALID_COMPENSATION_COMMAND",
      "Compensation command contract is invalid.",
    );
  }
  return {
    eventId: normalizeRequiredId(
      command.eventId,
      "SAGA_INVALID_COMPENSATION_COMMAND",
    ),
    eventName: command.eventName,
    eventVersion: 1,
    occurredAt: normalizeDate(
      command.occurredAt,
      "SAGA_INVALID_COMPENSATION_COMMAND",
    ),
    correlationId: normalizeRequiredId(
      command.correlationId,
      "SAGA_INVALID_COMPENSATION_COMMAND",
    ),
    causationId: normalizeRequiredId(
      command.causationId,
      "SAGA_INVALID_COMPENSATION_COMMAND",
    ),
    sagaId: normalizeRequiredId(
      command.sagaId,
      "SAGA_INVALID_COMPENSATION_COMMAND",
    ),
    orderId: normalizeRequiredId(
      command.orderId,
      "SAGA_INVALID_COMPENSATION_COMMAND",
    ),
    payload: cloneValue(command.payload),
  };
}

function normalizeCompensationResult(
  result: PersistedCompensationResult,
): PersistedCompensationResult {
  if (
    result.eventVersion !== 1 ||
    ![
      "stock.released",
      "stock.release.failed",
      "payment.refunded",
      "payment.refund.failed",
    ].includes(result.eventName)
  ) {
    throw new DomainException(
      "SAGA_INVALID_COMPENSATION_RESULT",
      "Compensation result contract is invalid.",
    );
  }
  const failureCode = result.failureCode
    ? normalizeRequiredId(
        result.failureCode,
        "SAGA_INVALID_COMPENSATION_RESULT",
      ).slice(0, 100)
    : undefined;
  return {
    eventId: normalizeRequiredId(
      result.eventId,
      "SAGA_INVALID_COMPENSATION_RESULT",
    ),
    eventName: result.eventName,
    eventVersion: 1,
    occurredAt: normalizeDate(
      result.occurredAt,
      "SAGA_INVALID_COMPENSATION_RESULT",
    ),
    correlationId: normalizeRequiredId(
      result.correlationId,
      "SAGA_INVALID_COMPENSATION_RESULT",
    ),
    causationId: normalizeRequiredId(
      result.causationId,
      "SAGA_INVALID_COMPENSATION_RESULT",
    ),
    sagaId: normalizeRequiredId(
      result.sagaId,
      "SAGA_INVALID_COMPENSATION_RESULT",
    ),
    orderId: normalizeRequiredId(
      result.orderId,
      "SAGA_INVALID_COMPENSATION_RESULT",
    ),
    payload: cloneValue(result.payload),
    ...(failureCode ? { failureCode } : {}),
  };
}

function cloneCompensationTrigger(
  trigger: CompensationTrigger | null | undefined,
): CompensationTrigger | null {
  return trigger
    ? { ...trigger, occurredAt: new Date(trigger.occurredAt) }
    : null;
}

function cloneCompensationCommand<TPayload>(
  command: PersistedCompensationCommand<TPayload> | null | undefined,
): PersistedCompensationCommand<TPayload> | null {
  return command
    ? {
        ...command,
        occurredAt: new Date(command.occurredAt),
        payload: cloneValue(command.payload),
      }
    : null;
}

function cloneCompensationResult(
  result: PersistedCompensationResult | null | undefined,
): PersistedCompensationResult | null {
  return result
    ? {
        ...result,
        occurredAt: new Date(result.occurredAt),
        payload: cloneValue(result.payload),
      }
    : null;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(toComparable(left)) === JSON.stringify(toComparable(right))
  );
}

function toComparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toComparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toComparable(item)]),
    );
  }
  return value;
}

function deterministicCompensationEventId(
  eventName: string,
  sagaId: string,
  triggerEventId: string,
): string {
  return createHash("sha256")
    .update(`${eventName}:${sagaId}:${triggerEventId}`)
    .digest("hex");
}
