import { randomUUID } from "crypto";
import { Order } from "../../domain/entities/order.entity";
import { OrderItem } from "../../domain/entities/order-item.entity";
import { OrderPart } from "../../domain/entities/order-part.entity";
import { OrderNumber } from "../../domain/value-objects/order-number.value-object";
import { OrderHistoryOrmEntity } from "../typeorm/order-history.orm-entity";
import { OrderOrmEntity } from "../typeorm/order.orm-entity";
import { OrderPartItemOrmEntity } from "../typeorm/order-part-item.orm-entity";
import { OrderServiceItemOrmEntity } from "../typeorm/order-service-item.orm-entity";

export class OrderMapper {
  static toDomain(ormEntity: OrderOrmEntity): Order {
    return Order.restore({
      id: ormEntity.id,
      number: OrderNumber.fromString(ormEntity.number),
      status: ormEntity.status,
      customerId: ormEntity.customer_id,
      customerDocument: ormEntity.customer_document ?? undefined,
      customerName: ormEntity.customer_name ?? undefined,
      vehicleId: ormEntity.vehicle_id ?? undefined,
      vehiclePlate: ormEntity.vehicle_plate ?? undefined,
      vehicleBrand: ormEntity.vehicle_brand ?? undefined,
      vehicleModel: ormEntity.vehicle_model ?? undefined,
      vehicleYear: ormEntity.vehicle_year ?? undefined,
      notes: ormEntity.notes ?? undefined,
      expectedDeliveryDate: ormEntity.expected_delivery_date ?? undefined,
      receivedAt: ormEntity.received_at,
      finishedAt: ormEntity.finished_at ?? undefined,
      deliveredAt: ormEntity.delivered_at ?? undefined,
      budgetSentAt: ormEntity.budget_sent_at ?? undefined,
      serviceItems: (ormEntity.service_items ?? []).map((item) =>
        OrderItem.create({
          id: item.id,
          orderId: item.order_id,
          serviceCatalogItemId: item.service_id,
          serviceName: item.service_name,
          quantity: item.quantity,
          unitPrice:
            typeof item.unit_price === "string"
              ? Number(item.unit_price)
              : item.unit_price,
          createdAt: item.created_at,
        }),
      ),
      partItems: (ormEntity.part_items ?? []).map((item) =>
        OrderPart.create({
          id: item.id,
          orderId: item.order_id,
          partId: item.part_id,
          partCode: item.part_code,
          partName: item.part_name,
          quantity: item.quantity,
          unitPrice:
            typeof item.unit_price === "string"
              ? Number(item.unit_price)
              : item.unit_price,
          createdAt: item.created_at,
        }),
      ),
      totalAmount:
        typeof ormEntity.total_amount === "string"
          ? Number(ormEntity.total_amount)
          : ormEntity.total_amount,
      rejectionReason: ormEntity.rejection_reason ?? undefined,
      cancellationReason: ormEntity.cancellation_reason ?? undefined,
      createdAt: ormEntity.created_at,
      updatedAt: ormEntity.updated_at,
    });
  }

  static toOrmEntity(order: Order): OrderOrmEntity {
    const ormEntity = new OrderOrmEntity();

    ormEntity.id = order.id;
    ormEntity.number = order.number.value;
    ormEntity.status = order.status;
    ormEntity.customer_id = order.customerId;
    ormEntity.customer_document = order.customerDocument ?? null;
    ormEntity.customer_name = order.customerName ?? null;
    ormEntity.vehicle_id = order.vehicleId ?? null;
    ormEntity.vehicle_plate = order.vehiclePlate ?? null;
    ormEntity.vehicle_brand = order.vehicleBrand ?? null;
    ormEntity.vehicle_model = order.vehicleModel ?? null;
    ormEntity.vehicle_year = order.vehicleYear ?? null;
    ormEntity.notes = order.notes ?? null;
    ormEntity.total_amount = order.totalAmount;
    ormEntity.received_at = order.receivedAt;
    ormEntity.expected_delivery_date = order.expectedDeliveryDate ?? null;
    ormEntity.finished_at = order.finishedAt ?? null;
    ormEntity.delivered_at = order.deliveredAt ?? null;
    ormEntity.budget_sent_at = order.budgetSentAt ?? null;
    ormEntity.rejection_reason = order.rejectionReason ?? null;
    ormEntity.cancellation_reason = order.cancellationReason ?? null;
    ormEntity.created_at = order.createdAt;
    ormEntity.updated_at = order.updatedAt;
    ormEntity.service_items = order.serviceItems.map((item) => {
      const serviceItem = new OrderServiceItemOrmEntity();
      serviceItem.id = item.id;
      serviceItem.order_id = order.id;
      serviceItem.service_id = item.serviceCatalogItemId;
      serviceItem.service_name = item.serviceName;
      serviceItem.quantity = item.quantity;
      serviceItem.unit_price = item.unitPrice;
      serviceItem.subtotal = item.subtotal;
      serviceItem.created_at = item.createdAt;
      return serviceItem;
    });
    ormEntity.part_items = order.partItems.map((item) => {
      const partItem = new OrderPartItemOrmEntity();
      partItem.id = item.id;
      partItem.order_id = order.id;
      partItem.part_id = item.partId;
      partItem.part_code = item.partCode;
      partItem.part_name = item.partName;
      partItem.quantity = item.quantity;
      partItem.unit_price = item.unitPrice;
      partItem.subtotal = item.subtotal;
      partItem.created_at = item.createdAt;
      return partItem;
    });
    ormEntity.history_entries = [this.toHistoryEntry(order, ormEntity.id)];

    return ormEntity;
  }

  static toDomainList(ormEntities: OrderOrmEntity[]): Order[] {
    return ormEntities.map((entity) => this.toDomain(entity));
  }

  static toHistoryEntry(order: Order, orderId: string): OrderHistoryOrmEntity {
    const historyEntry = new OrderHistoryOrmEntity();
    historyEntry.id = randomUUID();
    historyEntry.order_id = orderId;
    historyEntry.status = order.status;
    historyEntry.description = order.statusDescription;
    historyEntry.reason =
      order.rejectionReason ?? order.cancellationReason ?? null;
    historyEntry.created_at = order.updatedAt;
    return historyEntry;
  }
}
