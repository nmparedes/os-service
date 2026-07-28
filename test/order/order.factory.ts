import { Order } from "../../src/order/domain/entities/order.entity";
import { OrderItem } from "../../src/order/domain/entities/order-item.entity";
import { OrderPart } from "../../src/order/domain/entities/order-part.entity";
import { OrderStatus } from "../../src/order/domain/enums/order-status.enum";
import { OrderMapper } from "../../src/order/infrastructure/mappers/order.mapper";
import { OrderOrmEntity } from "../../src/order/infrastructure/typeorm/order.orm-entity";
import { OrderNumber } from "../../src/order/domain/value-objects/order-number.value-object";

export function createOrder(
  overrides: Partial<{
    id: string;
    status: OrderStatus;
    customerId: string;
    customerDocument: string;
    customerName: string;
    vehicleId: string;
    vehiclePlate: string;
    vehicleBrand: string;
    vehicleModel: string;
    vehicleYear: number;
    notes: string;
    receivedAt: Date;
    expectedDeliveryDate: Date;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
): Order {
  return Order.restore({
    id: overrides.id ?? "order-1",
    number: OrderNumber.fromString("OS-20260118-0001"),
    status: overrides.status ?? OrderStatus.RECEIVED,
    customerId: overrides.customerId ?? "customer-1",
    customerDocument: overrides.customerDocument ?? "12345678901",
    customerName: overrides.customerName ?? "John Doe",
    vehicleId: overrides.vehicleId ?? "vehicle-1",
    vehiclePlate: overrides.vehiclePlate ?? "ABC1D23",
    vehicleBrand: overrides.vehicleBrand ?? "Toyota",
    vehicleModel: overrides.vehicleModel ?? "Corolla",
    vehicleYear: overrides.vehicleYear ?? 2023,
    notes: overrides.notes ?? "Check engine light is on",
    receivedAt: overrides.receivedAt ?? new Date("2026-01-18T12:00:00.000Z"),
    expectedDeliveryDate:
      overrides.expectedDeliveryDate ?? new Date("2026-01-22T12:00:00.000Z"),
    serviceItems: [
      OrderItem.create({
        id: "service-item-1",
        orderId: overrides.id ?? "order-1",
        serviceCatalogItemId: "service-1",
        serviceName: "Oil change",
        quantity: 2,
        unitPrice: 150,
        createdAt: new Date("2026-01-18T13:00:00.000Z"),
      }),
    ],
    partItems: [
      OrderPart.create({
        id: "part-item-1",
        orderId: overrides.id ?? "order-1",
        partId: "part-1",
        partCode: "BRK-001",
        partName: "Brake Pad",
        quantity: 3,
        unitPrice: 50,
        createdAt: new Date("2026-01-18T13:00:00.000Z"),
      }),
    ],
    totalAmount: 450,
    createdAt: overrides.createdAt ?? new Date("2026-01-18T12:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-18T14:00:00.000Z"),
  });
}

export function createOrderOrmEntity(
  overrides: Partial<OrderOrmEntity> = {},
): OrderOrmEntity {
  const ormEntity = OrderMapper.toOrmEntity(createOrder());
  return Object.assign(ormEntity, overrides);
}
