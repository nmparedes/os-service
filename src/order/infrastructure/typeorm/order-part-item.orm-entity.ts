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

@Entity("order_part_items")
@Index("idx_order_part_items_order_id", ["order_id"])
@Index("idx_order_part_items_part_id", ["part_id"])
export class OrderPartItemOrmEntity {
  @PrimaryColumn("varchar", { length: 36 })
  id: string;

  @Column("varchar", { length: 36 })
  order_id: string;

  @Column("varchar", { length: 36 })
  part_id: string;

  @Column("varchar", { length: 20 })
  part_code: string;

  @Column("varchar", { length: 255 })
  part_name: string;

  @Column("int")
  quantity: number;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  unit_price: number;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  subtotal: number;

  @CreateDateColumn({ type: "timestamp" })
  created_at: Date;

  @ManyToOne(() => OrderOrmEntity, (order) => order.part_items, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "order_id" })
  order: OrderOrmEntity;
}
