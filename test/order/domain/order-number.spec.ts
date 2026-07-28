import { DomainException } from "../../../src/common/exceptions/domain.exception";
import { OrderNumber } from "../../../src/order/domain/value-objects/order-number.value-object";

describe("OrderNumber", () => {
  it("creates a valid order number", () => {
    const orderNumber = OrderNumber.create(
      new Date("2026-01-18T12:00:00.000Z"),
      1,
    );

    expect(orderNumber.value).toBe("OS-20260118-0001");
    expect(orderNumber.format()).toBe("OS-20260118-0001");
    expect(orderNumber.toString()).toBe("OS-20260118-0001");
  });

  it("creates an instance from a valid string", () => {
    const orderNumber = OrderNumber.fromString("OS-20260118-0007");

    expect(orderNumber.value).toBe("OS-20260118-0007");
  });

  it("compares equality by value", () => {
    const first = OrderNumber.fromString("OS-20260118-0002");
    const second = OrderNumber.fromString("OS-20260118-0002");

    expect(first.equals(second)).toBe(true);
  });

  it("rejects invalid dates", () => {
    expect(() => OrderNumber.create(new Date("invalid-date"), 1)).toThrow(
      DomainException,
    );
  });

  it("rejects invalid sequences", () => {
    expect(() =>
      OrderNumber.create(new Date("2026-01-18T12:00:00.000Z"), 0),
    ).toThrow(DomainException);
  });

  it("rejects invalid strings", () => {
    expect(() => OrderNumber.fromString("invalid")).toThrow(DomainException);
    expect(OrderNumber.isValid("invalid")).toBe(false);
  });
});
