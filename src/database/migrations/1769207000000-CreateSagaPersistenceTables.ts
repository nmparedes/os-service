import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSagaPersistenceTables1769207000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE saga_instances (saga_id char(36) NOT NULL, order_id char(36) NOT NULL, status varchar(40) NOT NULL, current_step varchar(50) NOT NULL, completed_steps json NOT NULL, budget_id char(36) NULL, payment_id char(36) NULL, reserved_parts json NOT NULL, failed_step varchar(50) NULL, failure_reason varchar(500) NULL, compensation_status varchar(30) NOT NULL, version int NOT NULL DEFAULT 1, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, completed_at timestamp NULL, failed_at timestamp NULL, PRIMARY KEY (saga_id), UNIQUE KEY uq_saga_instances_order_id (order_id)) ENGINE=InnoDB",
    );
    await queryRunner.query(
      "CREATE TABLE consumed_messages (id char(36) NOT NULL, consumer_name varchar(100) NOT NULL, event_id varchar(64) NOT NULL, status varchar(20) NOT NULL, claim_token varchar(36) NULL, processing_started_at timestamp NULL, lease_expires_at timestamp NULL, processed_at timestamp NULL, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_consumed_messages_consumer_event (consumer_name, event_id)) ENGINE=InnoDB",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE consumed_messages");
    await queryRunner.query("DROP TABLE saga_instances");
  }
}
