import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from "typeorm";

export class CreateOrdersPersistenceTables1769205000000 implements MigrationInterface {
  name = "CreateOrdersPersistenceTables1769205000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "orders",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          {
            name: "number",
            type: "varchar",
            length: "20",
            isNullable: false,
            isUnique: true,
          },
          {
            name: "status",
            type: "enum",
            enum: [
              "RECEIVED",
              "IN_DIAGNOSIS",
              "WAITING_BUDGET_APPROVAL",
              "BUDGET_APPROVED",
              "BUDGET_REJECTED",
              "IN_EXECUTION",
              "FINISHED",
              "DELIVERED",
              "CANCELLED",
            ],
            default: "'RECEIVED'",
          },
          { name: "customer_id", type: "varchar", length: "36" },
          {
            name: "customer_document",
            type: "varchar",
            length: "20",
            isNullable: true,
          },
          {
            name: "customer_name",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "vehicle_id",
            type: "varchar",
            length: "36",
            isNullable: true,
          },
          {
            name: "vehicle_plate",
            type: "varchar",
            length: "20",
            isNullable: true,
          },
          {
            name: "vehicle_brand",
            type: "varchar",
            length: "100",
            isNullable: true,
          },
          {
            name: "vehicle_model",
            type: "varchar",
            length: "100",
            isNullable: true,
          },
          { name: "vehicle_year", type: "int", isNullable: true },
          { name: "notes", type: "text", isNullable: true },
          {
            name: "total_amount",
            type: "decimal",
            precision: 10,
            scale: 2,
            default: 0,
          },
          { name: "received_at", type: "timestamp" },
          {
            name: "expected_delivery_date",
            type: "timestamp",
            isNullable: true,
          },
          { name: "finished_at", type: "timestamp", isNullable: true },
          { name: "delivered_at", type: "timestamp", isNullable: true },
          { name: "budget_sent_at", type: "timestamp", isNullable: true },
          {
            name: "rejection_reason",
            type: "varchar",
            length: "500",
            isNullable: true,
          },
          {
            name: "cancellation_reason",
            type: "varchar",
            length: "500",
            isNullable: true,
          },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updated_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
            onUpdate: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "orders",
      new TableIndex({
        name: "idx_orders_number",
        columnNames: ["number"],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      "orders",
      new TableIndex({
        name: "idx_orders_customer_id",
        columnNames: ["customer_id"],
      }),
    );
    await queryRunner.createIndex(
      "orders",
      new TableIndex({
        name: "idx_orders_vehicle_id",
        columnNames: ["vehicle_id"],
      }),
    );
    await queryRunner.createIndex(
      "orders",
      new TableIndex({ name: "idx_orders_status", columnNames: ["status"] }),
    );
    await queryRunner.createIndex(
      "orders",
      new TableIndex({
        name: "idx_orders_received_at",
        columnNames: ["received_at"],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "order_service_items",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "order_id", type: "varchar", length: "36" },
          { name: "service_id", type: "varchar", length: "36" },
          { name: "service_name", type: "varchar", length: "255" },
          { name: "quantity", type: "int", default: 1 },
          { name: "unit_price", type: "decimal", precision: 10, scale: 2 },
          { name: "subtotal", type: "decimal", precision: 10, scale: 2 },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "order_service_items",
      new TableIndex({
        name: "idx_order_service_items_order_id",
        columnNames: ["order_id"],
      }),
    );
    await queryRunner.createIndex(
      "order_service_items",
      new TableIndex({
        name: "idx_order_service_items_service_id",
        columnNames: ["service_id"],
      }),
    );
    await queryRunner.createForeignKey(
      "order_service_items",
      new TableForeignKey({
        name: "fk_order_service_items_order_id",
        columnNames: ["order_id"],
        referencedColumnNames: ["id"],
        referencedTableName: "orders",
        onDelete: "CASCADE",
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "order_part_items",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "order_id", type: "varchar", length: "36" },
          { name: "part_id", type: "varchar", length: "36" },
          { name: "part_code", type: "varchar", length: "20" },
          { name: "part_name", type: "varchar", length: "255" },
          { name: "quantity", type: "int" },
          { name: "unit_price", type: "decimal", precision: 10, scale: 2 },
          { name: "subtotal", type: "decimal", precision: 10, scale: 2 },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "order_part_items",
      new TableIndex({
        name: "idx_order_part_items_order_id",
        columnNames: ["order_id"],
      }),
    );
    await queryRunner.createIndex(
      "order_part_items",
      new TableIndex({
        name: "idx_order_part_items_part_id",
        columnNames: ["part_id"],
      }),
    );
    await queryRunner.createForeignKey(
      "order_part_items",
      new TableForeignKey({
        name: "fk_order_part_items_order_id",
        columnNames: ["order_id"],
        referencedColumnNames: ["id"],
        referencedTableName: "orders",
        onDelete: "CASCADE",
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "order_history",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "order_id", type: "varchar", length: "36" },
          {
            name: "status",
            type: "enum",
            enum: [
              "RECEIVED",
              "IN_DIAGNOSIS",
              "WAITING_BUDGET_APPROVAL",
              "BUDGET_APPROVED",
              "BUDGET_REJECTED",
              "IN_EXECUTION",
              "FINISHED",
              "DELIVERED",
              "CANCELLED",
            ],
          },
          { name: "description", type: "varchar", length: "255" },
          { name: "reason", type: "varchar", length: "500", isNullable: true },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "order_history",
      new TableIndex({
        name: "idx_order_history_order_id",
        columnNames: ["order_id"],
      }),
    );
    await queryRunner.createIndex(
      "order_history",
      new TableIndex({
        name: "idx_order_history_status",
        columnNames: ["status"],
      }),
    );
    await queryRunner.createIndex(
      "order_history",
      new TableIndex({
        name: "idx_order_history_created_at",
        columnNames: ["created_at"],
      }),
    );
    await queryRunner.createForeignKey(
      "order_history",
      new TableForeignKey({
        name: "fk_order_history_order_id",
        columnNames: ["order_id"],
        referencedColumnNames: ["id"],
        referencedTableName: "orders",
        onDelete: "CASCADE",
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey(
      "order_history",
      "fk_order_history_order_id",
    );
    await queryRunner.dropIndex(
      "order_history",
      "idx_order_history_created_at",
    );
    await queryRunner.dropIndex("order_history", "idx_order_history_status");
    await queryRunner.dropIndex("order_history", "idx_order_history_order_id");
    await queryRunner.dropTable("order_history");

    await queryRunner.dropForeignKey(
      "order_part_items",
      "fk_order_part_items_order_id",
    );
    await queryRunner.dropIndex(
      "order_part_items",
      "idx_order_part_items_part_id",
    );
    await queryRunner.dropIndex(
      "order_part_items",
      "idx_order_part_items_order_id",
    );
    await queryRunner.dropTable("order_part_items");

    await queryRunner.dropForeignKey(
      "order_service_items",
      "fk_order_service_items_order_id",
    );
    await queryRunner.dropIndex(
      "order_service_items",
      "idx_order_service_items_service_id",
    );
    await queryRunner.dropIndex(
      "order_service_items",
      "idx_order_service_items_order_id",
    );
    await queryRunner.dropTable("order_service_items");

    await queryRunner.dropIndex("orders", "idx_orders_received_at");
    await queryRunner.dropIndex("orders", "idx_orders_status");
    await queryRunner.dropIndex("orders", "idx_orders_vehicle_id");
    await queryRunner.dropIndex("orders", "idx_orders_customer_id");
    await queryRunner.dropIndex("orders", "idx_orders_number");
    await queryRunner.dropTable("orders");
  }
}
