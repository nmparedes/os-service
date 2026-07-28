import { randomUUID } from "crypto";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { OrderStatus } from "../enums/order-status.enum";
import { OrderNotEditableException } from "../exceptions/order-not-editable.exception";
import { VehicleNotOwnedByCustomerException } from "../exceptions/vehicle-not-owned-by-customer.exception";
import { OrderNumber } from "../value-objects/order-number.value-object";
import { OrderItem } from "./order-item.entity";
import { OrderPart } from "./order-part.entity";
import { CreateOrderProps, UpdateOrderProps } from "./order.props";

type OrderAllProps = CreateOrderProps & {
  id?: string;
  status?: OrderStatus;
  receivedAt?: Date;
  finishedAt?: Date;
  deliveredAt?: Date;
  budgetSentAt?: Date;
  serviceItems?: OrderItem[];
  partItems?: OrderPart[];
  totalAmount?: number;
  rejectionReason?: string;
  cancellationReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export class Order {
  private readonly idInternal: string;
  private readonly numberInternal: OrderNumber;
  private statusInternal: OrderStatus;
  private readonly customerIdInternal: string;
  private customerDocumentInternal?: string;
  private customerNameInternal?: string;
  private vehicleIdInternal?: string;
  private vehiclePlateInternal?: string;
  private vehicleBrandInternal?: string;
  private vehicleModelInternal?: string;
  private vehicleYearInternal?: number;
  private notesInternal?: string;
  private readonly receivedAtInternal: Date;
  private expectedDeliveryDateInternal?: Date;
  private finishedAtInternal?: Date;
  private deliveredAtInternal?: Date;
  private budgetSentAtInternal?: Date;
  private readonly serviceItemsInternal: OrderItem[];
  private readonly partItemsInternal: OrderPart[];
  private totalAmountInternal: number;
  private rejectionReasonInternal?: string;
  private cancellationReasonInternal?: string;
  private readonly createdAtInternal: Date;
  private updatedAtInternal: Date;

  private constructor(props: OrderAllProps) {
    this.idInternal = props.id ?? randomUUID();
    this.numberInternal = props.number;
    this.statusInternal = props.status ?? OrderStatus.RECEIVED;
    this.customerIdInternal = props.customerId;
    this.customerDocumentInternal = props.customerDocument;
    this.customerNameInternal = props.customerName;
    this.vehicleIdInternal = props.vehicleId;
    this.vehiclePlateInternal = props.vehiclePlate;
    this.vehicleBrandInternal = props.vehicleBrand;
    this.vehicleModelInternal = props.vehicleModel;
    this.vehicleYearInternal = props.vehicleYear;
    this.notesInternal = props.notes;
    this.receivedAtInternal = props.receivedAt ?? new Date();
    this.expectedDeliveryDateInternal = props.expectedDeliveryDate;
    this.finishedAtInternal = props.finishedAt;
    this.deliveredAtInternal = props.deliveredAt;
    this.budgetSentAtInternal = props.budgetSentAt;
    this.serviceItemsInternal = props.serviceItems ?? [];
    this.partItemsInternal = props.partItems ?? [];
    this.totalAmountInternal = props.totalAmount ?? 0;
    this.rejectionReasonInternal = props.rejectionReason;
    this.cancellationReasonInternal = props.cancellationReason;
    this.createdAtInternal = props.createdAt ?? new Date();
    this.updatedAtInternal = props.updatedAt ?? new Date();

    this.validate();
  }

  static create(props: CreateOrderProps): Order {
    return new Order(props);
  }

  static restore(props: OrderAllProps): Order {
    return new Order(props);
  }

  private validate(): void {
    if (!this.numberInternal) {
      throw new DomainException(
        "ORDER_NUMBER_REQUIRED",
        "Order number is required.",
      );
    }

    if (
      !this.customerIdInternal ||
      this.customerIdInternal.trim().length === 0
    ) {
      throw new DomainException(
        "CUSTOMER_ID_REQUIRED",
        "Customer id is required.",
      );
    }
  }

  update(props: UpdateOrderProps): void {
    if (!this.isEditable()) {
      throw new DomainException(
        "ORDER_NOT_EDITABLE",
        `Order with status ${this.statusInternal} cannot be edited.`,
      );
    }

    if (props.status !== undefined) {
      this.statusInternal = props.status;
    }

    if (props.vehicleId !== undefined) {
      this.vehicleIdInternal = props.vehicleId;
    }

    if (props.customerDocument !== undefined) {
      this.customerDocumentInternal = props.customerDocument;
    }

    if (props.customerName !== undefined) {
      this.customerNameInternal = props.customerName;
    }

    if (props.vehiclePlate !== undefined) {
      this.vehiclePlateInternal = props.vehiclePlate;
    }

    if (props.vehicleBrand !== undefined) {
      this.vehicleBrandInternal = props.vehicleBrand;
    }

    if (props.vehicleModel !== undefined) {
      this.vehicleModelInternal = props.vehicleModel;
    }

    if (props.vehicleYear !== undefined) {
      this.vehicleYearInternal = props.vehicleYear;
    }

    if (props.notes !== undefined) {
      this.notesInternal = props.notes;
    }

    if (props.expectedDeliveryDate !== undefined) {
      this.expectedDeliveryDateInternal = props.expectedDeliveryDate;
    }

    if (props.finishedAt !== undefined) {
      this.finishedAtInternal = props.finishedAt;
    }

    if (props.deliveredAt !== undefined) {
      this.deliveredAtInternal = props.deliveredAt;
    }

    this.updatedAtInternal = new Date();
  }

  isEditable(): boolean {
    return (
      this.statusInternal === OrderStatus.RECEIVED ||
      this.statusInternal === OrderStatus.IN_DIAGNOSIS
    );
  }

  associateVehicle(vehicleId: string, vehicleCustomerId: string): void {
    if (!this.isEditable()) {
      throw new OrderNotEditableException(this.statusInternal);
    }

    if (vehicleCustomerId !== this.customerIdInternal) {
      throw new VehicleNotOwnedByCustomerException(
        vehicleId,
        this.customerIdInternal,
      );
    }

    this.vehicleIdInternal = vehicleId;
    this.updatedAtInternal = new Date();
  }

  addItem(item: OrderItem): void {
    if (!this.isEditable()) {
      throw new OrderNotEditableException(this.statusInternal);
    }

    const existingItem = this.serviceItemsInternal.some(
      (currentItem) =>
        currentItem.serviceCatalogItemId === item.serviceCatalogItemId,
    );

    if (existingItem) {
      throw new DomainException(
        "SERVICE_ITEM_ALREADY_ADDED",
        "This service item has already been added to the order.",
      );
    }

    this.serviceItemsInternal.push(item);
    this.recalculateTotalAmount();
    this.updatedAtInternal = new Date();
  }

  removeItem(itemId: string): void {
    if (!this.isEditable()) {
      throw new OrderNotEditableException(this.statusInternal);
    }

    const index = this.serviceItemsInternal.findIndex(
      (currentItem) => currentItem.id === itemId,
    );

    if (index === -1) {
      throw new DomainException(
        "ORDER_ITEM_NOT_FOUND",
        "Service item was not found in the order.",
      );
    }

    this.serviceItemsInternal.splice(index, 1);
    this.recalculateTotalAmount();
    this.updatedAtInternal = new Date();
  }

  get serviceSubtotal(): number {
    return this.serviceItemsInternal.reduce(
      (total, item) => total + item.subtotal,
      0,
    );
  }

  addPart(item: OrderPart): void {
    if (!this.isEditable()) {
      throw new OrderNotEditableException(this.statusInternal);
    }

    const existingItem = this.partItemsInternal.some(
      (currentItem) => currentItem.partId === item.partId,
    );

    if (existingItem) {
      throw new DomainException(
        "ORDER_PART_ALREADY_ADDED",
        "This part has already been added to the order.",
      );
    }

    this.partItemsInternal.push(item);
    this.recalculateTotalAmount();
    this.updatedAtInternal = new Date();
  }

  removePart(itemId: string): OrderPart {
    if (!this.isEditable()) {
      throw new OrderNotEditableException(this.statusInternal);
    }

    const index = this.partItemsInternal.findIndex(
      (currentItem) => currentItem.id === itemId,
    );

    if (index === -1) {
      throw new DomainException(
        "ORDER_PART_NOT_FOUND",
        "Part item was not found in the order.",
      );
    }

    const [removedItem] = this.partItemsInternal.splice(index, 1);
    this.recalculateTotalAmount();
    this.updatedAtInternal = new Date();

    return removedItem;
  }

  updatePartQuantity(
    itemId: string,
    newQuantity: number,
  ): { previousQuantity: number; newQuantity: number } {
    if (!this.isEditable()) {
      throw new OrderNotEditableException(this.statusInternal);
    }

    const item = this.partItemsInternal.find(
      (currentItem) => currentItem.id === itemId,
    );

    if (!item) {
      throw new DomainException(
        "ORDER_PART_NOT_FOUND",
        "Part item was not found in the order.",
      );
    }

    const previousQuantity = item.quantity;
    item.setQuantity(newQuantity);
    this.recalculateTotalAmount();
    this.updatedAtInternal = new Date();

    return {
      previousQuantity,
      newQuantity,
    };
  }

  get partSubtotal(): number {
    return this.partItemsInternal.reduce(
      (total, item) => total + item.subtotal,
      0,
    );
  }

  recalculateTotalAmount(): void {
    this.totalAmountInternal = this.serviceSubtotal + this.partSubtotal;
  }

  sendForBudgetApproval(): void {
    if (!this.isEditable()) {
      throw new DomainException(
        "ORDER_NOT_EDITABLE",
        `Order with status ${this.statusInternal} cannot be sent for budget approval.`,
      );
    }

    if (!this.vehicleIdInternal) {
      throw new DomainException(
        "VEHICLE_NOT_ASSOCIATED",
        "A vehicle must be associated before sending the order for budget approval.",
      );
    }

    if (
      this.serviceItemsInternal.length === 0 &&
      this.partItemsInternal.length === 0
    ) {
      throw new DomainException(
        "ORDER_WITHOUT_ITEMS",
        "Order must contain at least one service or part before budget approval.",
      );
    }

    this.statusInternal = OrderStatus.WAITING_BUDGET_APPROVAL;
    this.budgetSentAtInternal = new Date();
    this.updatedAtInternal = new Date();
  }

  startDiagnosis(): void {
    if (this.statusInternal !== OrderStatus.RECEIVED) {
      throw new DomainException(
        "INVALID_STATUS_TRANSITION",
        `Invalid status transition: ${this.statusInternal} to ${OrderStatus.IN_DIAGNOSIS}.`,
      );
    }

    this.statusInternal = OrderStatus.IN_DIAGNOSIS;
    this.updatedAtInternal = new Date();
  }

  approveBudget(): void {
    if (this.statusInternal !== OrderStatus.WAITING_BUDGET_APPROVAL) {
      throw new DomainException(
        "INVALID_STATUS_TRANSITION",
        `Invalid status transition: ${this.statusInternal} to ${OrderStatus.BUDGET_APPROVED}.`,
      );
    }

    this.statusInternal = OrderStatus.BUDGET_APPROVED;
    this.updatedAtInternal = new Date();
  }

  rejectBudget(reason?: string): void {
    if (this.statusInternal !== OrderStatus.WAITING_BUDGET_APPROVAL) {
      throw new DomainException(
        "INVALID_STATUS_TRANSITION",
        `Invalid status transition: ${this.statusInternal} to ${OrderStatus.BUDGET_REJECTED}.`,
      );
    }

    this.statusInternal = OrderStatus.BUDGET_REJECTED;
    this.rejectionReasonInternal = reason;
    this.updatedAtInternal = new Date();
  }

  startExecution(): void {
    if (this.statusInternal !== OrderStatus.BUDGET_APPROVED) {
      throw new DomainException(
        "INVALID_STATUS_TRANSITION",
        `Invalid status transition: ${this.statusInternal} to ${OrderStatus.IN_EXECUTION}.`,
      );
    }

    this.statusInternal = OrderStatus.IN_EXECUTION;
    this.updatedAtInternal = new Date();
  }

  finish(): void {
    if (this.statusInternal !== OrderStatus.IN_EXECUTION) {
      throw new DomainException(
        "INVALID_STATUS_TRANSITION",
        `Invalid status transition: ${this.statusInternal} to ${OrderStatus.FINISHED}.`,
      );
    }

    this.statusInternal = OrderStatus.FINISHED;
    this.finishedAtInternal = new Date();
    this.updatedAtInternal = new Date();
  }

  deliver(): void {
    if (this.statusInternal !== OrderStatus.FINISHED) {
      throw new DomainException(
        "INVALID_STATUS_TRANSITION",
        `Invalid status transition: ${this.statusInternal} to ${OrderStatus.DELIVERED}.`,
      );
    }

    this.statusInternal = OrderStatus.DELIVERED;
    this.deliveredAtInternal = new Date();
    this.updatedAtInternal = new Date();
  }

  cancel(reason?: string): void {
    const allowedStatuses = [
      OrderStatus.RECEIVED,
      OrderStatus.IN_DIAGNOSIS,
      OrderStatus.WAITING_BUDGET_APPROVAL,
      OrderStatus.BUDGET_APPROVED,
      OrderStatus.IN_EXECUTION,
    ];

    if (!allowedStatuses.includes(this.statusInternal)) {
      throw new DomainException(
        "INVALID_STATUS_TRANSITION",
        `Invalid status transition: ${this.statusInternal} to ${OrderStatus.CANCELLED}.`,
      );
    }

    this.statusInternal = OrderStatus.CANCELLED;
    this.cancellationReasonInternal = reason;
    this.updatedAtInternal = new Date();
  }

  get statusDescription(): string {
    const descriptions: Record<OrderStatus, string> = {
      [OrderStatus.RECEIVED]: "Order received",
      [OrderStatus.IN_DIAGNOSIS]: "In diagnosis",
      [OrderStatus.WAITING_BUDGET_APPROVAL]: "Waiting budget approval",
      [OrderStatus.BUDGET_APPROVED]: "Budget approved",
      [OrderStatus.BUDGET_REJECTED]: "Budget rejected",
      [OrderStatus.IN_EXECUTION]: "In execution",
      [OrderStatus.FINISHED]: "Finished",
      [OrderStatus.DELIVERED]: "Delivered",
      [OrderStatus.CANCELLED]: "Cancelled",
    };

    return descriptions[this.statusInternal] ?? this.statusInternal;
  }

  get nextStepDescription(): string {
    const nextSteps: Record<OrderStatus, string> = {
      [OrderStatus.RECEIVED]: "Vehicle is waiting for diagnosis.",
      [OrderStatus.IN_DIAGNOSIS]: "Diagnosis is in progress.",
      [OrderStatus.WAITING_BUDGET_APPROVAL]:
        "Waiting for customer budget approval.",
      [OrderStatus.BUDGET_APPROVED]:
        "Budget approved, waiting for execution start.",
      [OrderStatus.BUDGET_REJECTED]:
        "Budget was rejected. A new order submission or manual contact is required.",
      [OrderStatus.IN_EXECUTION]: "Services are in execution.",
      [OrderStatus.FINISHED]:
        "Services are finished and the vehicle is ready for pickup.",
      [OrderStatus.DELIVERED]: "Vehicle delivered.",
      [OrderStatus.CANCELLED]: "Order was cancelled.",
    };

    return nextSteps[this.statusInternal] ?? this.statusInternal;
  }

  get totalAmount(): number {
    return this.totalAmountInternal;
  }

  get totalAmountFormatted(): string {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(this.totalAmountInternal);
  }

  get id(): string {
    return this.idInternal;
  }

  get number(): OrderNumber {
    return this.numberInternal;
  }

  get status(): OrderStatus {
    return this.statusInternal;
  }

  get customerId(): string {
    return this.customerIdInternal;
  }

  get vehicleId(): string | undefined {
    return this.vehicleIdInternal;
  }

  get customerDocument(): string | undefined {
    return this.customerDocumentInternal;
  }

  get customerName(): string | undefined {
    return this.customerNameInternal;
  }

  get vehiclePlate(): string | undefined {
    return this.vehiclePlateInternal;
  }

  get vehicleBrand(): string | undefined {
    return this.vehicleBrandInternal;
  }

  get vehicleModel(): string | undefined {
    return this.vehicleModelInternal;
  }

  get vehicleYear(): number | undefined {
    return this.vehicleYearInternal;
  }

  get notes(): string | undefined {
    return this.notesInternal;
  }

  get receivedAt(): Date {
    return this.receivedAtInternal;
  }

  get expectedDeliveryDate(): Date | undefined {
    return this.expectedDeliveryDateInternal;
  }

  get finishedAt(): Date | undefined {
    return this.finishedAtInternal;
  }

  get deliveredAt(): Date | undefined {
    return this.deliveredAtInternal;
  }

  get budgetSentAt(): Date | undefined {
    return this.budgetSentAtInternal;
  }

  get serviceItems(): OrderItem[] {
    return this.serviceItemsInternal;
  }

  get partItems(): OrderPart[] {
    return this.partItemsInternal;
  }

  get createdAt(): Date {
    return this.createdAtInternal;
  }

  get updatedAt(): Date {
    return this.updatedAtInternal;
  }

  get rejectionReason(): string | undefined {
    return this.rejectionReasonInternal;
  }

  get cancellationReason(): string | undefined {
    return this.cancellationReasonInternal;
  }
}
