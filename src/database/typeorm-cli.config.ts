import "reflect-metadata";
import { DataSource } from "typeorm";
import { CreateOrdersPersistenceTables1769205000000 } from "./migrations/1769205000000-CreateOrdersPersistenceTables";
import { OrderHistoryOrmEntity } from "../order/infrastructure/typeorm/order-history.orm-entity";
import { OrderOrmEntity } from "../order/infrastructure/typeorm/order.orm-entity";
import { OrderPartItemOrmEntity } from "../order/infrastructure/typeorm/order-part-item.orm-entity";
import { OrderServiceItemOrmEntity } from "../order/infrastructure/typeorm/order-service-item.orm-entity";
import { SagaInstanceOrmEntity } from "../saga/infrastructure/typeorm/saga-instance.orm-entity";
import { ConsumedMessageOrmEntity } from "../messaging/consumed-message.orm-entity";
import { CreateSagaPersistenceTables1769207000000 } from "./migrations/1769207000000-CreateSagaPersistenceTables";
import { AddSagaCommandContext1769208000000 } from "./migrations/1769208000000-AddSagaCommandContext";
import { AddSagaCompensationState1769209000000 } from "./migrations/1769209000000-AddSagaCompensationState";

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: string | undefined): boolean {
  return value === "true";
}

const osServiceDataSource = new DataSource({
  type: "mysql",
  host: process.env.DB_HOST ?? "localhost",
  port: readNumber(process.env.DB_PORT, 3306),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: readBoolean(process.env.DB_SSL) ? { rejectUnauthorized: true } : false,
  synchronize: false,
  logging: false,
  entities: [
    OrderOrmEntity,
    OrderServiceItemOrmEntity,
    OrderPartItemOrmEntity,
    OrderHistoryOrmEntity,
    SagaInstanceOrmEntity,
    ConsumedMessageOrmEntity,
  ],
  migrations: [
    CreateOrdersPersistenceTables1769205000000,
    CreateSagaPersistenceTables1769207000000,
    AddSagaCommandContext1769208000000,
    AddSagaCompensationState1769209000000,
  ],
});

export default osServiceDataSource;
