import { Test } from "@nestjs/testing";
import { PublicOrderController } from "../../../src/order/infrastructure/controllers/public-order.controller";
import { OrderService } from "../../../src/order/application/services/order.service";

describe("PublicOrderController", () => {
  it("delegates public order status consultation to the application service", async () => {
    const orderService = {
      getPublicStatus: jest.fn().mockResolvedValue({ number: "OS-1" }),
    } as unknown as jest.Mocked<OrderService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicOrderController],
      providers: [
        {
          provide: OrderService,
          useValue: orderService,
        },
      ],
    }).compile();

    const controller = moduleRef.get(PublicOrderController);

    await expect(
      controller.getPublicStatus({
        number: "OS-1",
        customerDocument: "12345678901",
      }),
    ).resolves.toEqual({ number: "OS-1" });
  });
});
