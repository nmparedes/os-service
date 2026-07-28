import { AddSagaCommandContext1769208000000 } from "../../src/database/migrations/1769208000000-AddSagaCommandContext";

describe("AddSagaCommandContext1769208000000", () => {
  it("backfills deterministic command context columns and removes them on revert", async () => {
    const query = jest.fn();
    const migration = new AddSagaCommandContext1769208000000();
    await migration.up({ query } as never);
    expect(query.mock.calls.join(" ")).toContain("step_occurred_at");
    expect(query.mock.calls.join(" ")).toContain("command_contexts");
    await migration.down({ query } as never);
    expect(query).toHaveBeenLastCalledWith(
      "ALTER TABLE saga_instances DROP COLUMN command_contexts, DROP COLUMN step_occurred_at",
    );
  });
});
