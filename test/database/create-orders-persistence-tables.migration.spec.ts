import { QueryRunner } from "typeorm";
import { CreateOrdersPersistenceTables1769205000000 } from "../../src/database/migrations/1769205000000-CreateOrdersPersistenceTables";

describe("CreateOrdersPersistenceTables1769205000000", () => {
  it("creates and drops orders persistence tables with local foreign keys only", async () => {
    const migration = new CreateOrdersPersistenceTables1769205000000();
    const queryRunner = {
      createTable: jest.fn(),
      createIndex: jest.fn(),
      createForeignKey: jest.fn(),
      dropForeignKey: jest.fn(),
      dropIndex: jest.fn(),
      dropTable: jest.fn(),
    } as unknown as jest.Mocked<QueryRunner>;

    await migration.up(queryRunner);
    await migration.down(queryRunner);

    expect(migration.name).toBe("CreateOrdersPersistenceTables1769205000000");
    expect(queryRunner.createTable).toHaveBeenCalledTimes(4);
    expect(queryRunner.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "orders" }),
      true,
    );
    expect(queryRunner.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "order_service_items" }),
      true,
    );
    expect(queryRunner.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "order_part_items" }),
      true,
    );
    expect(queryRunner.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "order_history" }),
      true,
    );
    expect(queryRunner.createForeignKey).toHaveBeenCalledTimes(3);
    expect(queryRunner.dropTable).toHaveBeenCalledWith("order_history");
    expect(queryRunner.dropTable).toHaveBeenCalledWith("order_part_items");
    expect(queryRunner.dropTable).toHaveBeenCalledWith("order_service_items");
    expect(queryRunner.dropTable).toHaveBeenCalledWith("orders");
  });
});
