import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from "class-validator";

export class EnvironmentVariables {
  @IsOptional()
  @IsIn(["development", "test", "production"])
  NODE_ENV = "development";

  @Transform(({ value }) => Number(value ?? 3000))
  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsOptional()
  @IsString()
  SERVICE_NAME = "os-service";

  @IsOptional()
  @IsString()
  SERVICE_VERSION = "0.1.0";

  @IsOptional()
  @IsString()
  LOG_LEVEL = "info";

  @IsOptional()
  @IsIn(["json"])
  LOG_FORMAT = "json";

  @IsOptional()
  @IsString()
  @IsOptional()
  @IsString()
  JWT_SECRET?: string;

  @IsOptional()
  @IsString()
  JWT_ISSUER = "fiap-tech-challenge-auth-function";

  @IsOptional()
  @IsString()
  JWT_AUDIENCE = "fiap-tech-challenge-api";

  @IsOptional()
  @IsIn(["ACTIVE"])
  JWT_REQUIRED_CUSTOMER_STATUS = "ACTIVE";

  @IsOptional()
  @IsString()
  DB_HOST = "localhost";

  @Transform(({ value }) => Number(value ?? 3306))
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT = 3306;

  @IsOptional()
  @IsString()
  DB_USERNAME = "os_service";

  @IsOptional()
  @IsString()
  DB_PASSWORD?: string;

  @IsOptional()
  @IsString()
  DB_DATABASE = "os_service";

  @IsOptional()
  @IsString()
  CUSTOMER_SERVICE_BASE_URL = "http://customer-service:3000";

  @IsOptional()
  @IsString()
  WORKSHOP_SERVICE_BASE_URL = "http://workshop-service:3000";

  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  DB_SSL = false;

  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  MESSAGING_ENABLED = false;

  @IsOptional()
  @IsString()
  RABBITMQ_URL?: string;

  @Transform(({ value }) => Number(value ?? 3))
  @IsInt()
  @Min(0)
  RABBITMQ_MAX_RETRIES = 3;

  @Transform(({ value }) => Number(value ?? 300000))
  @IsInt()
  @Min(60000)
  CONSUMED_MESSAGE_LEASE_MS = 300000;

  @Transform(
    ({ value }) => value === undefined || value === "true" || value === true,
  )
  @IsBoolean()
  METRICS_ENABLED = true;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  if (
    validatedConfig.MESSAGING_ENABLED &&
    !validatedConfig.RABBITMQ_URL?.trim()
  ) {
    throw new Error("RABBITMQ_URL is required when messaging is enabled.");
  }

  return validatedConfig;
}
