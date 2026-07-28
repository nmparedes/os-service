import { DomainException } from "../../../common/exceptions/domain.exception";
export class SagaConcurrencyConflictException extends DomainException {
  constructor(sagaId: string) {
    super(
      "SAGA_CONCURRENCY_CONFLICT",
      `Saga ${sagaId} was modified by another worker.`,
    );
  }
}
