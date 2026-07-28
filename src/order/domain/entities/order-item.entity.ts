import { randomUUID } from "crypto";

type CreateOrderItemProps = {
  id?: string;
  orderId: string;
  serviceCatalogItemId: string;
  serviceName: string;
  quantity: number;
  unitPrice: number;
  createdAt?: Date;
};

export class OrderItem {
  private readonly idInternal: string;
  private readonly orderIdInternal: string;
  private readonly serviceCatalogItemIdInternal: string;
  private readonly serviceNameInternal: string;
  private readonly quantityInternal: number;
  private readonly unitPriceInternal: number;
  private readonly subtotalInternal: number;
  private readonly createdAtInternal: Date;

  private constructor(props: CreateOrderItemProps) {
    this.idInternal = props.id ?? randomUUID();
    this.orderIdInternal = props.orderId;
    this.serviceCatalogItemIdInternal = props.serviceCatalogItemId;
    this.serviceNameInternal = props.serviceName;
    this.quantityInternal = props.quantity;
    this.unitPriceInternal = props.unitPrice;
    this.subtotalInternal = this.quantityInternal * this.unitPriceInternal;
    this.createdAtInternal = props.createdAt ?? new Date();
  }

  static create(props: CreateOrderItemProps): OrderItem {
    return new OrderItem(props);
  }

  get id(): string {
    return this.idInternal;
  }

  get orderId(): string {
    return this.orderIdInternal;
  }

  get serviceCatalogItemId(): string {
    return this.serviceCatalogItemIdInternal;
  }

  get quantity(): number {
    return this.quantityInternal;
  }

  get serviceName(): string {
    return this.serviceNameInternal;
  }

  get unitPrice(): number {
    return this.unitPriceInternal;
  }

  get subtotal(): number {
    return this.subtotalInternal;
  }

  get createdAt(): Date {
    return this.createdAtInternal;
  }
}
