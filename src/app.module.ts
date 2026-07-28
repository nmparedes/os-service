import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { validateEnvironment } from "./common/config/environment.validation";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { MessagingModule } from "./messaging/rabbitmq-broker";
import { OrderModule } from "./order/order.module";
import { SagaModule } from "./saga/saga.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    OrderModule,
    SagaModule,
    MessagingModule,
  ],
})
export class AppModule {}
