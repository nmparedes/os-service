import { CreateSagaPersistenceTables1769207000000 } from "../../src/database/migrations/1769207000000-CreateSagaPersistenceTables";

describe("CreateSagaPersistenceTables1769207000000", () => {
  it("creates and drops saga and consumed-message tables", async () => {
    const query = jest.fn();
    const migration = new CreateSagaPersistenceTables1769207000000();
    await migration.up({ query } as never);
    expect(query.mock.calls.join(" ")).toContain("saga_instances");
    expect(query.mock.calls.join(" ")).toContain("consumed_messages");
    await migration.down({ query } as never);
    expect(query).toHaveBeenLastCalledWith("DROP TABLE saga_instances");
  });
});
