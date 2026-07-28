export interface CustomerSummary {
  id: string;
  document: string;
  name: string;
  status?: string;
}

export interface VehicleSummary {
  id: string;
  customerId: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
}

export interface CustomerClient {
  findCustomerByDocument(document: string): Promise<CustomerSummary | null>;
  findCustomerById(customerId: string): Promise<CustomerSummary | null>;
  findVehicleById(vehicleId: string): Promise<VehicleSummary | null>;
}
