import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Repository } from "typeorm";
import { Order } from "../../../src/order/domain/entities/order.entity";
import { TypeOrmOrderRepository } from "../../../src/order/infrastructure/repositories/typeorm-order.repository";
import { OrderMapper } from "../../../src/order/infrastructure/mappers/order.mapper";
import { OrderStatus } from "../../../src/order/domain/enums/order-status.enum";
import { OrderOrmEntity } from "../../../src/order/infrastructure/typeorm/order.orm-entity";
import { createOrder } from "../order.factory";

describe("TypeOrmOrderRepository", () => {
  let repository: TypeOrmOrderRepository;
  let ormRepository: jest.Mocked<Repository<OrderOrmEntity>>;
  let queryBuilder: {
    where: jest.Mock;
    orderBy: jest.Mock;
    getOne: jest.Mock;
    leftJoinAndSelect: jest.Mock;
    distinct: jest.Mock;
    andWhere: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  };

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    ormRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as jest.Mocked<Repository<OrderOrmEntity>>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        TypeOrmOrderRepository,
        {
          provide: getRepositoryToken(OrderOrmEntity),
          useValue: ormRepository,
        },
      ],
    }).compile();

    repository = moduleRef.get(TypeOrmOrderRepository);
  });

  it("saves orders with local snapshots", async () => {
    const order = createOrder();
    ormRepository.findOne.mockResolvedValue(null);
    ormRepository.save.mockResolvedValue(OrderMapper.toOrmEntity(order));

    const result = await repository.save(order);

    expect(ormRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "order-1",
        customer_document: "12345678901",
        customer_name: "John Doe",
        vehicle_plate: "ABC1D23",
      }),
    );
    expect(result).toBeInstanceOf(Order);
  });

  it("finds orders by id and number with local relations only", async () => {
    const order = createOrder();
    ormRepository.findOne.mockResolvedValue(OrderMapper.toOrmEntity(order));

    await expect(repository.findById("order-1")).resolves.toBeInstanceOf(Order);
    await expect(
      repository.findByNumber("OS-20260118-0001"),
    ).resolves.toBeInstanceOf(Order);

    expect(ormRepository.findOne).toHaveBeenCalledWith({
      where: { id: "order-1" },
      relations: {
        service_items: true,
        part_items: true,
        history_entries: true,
      },
    });
    expect(ormRepository.findOne).toHaveBeenCalledWith({
      where: { number: "OS-20260118-0001" },
      relations: {
        service_items: true,
        part_items: true,
        history_entries: true,
      },
    });
  });

  it("returns null when the order does not exist", async () => {
    ormRepository.findOne.mockResolvedValue(null);

    await expect(repository.findById("missing")).resolves.toBeNull();
    await expect(repository.findByNumber("missing")).resolves.toBeNull();
  });

  it("appends a new history entry when the order status changes", async () => {
    const existingOrder = createOrder({ status: OrderStatus.RECEIVED });
    const updatedOrder = createOrder({
      status: OrderStatus.IN_DIAGNOSIS,
      updatedAt: new Date("2026-01-18T15:00:00.000Z"),
    });
    const existingEntity = OrderMapper.toOrmEntity(existingOrder);
    ormRepository.findOne
      .mockResolvedValueOnce(existingEntity)
      .mockResolvedValueOnce(null);
    ormRepository.save.mockResolvedValue(OrderMapper.toOrmEntity(updatedOrder));

    await repository.save(updatedOrder);

    expect(ormRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        history_entries: expect.arrayContaining([
          expect.objectContaining({ status: OrderStatus.RECEIVED }),
          expect.objectContaining({ status: OrderStatus.IN_DIAGNOSIS }),
        ]),
      }),
    );
  });

  it("computes the next daily sequence from the latest order number", async () => {
    queryBuilder.getOne.mockResolvedValue({
      number: "OS-20260118-0009",
    });

    const sequence = await repository.getNextSequenceForDate(
      new Date("2026-01-18T10:00:00.000Z"),
    );

    expect(sequence).toBe(10);
    expect(ormRepository.createQueryBuilder).toHaveBeenCalledWith("order");
  });

  it("starts a daily sequence at one when there is no order for the given date", async () => {
    queryBuilder.getOne.mockResolvedValue(null);

    await expect(
      repository.getNextSequenceForDate(new Date("2026-01-19T10:00:00.000Z")),
    ).resolves.toBe(1);
  });

  it("returns local history entries ordered by creation time", async () => {
    const order = createOrder();
    const ormEntity = OrderMapper.toOrmEntity(order);
    ormEntity.history_entries = [
      {
        ...ormEntity.history_entries[0],
        id: "history-2",
        status: OrderStatus.IN_DIAGNOSIS,
        created_at: new Date("2026-01-18T15:00:00.000Z"),
      },
      {
        ...ormEntity.history_entries[0],
        id: "history-1",
        status: OrderStatus.RECEIVED,
        created_at: new Date("2026-01-18T14:00:00.000Z"),
      },
    ];
    ormRepository.findOne.mockResolvedValue(ormEntity);

    await expect(repository.findHistoryByOrderId("order-1")).resolves.toEqual([
      expect.objectContaining({
        id: "history-1",
        status: OrderStatus.RECEIVED,
      }),
      expect.objectContaining({
        id: "history-2",
        status: OrderStatus.IN_DIAGNOSIS,
      }),
    ]);
  });

  it("applies list filters and pagination through the local query builder", async () => {
    const order = createOrder();
    queryBuilder.getManyAndCount.mockResolvedValue([
      [OrderMapper.toOrmEntity(order)],
      1,
    ]);

    const result = await repository.findAll({
      number: "OS-20260118",
      statuses: [OrderStatus.RECEIVED],
      customerId: "customer-1",
      customerDocument: "12345678901",
      customerName: "john",
      vehicleId: "vehicle-1",
      vehiclePlate: "abc1d23",
      receivedAtFrom: new Date("2026-01-01T00:00:00.000Z"),
      receivedAtTo: new Date("2026-01-31T23:59:59.999Z"),
      finishedAtFrom: new Date("2026-01-01T00:00:00.000Z"),
      finishedAtTo: new Date("2026-01-31T23:59:59.999Z"),
      minTotalAmount: 100,
      maxTotalAmount: 1000,
      page: 2,
      limit: 5,
      orderBy: "createdAt",
      order: "DESC",
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(13);
    expect(queryBuilder.skip).toHaveBeenCalledWith(5);
    expect(queryBuilder.take).toHaveBeenCalledWith(5);
    expect(result.meta).toMatchObject({
      total: 1,
      page: 2,
      limit: 5,
    });
    expect(result.data[0]).toBeInstanceOf(Order);
  });
});
