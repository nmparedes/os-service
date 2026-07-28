import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { incrementIntegrationFailureMetric } from "../../../common/metrics/metrics.registry";
import {
  PartSummary,
  ServiceCatalogItemSummary,
  WorkshopClient,
} from "../../application/ports/workshop.client";

@Injectable()
export class WorkshopHttpClient implements WorkshopClient {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      "WORKSHOP_SERVICE_BASE_URL",
      "http://workshop-service:3000",
    );
  }

  async findServiceCatalogItemById(
    serviceCatalogItemId: string,
  ): Promise<ServiceCatalogItemSummary | null> {
    return this.get<ServiceCatalogItemSummary>(
      `/internal/service-catalog/items/${encodeURIComponent(serviceCatalogItemId)}`,
    );
  }

  async findPartById(partId: string): Promise<PartSummary | null> {
    return this.get<PartSummary>(
      `/internal/parts/${encodeURIComponent(partId)}`,
    );
  }

  private async get<T>(path: string): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`);
    } catch (error) {
      incrementIntegrationFailureMetric("workshop_rest");
      throw error;
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      incrementIntegrationFailureMetric("workshop_rest");
      throw new DomainException(
        "WORKSHOP_SERVICE_REQUEST_FAILED",
        `Workshop service request failed with status ${response.status}.`,
      );
    }

    return (await response.json()) as T;
  }
}
