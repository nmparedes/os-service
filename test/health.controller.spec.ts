import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "../src/common/config/environment.validation";
import { HealthController } from "../src/health/health.controller";
import { HealthModule } from "../src/health/health.module";

describe("HealthController", () => {
  let controller: HealthController;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      SERVICE_NAME: "os-service",
      SERVICE_VERSION: "0.1.0",
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: validateEnvironment,
        }),
        HealthModule,
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns liveness status", () => {
    expect(controller.health()).toEqual({
      status: "ok",
      service: "os-service",
    });
  });

  it("returns readiness status with version", () => {
    expect(controller.ready()).toEqual({
      status: "ok",
      service: "os-service",
      version: "0.1.0",
    });
  });

  it("exposes Prometheus metrics", async () => {
    await expect(controller.metrics()).resolves.toContain("# HELP");
  });
});
