import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { SagaConcurrencyConflictException } from "../../domain/exceptions/saga-concurrency-conflict.exception";
import { SagaAlreadyExistsException } from "../../domain/exceptions/saga-already-exists.exception";
import { SagaInstance } from "../../domain/saga-instance.entity";
import { SagaInstanceRepository } from "../../domain/repositories/saga-instance.repository.interface";
import { SagaInstanceMapper } from "../mappers/saga-instance.mapper";
import { SagaInstanceOrmEntity } from "../typeorm/saga-instance.orm-entity";
@Injectable()
export class TypeOrmSagaInstanceRepository implements SagaInstanceRepository {
  constructor(
    @InjectRepository(SagaInstanceOrmEntity)
    private readonly repository: Repository<SagaInstanceOrmEntity>,
  ) {}
  async create(saga: SagaInstance): Promise<SagaInstance> {
    try {
      await this.repository.insert(
        SagaInstanceMapper.toOrm(
          saga.values,
        ) as QueryDeepPartialEntity<SagaInstanceOrmEntity>,
      );
    } catch (error) {
      if (isMysqlDuplicateEntry(error)) {
        throw new SagaAlreadyExistsException(duplicateField(error));
      }
      throw error;
    }
    const created = await this.findById(saga.values.sagaId);
    if (!created) throw new Error("Saga was not found after creation.");
    return created;
  }
  async findById(sagaId: string): Promise<SagaInstance | null> {
    const entity = await this.repository.findOneBy({ sagaId });
    return entity ? SagaInstanceMapper.toDomain(entity) : null;
  }
  async findByOrderId(orderId: string): Promise<SagaInstance | null> {
    const entity = await this.repository.findOneBy({ orderId });
    return entity ? SagaInstanceMapper.toDomain(entity) : null;
  }
  async save(
    saga: SagaInstance,
    expectedVersion: number,
  ): Promise<SagaInstance> {
    const values = saga.values;
    const mapped = SagaInstanceMapper.toOrm(values);
    const {
      sagaId: omittedSagaId,
      createdAt: omittedCreatedAt,
      version: omittedVersion,
      ...changes
    } = mapped;
    void omittedSagaId;
    void omittedCreatedAt;
    void omittedVersion;
    const result = await this.repository.update(
      { sagaId: values.sagaId, version: expectedVersion },
      {
        ...changes,
        version: expectedVersion + 1,
      } as QueryDeepPartialEntity<SagaInstanceOrmEntity>,
    );
    if (result.affected !== 1)
      throw new SagaConcurrencyConflictException(values.sagaId);
    const saved = await this.findById(values.sagaId);
    if (!saved) throw new SagaConcurrencyConflictException(values.sagaId);
    return saved;
  }
}

function isMysqlDuplicateEntry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const driverError = "driverError" in error ? error.driverError : error;
  if (!driverError || typeof driverError !== "object") return false;
  const candidate = driverError as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

function duplicateField(error: unknown): "sagaId" | "orderId" {
  const driverError =
    error && typeof error === "object" && "driverError" in error
      ? error.driverError
      : error;
  const message =
    driverError && typeof driverError === "object" && "message" in driverError
      ? String(driverError.message)
      : "";
  return message.includes("uq_saga_instances_order_id") ? "orderId" : "sagaId";
}
