export interface ServiceCatalogItemSummary {
  id: string;
  name: string;
  unitPrice: number;
  active?: boolean;
}

export interface PartSummary {
  id: string;
  code: string;
  name: string;
  unitPrice: number;
  availableQuantity?: number;
  active?: boolean;
}

export interface WorkshopClient {
  findServiceCatalogItemById(
    serviceCatalogItemId: string,
  ): Promise<ServiceCatalogItemSummary | null>;
  findPartById(partId: string): Promise<PartSummary | null>;
}
