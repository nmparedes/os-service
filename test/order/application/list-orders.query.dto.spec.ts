import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { OrderStatus } from "../../../src/order/domain/enums/order-status.enum";
import { ListOrdersQueryDto } from "../../../src/order/application/dto/list-orders.query.dto";

describe("ListOrdersQueryDto", () => {
  it("keeps statuses undefined when the query omits them", () => {
    const dto = plainToInstance(ListOrdersQueryDto, {});

    expect(dto.statuses).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it("normalizes a single status into an array", () => {
    const dto = plainToInstance(ListOrdersQueryDto, {
      statuses: OrderStatus.RECEIVED,
    });

    expect(dto.statuses).toEqual([OrderStatus.RECEIVED]);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it("preserves an explicit status array", () => {
    const dto = plainToInstance(ListOrdersQueryDto, {
      statuses: [OrderStatus.RECEIVED, OrderStatus.CANCELLED],
      page: "2",
      limit: "20",
      minTotalAmount: "100",
      maxTotalAmount: "200",
      orderBy: "createdAt",
      order: "ASC",
    });

    expect(dto.statuses).toEqual([OrderStatus.RECEIVED, OrderStatus.CANCELLED]);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(20);
    expect(dto.minTotalAmount).toBe(100);
    expect(dto.maxTotalAmount).toBe(200);
    expect(validateSync(dto)).toHaveLength(0);
  });
});
