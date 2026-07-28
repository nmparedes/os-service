import { Order } from "../../../src/order/domain/entities/order.entity";
import { OrderMapper } from "../../../src/order/infrastructure/mappers/order.mapper";
import { createOrder, createOrderOrmEntity } from "../order.factory";

describe("OrderMapper", () => {
  it("maps domain orders to ORM entities with snapshots", () => {
    const order = createOrder();

    const ormEntity = OrderMapper.toOrmEntity(order);

    expect(ormEntity).toMatchObject({
      id: order.id,
      number: order.number.value,
      customer_id: order.customerId,
      customer_document: order.customerDocument,
      customer_name: order.customerName,
      vehicle_id: order.vehicleId,
      vehicle_plate: order.vehiclePlate,
      vehicle_brand: order.vehicleBrand,
      vehicle_model: order.vehicleModel,
      vehicle_year: order.vehicleYear,
      total_amount: order.totalAmount,
    });
    expect(ormEntity.service_items).toHaveLength(1);
    expect(ormEntity.service_items[0]).toMatchObject({
      service_id: "service-1",
      service_name: "Oil change",
    });
    expect(ormEntity.part_items).toHaveLength(1);
    expect(ormEntity.part_items[0]).toMatchObject({
      part_id: "part-1",
      part_code: "BRK-001",
      part_name: "Brake Pad",
    });
    expect(ormEntity.history_entries).toHaveLength(1);
  });

  it("maps ORM entities back to domain orders", () => {
    const ormEntity = createOrderOrmEntity();

    const order = OrderMapper.toDomain(ormEntity);

    expect(order).toBeInstanceOf(Order);
    expect(order.id).toBe("order-1");
    expect(order.customerDocument).toBe("12345678901");
    expect(order.customerName).toBe("John Doe");
    expect(order.vehiclePlate).toBe("ABC1D23");
    expect(order.serviceItems[0]?.serviceName).toBe("Oil change");
    expect(order.partItems[0]?.partCode).toBe("BRK-001");
    expect(order.totalAmount).toBe(450);
  });

  it("maps persisted string decimals and nullable snapshots back to the domain", () => {
    const ormEntity = createOrderOrmEntity({
      customer_document: null,
      customer_name: null,
      vehicle_id: null,
      vehicle_plate: null,
      vehicle_brand: null,
      vehicle_model: null,
      vehicle_year: null,
      total_amount: "450.00" as never,
      service_items: [
        {
          ...createOrderOrmEntity().service_items[0],
          unit_price: "150.00" as never,
        },
      ],
      part_items: [
        {
          ...createOrderOrmEntity().part_items[0],
          unit_price: "50.00" as never,
        },
      ],
    });

    const order = OrderMapper.toDomain(ormEntity);

    expect(order.customerDocument).toBeUndefined();
    expect(order.customerName).toBeUndefined();
    expect(order.vehicleId).toBeUndefined();
    expect(order.vehiclePlate).toBeUndefined();
    expect(order.vehicleBrand).toBeUndefined();
    expect(order.vehicleModel).toBeUndefined();
    expect(order.vehicleYear).toBeUndefined();
    expect(order.totalAmount).toBe(450);
    expect(order.serviceItems[0]?.unitPrice).toBe(150);
    expect(order.partItems[0]?.unitPrice).toBe(50);
  });

  it("maps lists of ORM entities to domain orders", () => {
    const orders = OrderMapper.toDomainList([createOrderOrmEntity()]);

    expect(orders).toHaveLength(1);
    expect(orders[0]).toBeInstanceOf(Order);
  });
});
