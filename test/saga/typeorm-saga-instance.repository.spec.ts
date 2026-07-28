import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { QueryFailedError, Repository } from "typeorm";
import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import { SagaAlreadyExistsException } from "../../src/saga/domain/exceptions/saga-already-exists.exception";
import { SagaConcurrencyConflictException } from "../../src/saga/domain/exceptions/saga-concurrency-conflict.exception";
import { SagaInstanceMapper } from "../../src/saga/infrastructure/mappers/saga-instance.mapper";
import { TypeOrmSagaInstanceRepository } from "../../src/saga/infrastructure/repositories/typeorm-saga-instance.repository";
import { SagaInstanceOrmEntity } from "../../src/saga/infrastructure/typeorm/saga-instance.orm-entity";

describe("TypeOrmSagaInstanceRepository", () => {
  let sagaRepository: TypeOrmSagaInstanceRepository;
  let ormRepository: jest.Mocked<Repository<SagaInstanceOrmEntity>>;

  beforeEach(async () => {
    ormRepository = {
      insert: jest.fn(),
      findOneBy: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<SagaInstanceOrmEntity>>;
    const module = await Test.createTestingModule({
      providers: [
        TypeOrmSagaInstanceRepository,
        {
          provide: getRepositoryToken(SagaInstanceOrmEntity),
          useValue: ormRepository,
        },
      ],
    }).compile();
    sagaRepository = module.get(TypeOrmSagaInstanceRepository);
  });

  it("creates strictly with insert and reloads the persisted saga", async () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    ormRepository.findOneBy.mockResolvedValue(
      SagaInstanceMapper.toOrm(saga.values),
    );

    await expect(sagaRepository.create(saga)).resolves.toEqual(
      expect.objectContaining({ values: expect.any(Object) }),
    );
    expect(ormRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ sagaId: "saga-001", version: 1 }),
    );
    expect(ormRepository.findOneBy).toHaveBeenCalledWith({
      sagaId: "saga-001",
    });
  });

  it("maps only MySQL duplicate-key errors to a specific uniqueness conflict", async () => {
    const duplicate = new QueryFailedError(
      "insert",
      [],
      Object.assign(
        new Error("Duplicate entry for key 'uq_saga_instances_order_id'"),
        {
          code: "ER_DUP_ENTRY",
          errno: 1062,
        },
      ),
    );
    ormRepository.insert.mockRejectedValue(duplicate);

    await expect(
      sagaRepository.create(SagaInstance.create("order-001", "saga-001")),
    ).rejects.toBeInstanceOf(SagaAlreadyExistsException);

    ormRepository.insert.mockRejectedValue(
      new QueryFailedError(
        "insert",
        [],
        Object.assign(new Error("Duplicate entry for key 'PRIMARY'"), {
          code: "ER_DUP_ENTRY",
          errno: 1062,
        }),
      ),
    );
    await expect(
      sagaRepository.create(SagaInstance.create("order-002", "saga-002")),
    ).rejects.toMatchObject({ code: "SAGA_ID_CONFLICT" });
  });

  it("propagates database errors that are not duplicate-key errors", async () => {
    const unavailable = new QueryFailedError(
      "insert",
      [],
      Object.assign(new Error("connection refused"), {
        code: "ECONNREFUSED",
        errno: 2003,
      }),
    );
    ormRepository.insert.mockRejectedValue(unavailable);

    await expect(
      sagaRepository.create(SagaInstance.create("order-001", "saga-001")),
    ).rejects.toBe(unavailable);
  });

  it("returns null for missing lookups", async () => {
    ormRepository.findOneBy.mockResolvedValue(null);
    await expect(sagaRepository.findById("missing")).resolves.toBeNull();
    await expect(sagaRepository.findByOrderId("missing")).resolves.toBeNull();
  });

  it("uses version compare-and-swap and reloads exactly one increment", async () => {
    const saga = SagaInstance.create("order-001", "saga-001");
    saga.setBudgetId("budget-001");
    const saved = SagaInstance.restore({ ...saga.values, version: 2 });
    ormRepository.update.mockResolvedValue({ affected: 1 } as never);
    ormRepository.findOneBy.mockResolvedValue(
      SagaInstanceMapper.toOrm(saved.values),
    );

    await expect(sagaRepository.save(saga, 1)).resolves.toEqual(saved);
    expect(ormRepository.update).toHaveBeenCalledWith(
      { sagaId: "saga-001", version: 1 },
      expect.objectContaining({ version: 2, budgetId: "budget-001" }),
    );
  });

  it("fails creation when insert succeeds but the persisted saga cannot be reloaded", async () => {
    ormRepository.findOneBy.mockResolvedValue(null);
    await expect(
      sagaRepository.create(SagaInstance.create("order-001", "saga-001")),
    ).rejects.toThrow("not found after creation");
  });

  it("rejects a save when the updated row cannot be reloaded", async () => {
    ormRepository.update.mockResolvedValue({ affected: 1 } as never);
    ormRepository.findOneBy.mockResolvedValue(null);
    await expect(
      sagaRepository.save(SagaInstance.create("order-001", "saga-001"), 1),
    ).rejects.toBeInstanceOf(SagaConcurrencyConflictException);
  });

  it("rejects a lost compare-and-swap without overwriting another worker", async () => {
    ormRepository.update.mockResolvedValue({ affected: 0 } as never);
    await expect(
      sagaRepository.save(SagaInstance.create("order-001", "saga-001"), 1),
    ).rejects.toBeInstanceOf(SagaConcurrencyConflictException);
  });
});
