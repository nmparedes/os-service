import { Injectable } from "@nestjs/common";
import { OrderStatus } from "../enums/order-status.enum";
import { InvalidStatusTransitionException } from "../exceptions/invalid-status-transition.exception";

@Injectable()
export class OrderStatusTransitionService {
  private readonly validTransitions = new Map<OrderStatus, OrderStatus[]>([
    [OrderStatus.RECEIVED, [OrderStatus.IN_DIAGNOSIS, OrderStatus.CANCELLED]],
    [
      OrderStatus.IN_DIAGNOSIS,
      [OrderStatus.WAITING_BUDGET_APPROVAL, OrderStatus.CANCELLED],
    ],
    [
      OrderStatus.WAITING_BUDGET_APPROVAL,
      [OrderStatus.BUDGET_APPROVED, OrderStatus.BUDGET_REJECTED],
    ],
    [
      OrderStatus.BUDGET_APPROVED,
      [OrderStatus.IN_EXECUTION, OrderStatus.CANCELLED],
    ],
    [OrderStatus.BUDGET_REJECTED, [OrderStatus.RECEIVED]],
    [OrderStatus.IN_EXECUTION, [OrderStatus.FINISHED, OrderStatus.CANCELLED]],
    [OrderStatus.FINISHED, [OrderStatus.DELIVERED]],
    [OrderStatus.DELIVERED, []],
    [OrderStatus.CANCELLED, []],
  ]);

  canTransition(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
    const transitions = this.validTransitions.get(currentStatus);
    if (!transitions) {
      return false;
    }

    return transitions.includes(nextStatus);
  }

  validateTransition(
    currentStatus: OrderStatus,
    nextStatus: OrderStatus,
  ): void {
    if (!this.canTransition(currentStatus, nextStatus)) {
      throw new InvalidStatusTransitionException(currentStatus, nextStatus);
    }
  }
}
