import { QueryFailedError } from "typeorm";
import { TypeOrmConsumedMessageRepository } from "../../src/messaging/consumed-message.repository";

describe("TypeOrmConsumedMessageRepository", () => {
  const config = { get: jest.fn().mockReturnValue(300000) };
  const repository = {
    insert: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
  };
  const subject = new TypeOrmConsumedMessageRepository(
    repository as never,
    config as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it("claims a new message and protects the claim token", async () => {
    repository.insert.mockResolvedValue({});
    await expect(subject.claim("consumer", "event")).resolves.toEqual({
      token: expect.any(String),
    });
    repository.update.mockResolvedValue({ affected: 0 });
    await expect(
      subject.markProcessed("consumer", "event", "old-token"),
    ).rejects.toThrow("lost");
  });

  it("does not reprocess completed messages and recovers failed claims", async () => {
    repository.insert.mockRejectedValue(duplicateError());
    repository.findOneBy.mockResolvedValueOnce({ status: "PROCESSED" });
    await expect(subject.claim("consumer", "event")).resolves.toBeNull();
    repository.findOneBy.mockResolvedValueOnce({ status: "FAILED" });
    repository.update.mockResolvedValue({ affected: 1 });
    await expect(subject.claim("consumer", "event")).resolves.toEqual({
      token: expect.any(String),
    });
  });

  it("recovers an expired lease but rejects an active one", async () => {
    repository.insert.mockRejectedValue(duplicateError());
    repository.findOneBy.mockResolvedValueOnce({
      status: "PROCESSING",
      leaseExpiresAt: new Date(Date.now() - 1),
    });
    repository.update.mockResolvedValue({ affected: 1 });
    await expect(subject.claim("consumer", "event")).resolves.toEqual({
      token: expect.any(String),
    });
    repository.findOneBy.mockResolvedValueOnce({
      status: "PROCESSING",
      leaseExpiresAt: new Date(Date.now() + 10000),
    });
    await expect(subject.claim("consumer", "event")).rejects.toThrow(
      "already processing",
    );
  });

  it("recovers a processing claim with a null lease and clears technical failures", async () => {
    repository.insert.mockRejectedValue(duplicateError());
    repository.findOneBy.mockResolvedValueOnce({
      status: "PROCESSING",
      leaseExpiresAt: null,
    });
    repository.update
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await expect(subject.claim("consumer", "event")).resolves.toEqual({
      token: expect.any(String),
    });
    expect(repository.update).toHaveBeenNthCalledWith(
      2,
      [
        expect.objectContaining({
          consumerName: "consumer",
          eventId: "event",
          status: "PROCESSING",
        }),
        expect.objectContaining({
          consumerName: "consumer",
          eventId: "event",
          status: "PROCESSING",
        }),
      ],
      expect.objectContaining({
        claimToken: expect.any(String),
        processedAt: null,
      }),
    );
  });

  it("marks a failed claim and preserves the original error when markFailed also fails", async () => {
    repository.update.mockResolvedValue({ affected: 1 });

    await expect(
      subject.markFailed("consumer", "event", "token-1"),
    ).resolves.toBeUndefined();

    repository.update.mockResolvedValueOnce({ affected: 0 });
    await expect(
      subject.markProcessed("consumer", "event", "stale-token"),
    ).rejects.toThrow("lost");
  });

  it("propagates non-duplicate MySQL failures and missing duplicate rows", async () => {
    repository.insert.mockRejectedValue(
      new QueryFailedError("insert", [], driverError("ER_NO_SUCH_TABLE")),
    );
    await expect(subject.claim("consumer", "event")).rejects.toBeInstanceOf(
      QueryFailedError,
    );
    repository.insert.mockRejectedValue(duplicateError());
    repository.findOneBy.mockResolvedValue(null);
    await expect(subject.claim("consumer", "event")).rejects.toThrow(
      "not found after a duplicate",
    );

    repository.insert.mockRejectedValue(new Error("connection lost"));
    await expect(subject.claim("consumer", "event")).rejects.toThrow(
      "connection lost",
    );
  });
});

function duplicateError(): QueryFailedError {
  return new QueryFailedError("insert", [], {
    code: "ER_DUP_ENTRY",
    errno: 1062,
  } as unknown as Error);
}

function driverError(code: string): Error {
  return { code } as unknown as Error;
}
