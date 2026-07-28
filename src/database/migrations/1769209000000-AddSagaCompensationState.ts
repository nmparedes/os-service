import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSagaCompensationState1769209000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE saga_instances MODIFY completed_at timestamp(3) NULL, MODIFY failed_at timestamp(3) NULL, ADD payment_approved_at timestamp(3) NULL, ADD compensation_trigger json NULL, ADD compensation_started_at timestamp(3) NULL, ADD stock_release_status varchar(30) NOT NULL DEFAULT 'NOT_REQUIRED', ADD payment_refund_status varchar(30) NOT NULL DEFAULT 'NOT_REQUIRED', ADD stock_release_command json NULL, ADD payment_refund_command json NULL, ADD stock_release_result json NULL, ADD payment_refund_result json NULL, ADD compensation_failure_code varchar(100) NULL",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE saga_instances DROP COLUMN compensation_failure_code, DROP COLUMN payment_refund_result, DROP COLUMN stock_release_result, DROP COLUMN payment_refund_command, DROP COLUMN stock_release_command, DROP COLUMN payment_refund_status, DROP COLUMN stock_release_status, DROP COLUMN compensation_started_at, DROP COLUMN compensation_trigger, DROP COLUMN payment_approved_at, MODIFY completed_at timestamp NULL, MODIFY failed_at timestamp NULL",
    );
  }
}
