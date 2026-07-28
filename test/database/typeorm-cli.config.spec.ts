describe("osServiceDataSource", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      DB_HOST: "mysql",
      DB_PORT: "3307",
      DB_USERNAME: "os_service",
      DB_PASSWORD: "local-password",
      DB_DATABASE: "os_service",
      DB_SSL: "true",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("configures the service-owned MySQL data source for future migrations", async () => {
    const { default: osServiceDataSource } =
      await import("../../src/database/typeorm-cli.config");

    expect(osServiceDataSource.options).toMatchObject({
      type: "mysql",
      host: "mysql",
      port: 3307,
      username: "os_service",
      password: "local-password",
      database: "os_service",
      synchronize: false,
      logging: false,
      ssl: { rejectUnauthorized: true },
    });
    expect(osServiceDataSource.options.entities).toHaveLength(6);
    expect(osServiceDataSource.options.migrations).toHaveLength(4);
    expect(
      (osServiceDataSource.options.migrations as Array<{ name: string }>).map(
        (migration) => migration.name,
      ),
    ).toContain("AddSagaCompensationState1769209000000");
  });

  it("uses local defaults when optional connection values are absent", async () => {
    process.env = {
      ...originalEnv,
      DB_USERNAME: "os_service",
      DB_PASSWORD: "local-password",
      DB_DATABASE: "os_service",
    };
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_SSL;

    const { default: osServiceDataSource } =
      await import("../../src/database/typeorm-cli.config");

    expect(osServiceDataSource.options).toMatchObject({
      host: "localhost",
      port: 3306,
      ssl: false,
    });
  });
});
