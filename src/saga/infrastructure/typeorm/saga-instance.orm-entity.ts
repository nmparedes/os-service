import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";

@Entity("saga_instances")
@Index("uq_saga_instances_order_id", ["orderId"], { unique: true })
export class SagaInstanceOrmEntity {
  @PrimaryColumn({ name: "saga_id", type: "char", length: 36 }) sagaId: string;
  @Column({ name: "order_id", type: "char", length: 36 }) orderId: string;
  @Column({ type: "varchar", length: 40 }) status: string;
  @Column({ name: "current_step", type: "varchar", length: 50 })
  currentStep: string;
  @Column({ name: "completed_steps", type: "json" }) completedSteps: string[];
  @Column({ name: "budget_id", type: "char", length: 36, nullable: true })
  budgetId: string | null;
  @Column({ name: "payment_id", type: "char", length: 36, nullable: true })
  paymentId: string | null;
  @Column({
    name: "payment_approved_at",
    type: "timestamp",
    precision: 3,
    nullable: true,
  })
  paymentApprovedAt: Date | null;
  @Column({ name: "reserved_parts", type: "json" }) reservedParts: Array<{
    partId: string;
    quantity: number;
  }>;
  @Column({ name: "failed_step", type: "varchar", length: 50, nullable: true })
  failedStep: string | null;
  @Column({
    name: "failure_reason",
    type: "varchar",
    length: 500,
    nullable: true,
  })
  failureReason: string | null;
  @Column({ name: "compensation_status", type: "varchar", length: 30 })
  compensationStatus: string;
  @Column({
    name: "compensation_trigger",
    type: "json",
    nullable: true,
  })
  compensationTrigger: Record<string, unknown> | null;
  @Column({
    name: "compensation_started_at",
    type: "timestamp",
    precision: 3,
    nullable: true,
  })
  compensationStartedAt: Date | null;
  @Column({
    name: "stock_release_status",
    type: "varchar",
    length: 30,
    default: "NOT_REQUIRED",
  })
  stockReleaseStatus: string;
  @Column({
    name: "payment_refund_status",
    type: "varchar",
    length: 30,
    default: "NOT_REQUIRED",
  })
  paymentRefundStatus: string;
  @Column({ name: "stock_release_command", type: "json", nullable: true })
  stockReleaseCommand: Record<string, unknown> | null;
  @Column({ name: "payment_refund_command", type: "json", nullable: true })
  paymentRefundCommand: Record<string, unknown> | null;
  @Column({ name: "stock_release_result", type: "json", nullable: true })
  stockReleaseResult: Record<string, unknown> | null;
  @Column({ name: "payment_refund_result", type: "json", nullable: true })
  paymentRefundResult: Record<string, unknown> | null;
  @Column({
    name: "compensation_failure_code",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  compensationFailureCode: string | null;
  @Column({ name: "step_occurred_at", type: "json" })
  stepOccurredAt: Record<string, string>;
  @Column({ name: "command_contexts", type: "json" })
  commandContexts: Record<
    string,
    { correlationId: string; causationId: string }
  >;
  @VersionColumn() version: number;
  @CreateDateColumn({ name: "created_at", type: "timestamp" }) createdAt: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamp" }) updatedAt: Date;
  @Column({
    name: "completed_at",
    type: "timestamp",
    precision: 3,
    nullable: true,
  })
  completedAt: Date | null;
  @Column({
    name: "failed_at",
    type: "timestamp",
    precision: 3,
    nullable: true,
  })
  failedAt: Date | null;
}
