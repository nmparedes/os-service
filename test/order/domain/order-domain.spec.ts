import { DomainException } from "../../../src/common/exceptions/domain.exception";
import { Order } from "../../../src/order/domain/entities/order.entity";
import { OrderItem } from "../../../src/order/domain/entities/order-item.entity";
import { OrderPart } from "../../../src/order/domain/entities/order-part.entity";
import { OrderStatus } from "../../../src/order/domain/enums/order-status.enum";
import { OrderNotEditableException } from "../../../src/order/domain/exceptions/order-not-editable.exception";
import { VehicleNotOwnedByCustomerException } from "../../../src/order/domain/exceptions/vehicle-not-owned-by-customer.exception";
import { OrderNumber } from "../../../src/order/domain/value-objects/order-number.value-object";

describe("Order domain", () => {
  const validCustomerId = "550e8400-e29b-41d4-a716-446655440000";
  const validOrderNumber = OrderNumber.create(new Date("2026-01-18"), 1);

  function createOrder(): Order {
    return Order.create({
      number: validOrderNumber,
      customerId: validCustomerId,
    });
  }

  function createOrderItem(
    orderId: string,
    serviceId = "service-1",
  ): OrderItem {
    return OrderItem.create({
      orderId,
      serviceCatalogItemId: serviceId,
      serviceName: "Oil change",
      quantity: 2,
      unitPrice: 150,
    });
  }

  function createOrderPart(orderId: string, partId = "part-1"): OrderPart {
    return OrderPart.create({
      orderId,
      partId,
      partCode: "BRK-001",
      partName: "Brake Pad",
      quantity: 3,
      unitPrice: 50,
    });
  }

  it("creates an order with default values", () => {
    const order = createOrder();

    expect(order).toBeInstanceOf(Order);
    expect(order.id).toBeDefined();
    expect(order.number).toBe(validOrderNumber);
    expect(order.status).toBe(OrderStatus.RECEIVED);
    expect(order.customerId).toBe(validCustomerId);
    expect(order.receivedAt).toBeInstanceOf(Date);
    expect(order.createdAt).toBeInstanceOf(Date);
    expect(order.updatedAt).toBeInstanceOf(Date);
    expect(order.serviceItems).toEqual([]);
    expect(order.partItems).toEqual([]);
    expect(order.totalAmount).toBe(0);
  });

  it("rejects creation without required data", () => {
    expect(() =>
      Order.create({
        number: null as never,
        customerId: validCustomerId,
      }),
    ).toThrow(DomainException);

    expect(() =>
      Order.create({
        number: validOrderNumber,
        customerId: "   ",
      }),
    ).toThrow(DomainException);
  });

  it("keeps only received and diagnosis orders editable", () => {
    const order = createOrder();
    expect(order.isEditable()).toBe(true);

    order.startDiagnosis();
    expect(order.isEditable()).toBe(true);

    order.associateVehicle("vehicle-1", validCustomerId);
    order.addItem(createOrderItem(order.id));
    order.sendForBudgetApproval();
    expect(order.isEditable()).toBe(false);
  });

  it("updates editable fields while the order is editable", () => {
    const order = createOrder();
    const expectedDeliveryDate = new Date("2026-01-25");

    order.update({
      status: OrderStatus.IN_DIAGNOSIS,
      vehicleId: "vehicle-1",
      customerDocument: "12345678901",
      customerName: "John Doe",
      vehiclePlate: "ABC1D23",
      vehicleBrand: "Toyota",
      vehicleModel: "Corolla",
      vehicleYear: 2023,
      notes: "Engine noise",
      expectedDeliveryDate,
      finishedAt: new Date("2026-01-26"),
      deliveredAt: new Date("2026-01-27"),
    });

    expect(order.status).toBe(OrderStatus.IN_DIAGNOSIS);
    expect(order.vehicleId).toBe("vehicle-1");
    expect(order.customerDocument).toBe("12345678901");
    expect(order.customerName).toBe("John Doe");
    expect(order.vehiclePlate).toBe("ABC1D23");
    expect(order.vehicleBrand).toBe("Toyota");
    expect(order.vehicleModel).toBe("Corolla");
    expect(order.vehicleYear).toBe(2023);
    expect(order.notes).toBe("Engine noise");
    expect(order.expectedDeliveryDate).toBe(expectedDeliveryDate);
    expect(order.finishedAt).toBeInstanceOf(Date);
    expect(order.deliveredAt).toBeInstanceOf(Date);
  });

  it("rejects updates when the order is no longer editable", () => {
    const order = createOrder();
    order.associateVehicle("vehicle-1", validCustomerId);
    order.addItem(createOrderItem(order.id));
    order.sendForBudgetApproval();

    expect(() => order.update({ notes: "cannot change now" })).toThrow(
      DomainException,
    );
  });

  it("associates a vehicle only when it belongs to the customer", () => {
    const order = createOrder();
    order.associateVehicle("vehicle-1", validCustomerId);

    expect(order.vehicleId).toBe("vehicle-1");

    const anotherOrder = createOrder();
    expect(() =>
      anotherOrder.associateVehicle("vehicle-2", "another-customer"),
    ).toThrow(VehicleNotOwnedByCustomerException);
  });

  it("rejects vehicle association when order is not editable", () => {
    const order = createOrder();
    order.associateVehicle("vehicle-1", validCustomerId);
    order.addItem(createOrderItem(order.id));
    order.sendForBudgetApproval();

    expect(() => order.associateVehicle("vehicle-2", validCustomerId)).toThrow(
      OrderNotEditableException,
    );
  });

  it("adds and removes service items without duplicates", () => {
    const order = createOrder();
    const item = createOrderItem(order.id);
    order.addItem(item);

    expect(order.serviceItems).toHaveLength(1);
    expect(order.serviceItems[0]?.serviceName).toBe("Oil change");
    expect(order.serviceSubtotal).toBe(300);
    expect(order.totalAmount).toBe(300);

    expect(() => order.addItem(createOrderItem(order.id))).toThrow(
      DomainException,
    );

    order.removeItem(item.id);
    expect(order.serviceItems).toHaveLength(0);
    expect(order.totalAmount).toBe(0);

    expect(() => order.removeItem(item.id)).toThrow(DomainException);
  });

  it("adds, updates and removes part items without duplicates", () => {
    const order = createOrder();
    const part = createOrderPart(order.id);
    order.addPart(part);

    expect(order.partItems).toHaveLength(1);
    expect(order.partSubtotal).toBe(150);
    expect(order.totalAmount).toBe(150);

    const quantityChange = order.updatePartQuantity(part.id, 5);
    expect(quantityChange).toEqual({
      previousQuantity: 3,
      newQuantity: 5,
    });
    expect(order.partSubtotal).toBe(250);

    expect(() => order.addPart(createOrderPart(order.id))).toThrow(
      DomainException,
    );

    const removed = order.removePart(part.id);
    expect(removed.id).toBe(part.id);
    expect(order.partItems).toHaveLength(0);
    expect(order.totalAmount).toBe(0);

    expect(() => order.updatePartQuantity(part.id, 4)).toThrow(DomainException);
    expect(() => order.removePart(part.id)).toThrow(DomainException);
  });

  it("recalculates total amount from services and parts", () => {
    const order = createOrder();
    order.addItem(createOrderItem(order.id, "service-1"));
    order.addPart(createOrderPart(order.id, "part-1"));

    expect(order.serviceSubtotal).toBe(300);
    expect(order.partSubtotal).toBe(150);
    expect(order.totalAmount).toBe(450);
    expect(order.totalAmountFormatted).toContain("450");
  });

  it("requires vehicle and at least one item before budget approval", () => {
    const order = createOrder();

    expect(() => order.sendForBudgetApproval()).toThrow(DomainException);

    order.associateVehicle("vehicle-1", validCustomerId);
    expect(() => order.sendForBudgetApproval()).toThrow(DomainException);
  });

  it("transitions through the full happy path with English statuses", () => {
    const order = createOrder();

    order.startDiagnosis();
    expect(order.status).toBe(OrderStatus.IN_DIAGNOSIS);

    order.associateVehicle("vehicle-1", validCustomerId);
    order.addItem(createOrderItem(order.id));
    order.addPart(createOrderPart(order.id));
    order.sendForBudgetApproval();
    expect(order.status).toBe(OrderStatus.WAITING_BUDGET_APPROVAL);
    expect(order.budgetSentAt).toBeInstanceOf(Date);

    order.approveBudget();
    expect(order.status).toBe(OrderStatus.BUDGET_APPROVED);

    order.startExecution();
    expect(order.status).toBe(OrderStatus.IN_EXECUTION);

    order.finish();
    expect(order.status).toBe(OrderStatus.FINISHED);
    expect(order.finishedAt).toBeInstanceOf(Date);

    order.deliver();
    expect(order.status).toBe(OrderStatus.DELIVERED);
    expect(order.deliveredAt).toBeInstanceOf(Date);
  });

  it("supports budget rejection and stores the reason", () => {
    const order = createOrder();
    order.startDiagnosis();
    order.associateVehicle("vehicle-1", validCustomerId);
    order.addItem(createOrderItem(order.id));
    order.sendForBudgetApproval();
    order.rejectBudget("Customer declined the budget.");

    expect(order.status).toBe(OrderStatus.BUDGET_REJECTED);
    expect(order.rejectionReason).toBe("Customer declined the budget.");
  });

  it("supports cancellation from allowed statuses and stores the reason", () => {
    const receivedOrder = createOrder();
    receivedOrder.cancel("Customer requested cancellation.");
    expect(receivedOrder.status).toBe(OrderStatus.CANCELLED);
    expect(receivedOrder.cancellationReason).toBe(
      "Customer requested cancellation.",
    );

    const executionOrder = createOrder();
    executionOrder.startDiagnosis();
    executionOrder.associateVehicle("vehicle-1", validCustomerId);
    executionOrder.addItem(createOrderItem(executionOrder.id));
    executionOrder.sendForBudgetApproval();
    executionOrder.approveBudget();
    executionOrder.startExecution();
    executionOrder.cancel("Part unavailable.");

    expect(executionOrder.status).toBe(OrderStatus.CANCELLED);
  });

  it("rejects invalid state transitions", () => {
    const order = createOrder();

    expect(() => order.approveBudget()).toThrow(DomainException);
    expect(() => order.rejectBudget()).toThrow(DomainException);
    expect(() => order.startExecution()).toThrow(DomainException);
    expect(() => order.finish()).toThrow(DomainException);
    expect(() => order.deliver()).toThrow(DomainException);

    order.cancel();
    expect(() => order.cancel("again")).toThrow(DomainException);
  });

  it("exposes English status descriptions and next steps", () => {
    const order = createOrder();
    expect(order.statusDescription).toBe("Order received");
    expect(order.nextStepDescription).toBe("Vehicle is waiting for diagnosis.");

    order.startDiagnosis();
    expect(order.statusDescription).toBe("In diagnosis");
    expect(order.nextStepDescription).toBe("Diagnosis is in progress.");
  });
});
