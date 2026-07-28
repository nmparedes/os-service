import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MessagingModule } from "../messaging/rabbitmq-broker";
import { PrometheusOrderFlowMetrics } from "../common/metrics/prometheus-order-flow-metrics";
import { SagaOrchestratorService } from "./application/saga-orchestrator.service";
import { ORDER_FLOW_METRICS } from "./application/ports/order-flow-metrics.port";
import { SAGA_LOCAL_UNIT_OF_WORK } from "./application/ports/saga-local-unit-of-work";
import { ConsumedMessageOrmEntity } from "../messaging/consumed-message.orm-entity";
import { TypeOrmConsumedMessageRepository } from "../messaging/consumed-message.repository";
import { SagaInstanceOrmEntity } from "./infrastructure/typeorm/saga-instance.orm-entity";
import { TypeOrmSagaInstanceRepository } from "./infrastructure/repositories/typeorm-saga-instance.repository";
import { TypeOrmSagaLocalUnitOfWork } from "./infrastructure/typeorm/typeorm-saga-local-unit-of-work";
export const SAGA_INSTANCE_REPOSITORY = Symbol("SAGA_INSTANCE_REPOSITORY");

@Module({
  imports: [
    MessagingModule,
    TypeOrmModule.forFeature([SagaInstanceOrmEntity, ConsumedMessageOrmEntity]),
  ],
  providers: [
    TypeOrmConsumedMessageRepository,
    TypeOrmSagaInstanceRepository,
    TypeOrmSagaLocalUnitOfWork,
    PrometheusOrderFlowMetrics,
    SagaOrchestratorService,
    {
      provide: SAGA_INSTANCE_REPOSITORY,
      useExisting: TypeOrmSagaInstanceRepository,
    },
    {
      provide: SAGA_LOCAL_UNIT_OF_WORK,
      useExisting: TypeOrmSagaLocalUnitOfWork,
    },
    {
      provide: ORDER_FLOW_METRICS,
      useExisting: PrometheusOrderFlowMetrics,
    },
  ],
  exports: [
    SAGA_INSTANCE_REPOSITORY,
    SAGA_LOCAL_UNIT_OF_WORK,
    ORDER_FLOW_METRICS,
    SagaOrchestratorService,
  ],
})
export class SagaModule {}
