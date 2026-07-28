import { Test } from "@nestjs/testing";
import { OrderStatus } from "../../../src/order/domain/enums/order-status.enum";
import { OrderController } from "../../../src/order/infrastructure/controllers/order.controller";
import { OrderService } from "../../../src/order/application/services/order.service";

describe("OrderController", () => {
  let controller: OrderController;
  let orderService: jest.Mocked<OrderService>;

  beforeEach(async () => {
    orderService = {
      create: jest.fn(),
      getById: jest.fn(),
      list: jest.fn(),
      associateVehicle: jest.fn(),
      addServiceItem: jest.fn(),
      addPartItem: jest.fn(),
      updateStatus: jest.fn(),
      getHistory: jest.fn(),
      getPublicStatus: jest.fn(),
    } as unknown as jest.Mocked<OrderService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        {
          provide: OrderService,
          useValue: orderService,
        },
      ],
    }).compile();

    controller = moduleRef.get(OrderController);
  });

  it("delegates protected order endpoints to the application service", async () => {
    orderService.create.mockResolvedValue({ id: "order-1" } as never);
    orderService.list.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    });
    orderService.getById.mockResolvedValue({ id: "order-1" } as never);
    orderService.associateVehicle.mockResolvedValue({ id: "order-1" } as never);
    orderService.addServiceItem.mockResolvedValue({ id: "order-1" } as never);
    orderService.addPartItem.mockResolvedValue({ id: "order-1" } as never);
    orderService.updateStatus.mockResolvedValue({
      id: "order-1",
      status: OrderStatus.IN_DIAGNOSIS,
    } as never);
    orderService.getHistory.mockResolvedValue([]);

    await expect(
      controller.create({ customerDocument: "12345678901" }),
    ).resolves.toEqual({ id: "order-1" });
    await expect(
      controller.list({
        page: 1,
        limit: 10,
        orderBy: "createdAt",
        order: "DESC",
      }),
    ).resolves.toMatchObject({
      meta: { total: 0 },
    });
    await expect(controller.getById("order-1")).resolves.toEqual({
      id: "order-1",
    });
    await expect(
      controller.associateVehicle("order-1", { vehicleId: "vehicle-1" }),
    ).resolves.toEqual({ id: "order-1" });
    await expect(
      controller.addServiceItem("order-1", {
        serviceId: "service-1",
        quantity: 1,
      }),
    ).resolves.toEqual({ id: "order-1" });
    await expect(
      controller.addPartItem("order-1", {
        partId: "part-1",
        quantity: 1,
      }),
    ).resolves.toEqual({ id: "order-1" });
    await expect(
      controller.updateStatus("order-1", { status: OrderStatus.IN_DIAGNOSIS }),
    ).resolves.toMatchObject({
      status: OrderStatus.IN_DIAGNOSIS,
    });
    await expect(controller.getHistory("order-1")).resolves.toEqual([]);
  });
});
