import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrderService } from "./application/services/order.service";
import { OrderController } from "./infrastructure/controllers/order.controller";
import { PublicOrderController } from "./infrastructure/controllers/public-order.controller";
import { CustomerHttpClient } from "./infrastructure/http/customer-http.client";
import { WorkshopHttpClient } from "./infrastructure/http/workshop-http.client";
import { TypeOrmOrderRepository } from "./infrastructure/repositories/typeorm-order.repository";
import { OrderHistoryOrmEntity } from "./infrastructure/typeorm/order-history.orm-entity";
import { OrderOrmEntity } from "./infrastructure/typeorm/order.orm-entity";
import { OrderPartItemOrmEntity } from "./infrastructure/typeorm/order-part-item.orm-entity";
import { OrderServiceItemOrmEntity } from "./infrastructure/typeorm/order-service-item.orm-entity";
import { OrderStatusTransitionService } from "./domain/services/order-status-transition.service";
import { SagaModule } from "../saga/saga.module";
import {
  CUSTOMER_CLIENT,
  ORDER_REPOSITORY,
  WORKSHOP_CLIENT,
} from "./order.tokens";

@Module({
  imports: [
    SagaModule,
    TypeOrmModule.forFeature([
      OrderOrmEntity,
      OrderServiceItemOrmEntity,
      OrderPartItemOrmEntity,
      OrderHistoryOrmEntity,
    ]),
  ],
  controllers: [OrderController, PublicOrderController],
  providers: [
    OrderService,
    OrderStatusTransitionService,
    TypeOrmOrderRepository,
    CustomerHttpClient,
    WorkshopHttpClient,
    {
      provide: ORDER_REPOSITORY,
      useExisting: TypeOrmOrderRepository,
    },
    {
      provide: CUSTOMER_CLIENT,
      useExisting: CustomerHttpClient,
    },
    {
      provide: WORKSHOP_CLIENT,
      useExisting: WorkshopHttpClient,
    },
  ],
})
export class OrderModule {}
