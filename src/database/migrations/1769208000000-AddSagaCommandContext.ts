import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSagaCommandContext1769208000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE saga_instances ADD step_occurred_at json NULL, ADD command_contexts json NULL",
    );
    await queryRunner.query(
      "UPDATE saga_instances SET step_occurred_at = JSON_OBJECT(current_step, updated_at), command_contexts = JSON_OBJECT() WHERE step_occurred_at IS NULL OR command_contexts IS NULL",
    );
    await queryRunner.query(
      "ALTER TABLE saga_instances MODIFY step_occurred_at json NOT NULL, MODIFY command_contexts json NOT NULL",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE saga_instances DROP COLUMN command_contexts, DROP COLUMN step_occurred_at",
    );
  }
}
