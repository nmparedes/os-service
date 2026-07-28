import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager } from "typeorm";
import { ConsumedMessageOrmEntity } from "../../../messaging/consumed-message.orm-entity";
import { TypeOrmConsumedMessageRepository } from "../../../messaging/consumed-message.repository";
import { OrderOrmEntity } from "../../../order/infrastructure/typeorm/order.orm-entity";
import { TypeOrmOrderRepository } from "../../../order/infrastructure/repositories/typeorm-order.repository";
import {
  SagaLocalRepositories,
  SagaLocalUnitOfWork,
} from "../../application/ports/saga-local-unit-of-work";
import { TypeOrmSagaInstanceRepository } from "../repositories/typeorm-saga-instance.repository";
import { SagaInstanceOrmEntity } from "./saga-instance.orm-entity";

@Injectable()
export class TypeOrmSagaLocalUnitOfWork implements SagaLocalUnitOfWork {
  readonly consumedMessages: TypeOrmConsumedMessageRepository;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.consumedMessages = new TypeOrmConsumedMessageRepository(
      dataSource.getRepository(ConsumedMessageOrmEntity),
      this.configService,
    );
  }

  async execute<T>(
    work: (repositories: SagaLocalRepositories) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction((manager) =>
      work(this.repositories(manager)),
    );
  }

  private repositories(manager: EntityManager): SagaLocalRepositories {
    return {
      orders: new TypeOrmOrderRepository(manager.getRepository(OrderOrmEntity)),
      sagas: new TypeOrmSagaInstanceRepository(
        manager.getRepository(SagaInstanceOrmEntity),
      ),
      consumedMessages: new TypeOrmConsumedMessageRepository(
        manager.getRepository(ConsumedMessageOrmEntity),
        this.configService,
      ),
    };
  }
}
