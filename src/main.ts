import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { DomainExceptionFilter } from "./common/filters/domain-exception.filter";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);
  const serviceName = configService.get<string>("SERVICE_NAME", "os-service");
  const serviceVersion = configService.get<string>("SERVICE_VERSION", "0.1.0");

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter(), new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle(serviceName)
    .setDescription("Phase 4 microservice API")
    .setVersion(serviceVersion)
    .addBearerAuth()
    .build();

  const swaggerDocument = rewriteExternalSwaggerPaths(
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  SwaggerModule.setup(
    "docs",
    app,
    swaggerDocument,
  );

  await app.listen(configService.get<number>("PORT", 3000));
}

function rewriteExternalSwaggerPaths(
  document: OpenAPIObject,
): OpenAPIObject {
  const paths = { ...(document.paths ?? {}) };

  // These endpoints are not exposed through the public gateway.
  delete paths["/ready"];
  delete paths["/metrics"];

  rewritePath(paths, "/health", "/orders/health");
  rewritePath(
    paths,
    "/public/orders/status-consultation",
    "/orders/public/status",
  );

  return {
    ...document,
    paths,
  };
}

function rewritePath(
  paths: NonNullable<OpenAPIObject["paths"]>,
  sourcePath: string,
  targetPath: string,
): void {
  const pathItem = paths[sourcePath];
  if (!pathItem) {
    return;
  }

  paths[targetPath] = pathItem;
  delete paths[sourcePath];
}

void bootstrap();
