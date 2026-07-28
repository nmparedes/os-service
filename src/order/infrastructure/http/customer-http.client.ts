import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { incrementIntegrationFailureMetric } from "../../../common/metrics/metrics.registry";
import {
  CustomerClient,
  CustomerSummary,
  VehicleSummary,
} from "../../application/ports/customer.client";

@Injectable()
export class CustomerHttpClient implements CustomerClient {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      "CUSTOMER_SERVICE_BASE_URL",
      "http://customer-service:3000",
    );
  }

  async findCustomerByDocument(
    document: string,
  ): Promise<CustomerSummary | null> {
    return this.get<CustomerSummary>(
      `/internal/customers/by-document/${encodeURIComponent(document)}`,
    );
  }

  async findCustomerById(customerId: string): Promise<CustomerSummary | null> {
    return this.get<CustomerSummary>(
      `/internal/customers/${encodeURIComponent(customerId)}`,
    );
  }

  async findVehicleById(vehicleId: string): Promise<VehicleSummary | null> {
    return this.get<VehicleSummary>(
      `/internal/vehicles/${encodeURIComponent(vehicleId)}`,
    );
  }

  private async get<T>(path: string): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`);
    } catch (error) {
      incrementIntegrationFailureMetric("customer_rest");
      throw error;
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      incrementIntegrationFailureMetric("customer_rest");
      throw new DomainException(
        "CUSTOMER_SERVICE_REQUEST_FAILED",
        `Customer service request failed with status ${response.status}.`,
      );
    }

    return (await response.json()) as T;
  }
}
