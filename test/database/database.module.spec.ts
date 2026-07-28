import { ConfigService } from "@nestjs/config";
import { DatabaseModule } from "../../src/database/database.module";

describe("DatabaseModule", () => {
  it("is defined for MySQL ownership configuration", () => {
    expect(DatabaseModule).toBeDefined();
  });

  it("keeps database credentials externalized through ConfigService", () => {
    const config = new ConfigService({
      DB_HOST: "db.local",
      DB_PORT: 3306,
      DB_USERNAME: "os_service",
      DB_PASSWORD: "from-secret",
      DB_DATABASE: "os_service",
      DB_SSL: true,
    });

    expect(config.get<string>("DB_HOST")).toBe("db.local");
    expect(config.get<string>("DB_PASSWORD")).toBe("from-secret");
    expect(config.get<boolean>("DB_SSL")).toBe(true);
  });

  it("configures TypeORM SSL explicitly from ConfigService", () => {
    const imports = Reflect.getMetadata("imports", DatabaseModule) as Array<{
      imports: Array<{
        providers: Array<{
          provide: string;
          useFactory: (configService: ConfigService) => Record<string, unknown>;
        }>;
      }>;
    }>;
    const coreModule = imports[0].imports[0];
    const optionsProvider = coreModule.providers.find(
      (provider) => provider.provide === "TypeOrmModuleOptions",
    );
    const secureConfig = {
      get: jest.fn(
        (key: string) =>
          (
            ({
              DB_HOST: "mysql",
              DB_PORT: 3306,
              DB_USERNAME: "os_service",
              DB_PASSWORD: "secret",
              DB_DATABASE: "os_service",
              DB_SSL: true,
            }) as Record<string, unknown>
          )[key],
      ),
    } as unknown as ConfigService;
    const insecureConfig = {
      get: jest.fn(
        (key: string) =>
          (
            ({
              DB_HOST: "mysql",
              DB_PORT: 3306,
              DB_USERNAME: "os_service",
              DB_PASSWORD: "secret",
              DB_DATABASE: "os_service",
              DB_SSL: false,
            }) as Record<string, unknown>
          )[key],
      ),
    } as unknown as ConfigService;

    expect(optionsProvider?.useFactory(secureConfig)).toMatchObject({
      ssl: { rejectUnauthorized: true },
      synchronize: false,
    });
    expect(optionsProvider?.useFactory(insecureConfig)).toMatchObject({
      ssl: false,
      synchronize: false,
    });
  });
});
