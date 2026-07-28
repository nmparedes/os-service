import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { OrderStatus } from "../../domain/enums/order-status.enum";
import { OrderOrmEntity } from "./order.orm-entity";

@Entity("order_history")
@Index("idx_order_history_order_id", ["order_id"])
@Index("idx_order_history_status", ["status"])
@Index("idx_order_history_created_at", ["created_at"])
export class OrderHistoryOrmEntity {
  @PrimaryColumn("varchar", { length: 36 })
  id: string;

  @Column("varchar", { length: 36 })
  order_id: string;

  @Column({
    type: "enum",
    enum: OrderStatus,
  })
  status: OrderStatus;

  @Column("varchar", { length: 255 })
  description: string;

  @Column("varchar", { length: 500, nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at: Date;

  @ManyToOne(() => OrderOrmEntity, (order) => order.history_entries, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "order_id" })
  order: OrderOrmEntity;
}
