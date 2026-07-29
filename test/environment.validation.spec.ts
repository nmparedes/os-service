import "reflect-metadata";
import { validateEnvironment } from "../src/common/config/environment.validation";

describe("validateEnvironment", () => {
  it("uses safe defaults for optional values", () => {
    const config = validateEnvironment({});

    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3000);
    expect(config.SERVICE_NAME).toBe("os-service");
    expect(config.SERVICE_VERSION).toBe("0.1.0");
    expect(config.LOG_FORMAT).toBe("json");
    expect(config.JWT_ISSUER).toBe("fiap-tech-challenge-auth-function");
    expect(config.JWT_AUDIENCE).toBe("fiap-tech-challenge-api");
    expect(config.JWT_REQUIRED_CUSTOMER_STATUS).toBe("ACTIVE");
    expect(config.DB_HOST).toBe("localhost");
    expect(config.DB_PORT).toBe(3306);
    expect(config.DB_USERNAME).toBe("os_service");
    expect(config.DB_DATABASE).toBe("os_service");
    expect(config.CUSTOMER_SERVICE_BASE_URL).toBe(
      "http://customer-service.tech-challenge-apps.svc.cluster.local",
    );
    expect(config.WORKSHOP_SERVICE_BASE_URL).toBe(
      "http://workshop-service.tech-challenge-apps.svc.cluster.local",
    );
    expect(config.DB_SSL).toBe(false);
    expect(config.METRICS_ENABLED).toBe(true);
  });

  it("accepts explicit service settings", () => {
    const config = validateEnvironment({
      NODE_ENV: "test",
      PORT: "4000",
      SERVICE_NAME: "os-service",
      SERVICE_VERSION: "1.2.3",
      LOG_LEVEL: "debug",
      JWT_SECRET: "jwt-secret",
      JWT_ISSUER: "issuer",
      JWT_AUDIENCE: "audience",
      JWT_REQUIRED_CUSTOMER_STATUS: "ACTIVE",
      DB_HOST: "mysql",
      DB_PORT: "3307",
      DB_USERNAME: "os_service",
      DB_PASSWORD: "secret",
      DB_DATABASE: "os_service",
      CUSTOMER_SERVICE_BASE_URL: "http://customer-service.local",
      WORKSHOP_SERVICE_BASE_URL: "http://workshop-service.local",
      DB_SSL: "true",
      METRICS_ENABLED: "false",
    });

    expect(config.NODE_ENV).toBe("test");
    expect(config.PORT).toBe(4000);
    expect(config.SERVICE_NAME).toBe("os-service");
    expect(config.SERVICE_VERSION).toBe("1.2.3");
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.JWT_SECRET).toBe("jwt-secret");
    expect(config.JWT_ISSUER).toBe("issuer");
    expect(config.JWT_AUDIENCE).toBe("audience");
    expect(config.DB_HOST).toBe("mysql");
    expect(config.DB_PORT).toBe(3307);
    expect(config.DB_USERNAME).toBe("os_service");
    expect(config.DB_PASSWORD).toBe("secret");
    expect(config.DB_DATABASE).toBe("os_service");
    expect(config.CUSTOMER_SERVICE_BASE_URL).toBe(
      "http://customer-service.local",
    );
    expect(config.WORKSHOP_SERVICE_BASE_URL).toBe(
      "http://workshop-service.local",
    );
    expect(config.DB_SSL).toBe(true);
    expect(config.METRICS_ENABLED).toBe(false);
  });

  it("rejects invalid environment values", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "invalid",
        PORT: "0",
        LOG_FORMAT: "plain",
        DB_PORT: "70000",
      }),
    ).toThrow();
  });

  it("requires a RabbitMQ URL only when messaging is enabled", () => {
    expect(() => validateEnvironment({ MESSAGING_ENABLED: "true" })).toThrow(
      "RABBITMQ_URL is required",
    );

    expect(
      validateEnvironment({
        MESSAGING_ENABLED: "true",
        RABBITMQ_URL: "amqp://placeholder",
        RABBITMQ_MAX_RETRIES: "2",
      }),
    ).toMatchObject({ MESSAGING_ENABLED: true, RABBITMQ_MAX_RETRIES: 2 });
  });

  it("normalizes boolean flags from explicit false and true values", () => {
    const disabledMetrics = validateEnvironment({
      DB_SSL: "false",
      MESSAGING_ENABLED: false,
      METRICS_ENABLED: "false",
    });
    const enabledMetrics = validateEnvironment({
      DB_SSL: true,
      METRICS_ENABLED: true,
    });

    expect(disabledMetrics.DB_SSL).toBe(false);
    expect(disabledMetrics.MESSAGING_ENABLED).toBe(false);
    expect(disabledMetrics.METRICS_ENABLED).toBe(false);
    expect(enabledMetrics.DB_SSL).toBe(true);
    expect(enabledMetrics.METRICS_ENABLED).toBe(true);
  });

  it("rejects consumed message leases shorter than the safe minimum", () => {
    expect(() =>
      validateEnvironment({
        CONSUMED_MESSAGE_LEASE_MS: "59999",
      }),
    ).toThrow();
  });
});
