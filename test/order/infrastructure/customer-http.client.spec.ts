import { ConfigService } from "@nestjs/config";
import { DomainException } from "../../../src/common/exceptions/domain.exception";
import {
  integrationFailuresTotal,
  metricsRegistry,
} from "../../../src/common/metrics/metrics.registry";
import { CustomerHttpClient } from "../../../src/order/infrastructure/http/customer-http.client";

describe("CustomerHttpClient", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    metricsRegistry.resetMetrics();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns JSON payloads for successful requests", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: "customer-1" }),
    }) as typeof fetch;

    const client = new CustomerHttpClient(
      new ConfigService({
        CUSTOMER_SERVICE_BASE_URL: "http://customer-service.local",
      }),
    );

    await expect(client.findCustomerById("customer-1")).resolves.toEqual({
      id: "customer-1",
    });
  });

  it("returns null for not found responses", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as typeof fetch;

    const client = new CustomerHttpClient(new ConfigService({}));

    await expect(client.findVehicleById("missing")).resolves.toBeNull();
  });

  it("throws a domain exception for unexpected upstream failures", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as typeof fetch;

    const client = new CustomerHttpClient(new ConfigService({}));

    await expect(
      client.findCustomerByDocument("12345678901"),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "CUSTOMER_SERVICE_REQUEST_FAILED",
    });
    await expect(integrationFailuresTotal.get()).resolves.toMatchObject({
      values: [
        expect.objectContaining({
          labels: { service: "os-service", integration: "customer_rest" },
          value: 1,
        }),
      ],
    });
  });
});
