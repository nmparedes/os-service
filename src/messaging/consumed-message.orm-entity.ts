import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("consumed_messages")
@Index("uq_consumed_messages_consumer_event", ["consumerName", "eventId"], {
  unique: true,
})
export class ConsumedMessageOrmEntity {
  @PrimaryGeneratedColumn("uuid") id: string;
  @Column({ name: "consumer_name", type: "varchar", length: 100 })
  consumerName: string;
  @Column({ name: "event_id", type: "varchar", length: 64 }) eventId: string;
  @Column({ type: "varchar", length: 20 }) status:
    "PROCESSING" | "PROCESSED" | "FAILED";
  @Column({ name: "claim_token", type: "varchar", length: 36, nullable: true })
  claimToken: string | null;
  @Column({ name: "processing_started_at", type: "timestamp", nullable: true })
  processingStartedAt: Date | null;
  @Column({ name: "lease_expires_at", type: "timestamp", nullable: true })
  leaseExpiresAt: Date | null;
  @Column({ name: "processed_at", type: "timestamp", nullable: true })
  processedAt: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamp" }) createdAt: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamp" }) updatedAt: Date;
}
