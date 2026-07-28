import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, LessThanOrEqual, QueryFailedError, Repository } from "typeorm";
import { ConsumedMessageOrmEntity } from "./consumed-message.orm-entity";

export interface ConsumedMessageClaim {
  token: string;
}

@Injectable()
export class TypeOrmConsumedMessageRepository {
  constructor(
    @InjectRepository(ConsumedMessageOrmEntity)
    private readonly repository: Repository<ConsumedMessageOrmEntity>,
    private readonly configService: ConfigService,
  ) {}
  async claim(
    consumerName: string,
    eventId: string,
  ): Promise<ConsumedMessageClaim | null> {
    const now = new Date();
    const token = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs());
    try {
      await this.repository.insert({
        consumerName,
        eventId,
        status: "PROCESSING",
        claimToken: token,
        processingStartedAt: now,
        leaseExpiresAt,
        processedAt: null,
      });
      return { token };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    const existing = await this.repository.findOneBy({ consumerName, eventId });
    if (!existing)
      throw new Error("Consumed message was not found after a duplicate key.");
    if (existing.status === "PROCESSED") return null;
    if (
      existing.status === "PROCESSING" &&
      existing.leaseExpiresAt &&
      existing.leaseExpiresAt > now
    )
      throw new Error("Consumed message is already processing.");
    let result = await this.repository.update(
      { consumerName, eventId, status: "FAILED" },
      {
        status: "PROCESSING",
        claimToken: token,
        processingStartedAt: now,
        leaseExpiresAt,
        processedAt: null,
      },
    );
    if (result.affected !== 1 && existing.status === "PROCESSING")
      result = await this.repository.update(
        [
          {
            consumerName,
            eventId,
            status: "PROCESSING",
            leaseExpiresAt: LessThanOrEqual(now),
          },
          {
            consumerName,
            eventId,
            status: "PROCESSING",
            leaseExpiresAt: IsNull(),
          },
        ],
        {
          claimToken: token,
          processingStartedAt: now,
          leaseExpiresAt,
          processedAt: null,
        },
      );
    if (result.affected !== 1)
      throw new Error("Consumed message is already processing.");
    return { token };
  }
  async markProcessed(
    consumerName: string,
    eventId: string,
    token: string,
  ): Promise<void> {
    await this.finish(consumerName, eventId, token, "PROCESSED");
  }
  async markFailed(
    consumerName: string,
    eventId: string,
    token: string,
  ): Promise<void> {
    await this.finish(consumerName, eventId, token, "FAILED");
  }
  private async finish(
    consumerName: string,
    eventId: string,
    token: string,
    status: "PROCESSED" | "FAILED",
  ): Promise<void> {
    const result = await this.repository.update(
      { consumerName, eventId, status: "PROCESSING", claimToken: token },
      {
        status,
        processedAt: status === "PROCESSED" ? new Date() : null,
        claimToken: null,
        processingStartedAt: null,
        leaseExpiresAt: null,
      },
    );
    if (result.affected !== 1)
      throw new Error("Consumed message claim was lost.");
  }
  private leaseDurationMs(): number {
    return this.configService.get<number>("CONSUMED_MESSAGE_LEASE_MS", 300000);
  }
}
function isDuplicateKeyError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driver = error.driverError as { code?: string; errno?: number };
  return driver.code === "ER_DUP_ENTRY" || driver.errno === 1062;
}
