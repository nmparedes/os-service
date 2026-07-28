import {
  SagaInstance,
  SagaInstanceProps,
} from "../../domain/saga-instance.entity";
import {
  CompensationActionStatus,
  CompensationStatus,
  SagaStatus,
  SagaStep,
} from "../../domain/saga.enums";
import {
  CompensationTrigger,
  PersistedCompensationCommand,
  PersistedCompensationResult,
  PersistedPaymentRefundCommand,
  PersistedStockReleaseCommand,
} from "../../domain/saga-compensation";
import { SagaInstanceOrmEntity } from "../typeorm/saga-instance.orm-entity";
export class SagaInstanceMapper {
  static toDomain(entity: SagaInstanceOrmEntity): SagaInstance {
    return SagaInstance.restore({
      sagaId: entity.sagaId,
      orderId: entity.orderId,
      status: entity.status as SagaStatus,
      currentStep: entity.currentStep as SagaStep,
      completedSteps: entity.completedSteps as SagaStep[],
      budgetId: entity.budgetId,
      paymentId: entity.paymentId,
      paymentApprovedAt: entity.paymentApprovedAt,
      reservedParts: entity.reservedParts,
      failedStep: entity.failedStep as SagaStep | null,
      failureReason: entity.failureReason,
      compensationStatus: entity.compensationStatus as CompensationStatus,
      compensationTrigger: deserializeTrigger(entity.compensationTrigger),
      compensationStartedAt: entity.compensationStartedAt,
      stockReleaseStatus: entity.stockReleaseStatus as CompensationActionStatus,
      paymentRefundStatus:
        entity.paymentRefundStatus as CompensationActionStatus,
      stockReleaseCommand: deserializeCommand(
        entity.stockReleaseCommand,
      ) as PersistedStockReleaseCommand | null,
      paymentRefundCommand: deserializeCommand(
        entity.paymentRefundCommand,
      ) as PersistedPaymentRefundCommand | null,
      stockReleaseResult: deserializeResult(entity.stockReleaseResult),
      paymentRefundResult: deserializeResult(entity.paymentRefundResult),
      compensationFailureCode: entity.compensationFailureCode,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      completedAt: entity.completedAt,
      failedAt: entity.failedAt,
      stepOccurredAt: Object.fromEntries(
        Object.entries(entity.stepOccurredAt ?? {}).map(([step, value]) => [
          step,
          new Date(value),
        ]),
      ) as Partial<Record<SagaStep, Date>>,
      commandContexts: entity.commandContexts ?? {},
    });
  }
  static toOrm(props: SagaInstanceProps): SagaInstanceOrmEntity {
    return Object.assign(new SagaInstanceOrmEntity(), {
      ...props,
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
      reservedParts: props.reservedParts.map((part) => ({ ...part })),
      stepOccurredAt: Object.fromEntries(
        Object.entries(props.stepOccurredAt ?? {}).map(([step, value]) => [
          step,
          value.toISOString(),
        ]),
      ),
      commandContexts: Object.fromEntries(
        Object.entries(props.commandContexts ?? {}).map(([step, value]) => [
          step,
          { ...value },
        ]),
      ),
      compensationTrigger: serializeDatedSnapshot(props.compensationTrigger),
      stockReleaseCommand: serializeDatedSnapshot(props.stockReleaseCommand),
      paymentRefundCommand: serializeDatedSnapshot(props.paymentRefundCommand),
      stockReleaseResult: serializeDatedSnapshot(props.stockReleaseResult),
      paymentRefundResult: serializeDatedSnapshot(props.paymentRefundResult),
    });
  }
}

function serializeDatedSnapshot(
  value:
    | CompensationTrigger
    | PersistedCompensationCommand
    | PersistedCompensationResult
    | null
    | undefined,
): Record<string, unknown> | null {
  return value
    ? (JSON.parse(
        JSON.stringify({
          ...value,
          occurredAt: value.occurredAt.toISOString(),
        }),
      ) as Record<string, unknown>)
    : null;
}

function deserializeTrigger(
  value: Record<string, unknown> | null,
): CompensationTrigger | null {
  return value
    ? ({
        ...cloneJson(value),
        occurredAt: new Date(String(value.occurredAt)),
      } as CompensationTrigger)
    : null;
}

function deserializeCommand(
  value: Record<string, unknown> | null,
): PersistedCompensationCommand | null {
  return value
    ? ({
        ...cloneJson(value),
        occurredAt: new Date(String(value.occurredAt)),
      } as PersistedCompensationCommand)
    : null;
}

function deserializeResult(
  value: Record<string, unknown> | null,
): PersistedCompensationResult | null {
  return value
    ? ({
        ...cloneJson(value),
        occurredAt: new Date(String(value.occurredAt)),
      } as PersistedCompensationResult)
    : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
