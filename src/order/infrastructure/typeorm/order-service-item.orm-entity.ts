import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { OrderOrmEntity } from "./order.orm-entity";

@Entity("order_service_items")
@Index("idx_order_service_items_order_id", ["order_id"])
@Index("idx_order_service_items_service_id", ["service_id"])
export class OrderServiceItemOrmEntity {
  @PrimaryColumn("varchar", { length: 36 })
  id: string;

  @Column("varchar", { length: 36 })
  order_id: string;

  @Column("varchar", { length: 36 })
  service_id: string;

  @Column("varchar", { length: 255 })
  service_name: string;

  @Column("int", { default: 1 })
  quantity: number;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  unit_price: number;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  subtotal: number;

  @CreateDateColumn({ type: "timestamp" })
  created_at: Date;

  @ManyToOne(() => OrderOrmEntity, (order) => order.service_items, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "order_id" })
  order: OrderOrmEntity;
}
