import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { OrderStatus } from "../../domain/enums/order-status.enum";
import { OrderHistoryOrmEntity } from "./order-history.orm-entity";
import { OrderPartItemOrmEntity } from "./order-part-item.orm-entity";
import { OrderServiceItemOrmEntity } from "./order-service-item.orm-entity";

@Entity("orders")
@Index("idx_orders_number", ["number"], { unique: true })
@Index("idx_orders_customer_id", ["customer_id"])
@Index("idx_orders_vehicle_id", ["vehicle_id"])
@Index("idx_orders_status", ["status"])
@Index("idx_orders_received_at", ["received_at"])
export class OrderOrmEntity {
  @PrimaryColumn("varchar", { length: 36 })
  id: string;

  @Column({ type: "varchar", length: 20, unique: true })
  number: string;

  @Column({
    type: "enum",
    enum: OrderStatus,
    default: OrderStatus.RECEIVED,
  })
  status: OrderStatus;

  @Column({ type: "varchar", length: 36 })
  customer_id: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  customer_document: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  customer_name: string | null;

  @Column({ type: "varchar", length: 36, nullable: true })
  vehicle_id: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  vehicle_plate: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  vehicle_brand: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  vehicle_model: string | null;

  @Column({ type: "int", nullable: true })
  vehicle_year: number | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  total_amount: number;

  @Column({ type: "timestamp" })
  received_at: Date;

  @Column({ type: "timestamp", nullable: true })
  expected_delivery_date: Date | null;

  @Column({ type: "timestamp", nullable: true })
  finished_at: Date | null;

  @Column({ type: "timestamp", nullable: true })
  delivered_at: Date | null;

  @Column({ type: "timestamp", nullable: true })
  budget_sent_at: Date | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  rejection_reason: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  cancellation_reason: string | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at: Date;

  @OneToMany(() => OrderServiceItemOrmEntity, (item) => item.order, {
    cascade: ["insert", "update"],
    eager: true,
  })
  service_items: OrderServiceItemOrmEntity[];

  @OneToMany(() => OrderPartItemOrmEntity, (item) => item.order, {
    cascade: ["insert", "update"],
    eager: true,
  })
  part_items: OrderPartItemOrmEntity[];

  @OneToMany(() => OrderHistoryOrmEntity, (history) => history.order, {
    cascade: ["insert", "update"],
    eager: true,
  })
  history_entries: OrderHistoryOrmEntity[];
}
