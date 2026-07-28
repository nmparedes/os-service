import { OrderStatus } from "../../../src/order/domain/enums/order-status.enum";
import { InvalidStatusTransitionException } from "../../../src/order/domain/exceptions/invalid-status-transition.exception";
import { OrderStatusTransitionService } from "../../../src/order/domain/services/order-status-transition.service";

describe("OrderStatusTransitionService", () => {
  const service = new OrderStatusTransitionService();

  it("allows valid transitions", () => {
    expect(
      service.canTransition(OrderStatus.RECEIVED, OrderStatus.IN_DIAGNOSIS),
    ).toBe(true);
    expect(
      service.canTransition(
        OrderStatus.WAITING_BUDGET_APPROVAL,
        OrderStatus.BUDGET_APPROVED,
      ),
    ).toBe(true);
    expect(
      service.canTransition(OrderStatus.FINISHED, OrderStatus.DELIVERED),
    ).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(
      service.canTransition(OrderStatus.RECEIVED, OrderStatus.DELIVERED),
    ).toBe(false);
    expect(
      service.canTransition(OrderStatus.CANCELLED, OrderStatus.RECEIVED),
    ).toBe(false);
  });

  it("returns false when the current status has no transition map entry", () => {
    expect(
      service.canTransition("UNKNOWN" as OrderStatus, OrderStatus.RECEIVED),
    ).toBe(false);
  });

  it("throws for invalid transition validation", () => {
    expect(() =>
      service.validateTransition(OrderStatus.RECEIVED, OrderStatus.DELIVERED),
    ).toThrow(InvalidStatusTransitionException);
  });
});
