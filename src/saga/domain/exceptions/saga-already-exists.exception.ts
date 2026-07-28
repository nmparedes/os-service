import { DomainException } from "../../../common/exceptions/domain.exception";

export class SagaAlreadyExistsException extends DomainException {
  constructor(field: "sagaId" | "orderId") {
    super(
      field === "sagaId" ? "SAGA_ID_CONFLICT" : "SAGA_ORDER_CONFLICT",
      `A saga with the same ${field} already exists.`,
    );
  }
}
