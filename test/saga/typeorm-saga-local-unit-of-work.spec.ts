import { TypeOrmSagaLocalUnitOfWork } from "../../src/saga/infrastructure/typeorm/typeorm-saga-local-unit-of-work";

describe("TypeOrmSagaLocalUnitOfWork", () => {
  it("constructs transaction-local adapters and commits through the supplied manager", async () => {
    const manager = { getRepository: jest.fn().mockReturnValue({}) };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({}),
      transaction: jest.fn(async (work) => work(manager)),
    };
    const subject = new TypeOrmSagaLocalUnitOfWork(
      dataSource as never,
      { get: jest.fn().mockReturnValue(300000) } as never,
    );

    const result = await subject.execute(async (repositories) => {
      expect(repositories.orders).toBeDefined();
      expect(repositories.sagas).toBeDefined();
      expect(repositories.consumedMessages).toBeDefined();
      return "committed";
    });

    expect(result).toBe("committed");
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.getRepository).toHaveBeenCalledTimes(3);
  });
});
