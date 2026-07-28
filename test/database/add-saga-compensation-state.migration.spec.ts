import { AddSagaCompensationState1769209000000 } from "../../src/database/migrations/1769209000000-AddSagaCompensationState";

describe("AddSagaCompensationState1769209000000", () => {
  it("adds conservative compensation columns and removes them on revert", async () => {
    const query = jest.fn();
    const migration = new AddSagaCompensationState1769209000000();

    await migration.up({ query } as never);
    const upSql = String(query.mock.calls[0][0]);
    expect(upSql).toContain("payment_approved_at timestamp(3) NULL");
    expect(upSql).toContain(
      "stock_release_status varchar(30) NOT NULL DEFAULT 'NOT_REQUIRED'",
    );
    expect(upSql).toContain("compensation_trigger json NULL");

    await migration.down({ query } as never);
    expect(String(query.mock.calls[1][0])).toContain(
      "DROP COLUMN payment_approved_at",
    );
  });
});
