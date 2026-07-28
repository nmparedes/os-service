import { randomUUID } from "crypto";

type CreateOrderPartProps = {
  id?: string;
  orderId: string;
  partId: string;
  partCode: string;
  partName: string;
  quantity: number;
  unitPrice: number;
  createdAt?: Date;
};

export class OrderPart {
  private readonly idInternal: string;
  private readonly orderIdInternal: string;
  private readonly partIdInternal: string;
  private readonly partCodeInternal: string;
  private readonly partNameInternal: string;
  private quantityInternal: number;
  private readonly unitPriceInternal: number;
  private subtotalInternal: number;
  private readonly createdAtInternal: Date;

  private constructor(props: CreateOrderPartProps) {
    this.idInternal = props.id ?? randomUUID();
    this.orderIdInternal = props.orderId;
    this.partIdInternal = props.partId;
    this.partCodeInternal = props.partCode;
    this.partNameInternal = props.partName;
    this.quantityInternal = props.quantity;
    this.unitPriceInternal = props.unitPrice;
    this.subtotalInternal = this.quantityInternal * this.unitPriceInternal;
    this.createdAtInternal = props.createdAt ?? new Date();
  }

  static create(props: CreateOrderPartProps): OrderPart {
    return new OrderPart(props);
  }

  recalculateSubtotal(): void {
    this.subtotalInternal = this.quantityInternal * this.unitPriceInternal;
  }

  setQuantity(quantity: number): void {
    this.quantityInternal = quantity;
    this.recalculateSubtotal();
  }

  get id(): string {
    return this.idInternal;
  }

  get orderId(): string {
    return this.orderIdInternal;
  }

  get partId(): string {
    return this.partIdInternal;
  }

  get partCode(): string {
    return this.partCodeInternal;
  }

  get partName(): string {
    return this.partNameInternal;
  }

  get quantity(): number {
    return this.quantityInternal;
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
