import { ConfigService } from "@nestjs/config";
import { DomainException } from "../../../src/common/exceptions/domain.exception";
import {
  integrationFailuresTotal,
  metricsRegistry,
} from "../../../src/common/metrics/metrics.registry";
import { WorkshopHttpClient } from "../../../src/order/infrastructure/http/workshop-http.client";

describe("WorkshopHttpClient", () => {
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
      json: jest.fn().mockResolvedValue({ id: "service-1" }),
    }) as typeof fetch;

    const client = new WorkshopHttpClient(
      new ConfigService({
        WORKSHOP_SERVICE_BASE_URL: "http://workshop-service.local",
      }),
    );

    await expect(
      client.findServiceCatalogItemById("service-1"),
    ).resolves.toEqual({
      id: "service-1",
    });
  });

  it("returns null for not found responses", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as typeof fetch;

    const client = new WorkshopHttpClient(new ConfigService({}));

    await expect(client.findPartById("missing")).resolves.toBeNull();
  });

  it("throws a domain exception for unexpected upstream failures", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as typeof fetch;

    const client = new WorkshopHttpClient(new ConfigService({}));

    await expect(client.findPartById("part-1")).rejects.toMatchObject<
      Partial<DomainException>
    >({
      code: "WORKSHOP_SERVICE_REQUEST_FAILED",
    });
    await expect(integrationFailuresTotal.get()).resolves.toMatchObject({
      values: [
        expect.objectContaining({
          labels: { service: "os-service", integration: "workshop_rest" },
          value: 1,
        }),
      ],
    });
  });
});
