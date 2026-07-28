import { DomainException } from "../../../common/exceptions/domain.exception";
import { OrderStatus } from "../enums/order-status.enum";

export class InvalidStatusTransitionException extends DomainException {
  constructor(currentStatus: OrderStatus, nextStatus: OrderStatus) {
    super(
      "INVALID_STATUS_TRANSITION",
      `Invalid status transition: ${currentStatus} to ${nextStatus}.`,
    );
  }
}
