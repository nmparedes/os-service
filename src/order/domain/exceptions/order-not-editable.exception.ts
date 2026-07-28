import { DomainException } from "../../../common/exceptions/domain.exception";
import { OrderStatus } from "../enums/order-status.enum";

export class OrderNotEditableException extends DomainException {
  constructor(status: OrderStatus) {
    super(
      "ORDER_NOT_EDITABLE",
      `Order with status ${status} cannot be edited.`,
    );
  }
}
