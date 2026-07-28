import { Inject, Injectable } from "@nestjs/common";
import { PaginatedResponse } from "../../../common/interfaces/paginated-response.interface";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { Order } from "../../domain/entities/order.entity";
import { OrderItem } from "../../domain/entities/order-item.entity";
import { OrderPart } from "../../domain/entities/order-part.entity";
import { OrderStatus } from "../../domain/enums/order-status.enum";
import { OrderStatusTransitionService } from "../../domain/services/order-status-transition.service";
import { OrderNumber } from "../../domain/value-objects/order-number.value-object";
import { OrderHistoryEntry } from "../../domain/repositories/order-history-entry.interface";
import { OrderRepository } from "../../domain/repositories/order.repository.interface";
import {
  CUSTOMER_CLIENT,
  ORDER_REPOSITORY,
  WORKSHOP_CLIENT,
} from "../../order.tokens";
import { CustomerClient } from "../ports/customer.client";
import { WorkshopClient } from "../ports/workshop.client";
import { AddPartItemDto } from "../dto/add-part-item.dto";
import { AddServiceItemDto } from "../dto/add-service-item.dto";
import { AssociateVehicleDto } from "../dto/associate-vehicle.dto";
import { CreateOrderDto } from "../dto/create-order.dto";
import { ListOrdersQueryDto } from "../dto/list-orders.query.dto";
import {
  OrderHistoryEntryResponseDto,
  OrderListItemResponseDto,
  OrderPartItemResponseDto,
  OrderResponseDto,
  OrderServiceItemResponseDto,
  PublicOrderStatusResponseDto,
} from "../dto/order.response.dto";
import { PublicOrderStatusConsultationDto } from "../dto/public-order-status-consultation.dto";
import { UpdateOrderStatusDto } from "../dto/update-order-status.dto";
import { SagaOrchestratorService } from "../../../saga/application/saga-orchestrator.service";
import {
  ORDER_FLOW_METRICS,
  type OrderFlowMetrics,
} from "../../../saga/application/ports/order-flow-metrics.port";

@Injectable()
export class OrderService {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository,
    @Inject(CUSTOMER_CLIENT)
    private readonly customerClient: CustomerClient,
    @Inject(WORKSHOP_CLIENT)
    private readonly workshopClient: WorkshopClient,
    private readonly orderStatusTransitionService: OrderStatusTransitionService,
    private readonly sagaOrchestrator: SagaOrchestratorService,
    @Inject(ORDER_FLOW_METRICS)
    private readonly orderFlowMetrics: OrderFlowMetrics,
  ) {}

  async create(dto: CreateOrderDto): Promise<OrderResponseDto> {
    const customerDocument = this.normalizeDocument(dto.customerDocument);
    const customer =
      await this.customerClient.findCustomerByDocument(customerDocument);

    if (!customer) {
      throw new DomainException(
        "CUSTOMER_NOT_FOUND",
        `Customer with document ${dto.customerDocument} was not found.`,
      );
    }

    const now = new Date();
    const nextSequence = await this.orderRepository.getNextSequenceForDate(now);
    const order = Order.create({
      number: OrderNumber.create(now, nextSequence),
      customerId: customer.id,
      customerDocument,
      customerName: customer.name,
      notes: dto.notes?.trim() || undefined,
      expectedDeliveryDate: dto.expectedDeliveryDate
        ? new Date(dto.expectedDeliveryDate)
        : undefined,
    });

    const savedOrder = await this.sagaOrchestrator.createOrderWithSaga(order);
    this.orderFlowMetrics.recordOrderCreated();
    return this.toOrderResponse(savedOrder);
  }

  async getById(orderId: string): Promise<OrderResponseDto> {
    const order = await this.getRequiredOrder(orderId);
    return this.toOrderResponse(order);
  }

  async list(
    query: ListOrdersQueryDto,
  ): Promise<PaginatedResponse<OrderListItemResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const result = await this.orderRepository.findAll({
      number: query.number?.trim(),
      statuses: query.statuses,
      customerId: query.customerId?.trim(),
      customerDocument: query.customerDocument
        ? this.normalizeDocument(query.customerDocument)
        : undefined,
      customerName: query.customerName?.trim(),
      vehicleId: query.vehicleId?.trim(),
      vehiclePlate: query.vehiclePlate?.trim().toUpperCase(),
      receivedAtFrom: query.receivedAtFrom,
      receivedAtTo: query.receivedAtTo,
      finishedAtFrom: query.finishedAtFrom,
      finishedAtTo: query.finishedAtTo,
      minTotalAmount: query.minTotalAmount,
      maxTotalAmount: query.maxTotalAmount,
      page,
      limit,
      orderBy: query.orderBy ?? "createdAt",
      order: query.order ?? "DESC",
    });

    return {
      data: result.data.map((order) => this.toOrderListItemResponse(order)),
      meta: result.meta,
    };
  }

  async associateVehicle(
    orderId: string,
    dto: AssociateVehicleDto,
  ): Promise<OrderResponseDto> {
    const order = await this.getRequiredOrder(orderId);
    const vehicle = await this.customerClient.findVehicleById(dto.vehicleId);

    if (!vehicle) {
      throw new DomainException(
        "VEHICLE_NOT_FOUND",
        `Vehicle with id ${dto.vehicleId} was not found.`,
      );
    }

    order.associateVehicle(vehicle.id, vehicle.customerId);
    order.update({
      vehicleId: vehicle.id,
      vehiclePlate: vehicle.plate,
      vehicleBrand: vehicle.brand,
      vehicleModel: vehicle.model,
      vehicleYear: vehicle.year,
    });

    const savedOrder = await this.orderRepository.save(order);
    return this.toOrderResponse(savedOrder);
  }

  async addServiceItem(
    orderId: string,
    dto: AddServiceItemDto,
  ): Promise<OrderResponseDto> {
    const order = await this.getRequiredOrder(orderId);
    const serviceCatalogItem =
      await this.workshopClient.findServiceCatalogItemById(dto.serviceId);

    if (!serviceCatalogItem || serviceCatalogItem.active === false) {
      throw new DomainException(
        "SERVICE_CATALOG_ITEM_NOT_FOUND",
        `Service catalog item with id ${dto.serviceId} was not found.`,
      );
    }

    order.addItem(
      OrderItem.create({
        orderId: order.id,
        serviceCatalogItemId: serviceCatalogItem.id,
        serviceName: serviceCatalogItem.name,
        quantity: dto.quantity,
        unitPrice: serviceCatalogItem.unitPrice,
      }),
    );

    const savedOrder = await this.orderRepository.save(order);
    return this.toOrderResponse(savedOrder);
  }

  async addPartItem(
    orderId: string,
    dto: AddPartItemDto,
  ): Promise<OrderResponseDto> {
    const order = await this.getRequiredOrder(orderId);
    const part = await this.workshopClient.findPartById(dto.partId);

    if (!part || part.active === false) {
      throw new DomainException(
        "PART_NOT_FOUND",
        `Part with id ${dto.partId} was not found.`,
      );
    }

    if (
      part.availableQuantity !== undefined &&
      part.availableQuantity < dto.quantity
    ) {
      throw new DomainException(
        "INSUFFICIENT_PART_STOCK",
        `Insufficient stock for part ${dto.partId}.`,
      );
    }

    order.addPart(
      OrderPart.create({
        orderId: order.id,
        partId: part.id,
        partCode: part.code,
        partName: part.name,
        quantity: dto.quantity,
        unitPrice: part.unitPrice,
      }),
    );

    const savedOrder = await this.orderRepository.save(order);
    return this.toOrderResponse(savedOrder);
  }

  async updateStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
  ): Promise<OrderResponseDto> {
    const order = await this.getRequiredOrder(orderId);
    if (dto.status === OrderStatus.CANCELLED) {
      const savedOrder = await this.sagaOrchestrator.cancelOrder(
        orderId,
        dto.reason?.trim() || undefined,
      );
      return this.toOrderResponse(savedOrder);
    }
    if (
      dto.status === OrderStatus.WAITING_BUDGET_APPROVAL &&
      order.status === OrderStatus.WAITING_BUDGET_APPROVAL
    ) {
      await this.sagaOrchestrator.retryBudgetRequest(orderId);
      return this.toOrderResponse(order);
    }
    this.orderStatusTransitionService.validateTransition(
      order.status,
      dto.status,
    );

    switch (dto.status) {
      case OrderStatus.IN_DIAGNOSIS:
        order.startDiagnosis();
        break;
      case OrderStatus.WAITING_BUDGET_APPROVAL:
        order.sendForBudgetApproval();
        await this.sagaOrchestrator.requestBudget(order);
        return this.toOrderResponse(order);
      case OrderStatus.DELIVERED:
        order.deliver();
        break;
      case OrderStatus.BUDGET_APPROVED:
      case OrderStatus.BUDGET_REJECTED:
      case OrderStatus.IN_EXECUTION:
      case OrderStatus.FINISHED:
        throw new DomainException(
          "STATUS_MANAGED_EXTERNALLY",
          `Status ${dto.status} is managed by another service or a later phase.`,
        );
      case OrderStatus.RECEIVED:
      default:
        throw new DomainException(
          "INVALID_TARGET_STATUS",
          `Status ${dto.status} is not a valid manual target.`,
        );
    }

    const savedOrder = await this.orderRepository.save(order);
    return this.toOrderResponse(savedOrder);
  }

  async getHistory(orderId: string): Promise<OrderHistoryEntryResponseDto[]> {
    await this.getRequiredOrder(orderId);
    const history = await this.orderRepository.findHistoryByOrderId(orderId);
    return history.map((entry) => this.toHistoryEntryResponse(entry));
  }

  async getPublicStatus(
    dto: PublicOrderStatusConsultationDto,
  ): Promise<PublicOrderStatusResponseDto> {
    const order = await this.orderRepository.findByNumber(dto.number.trim());

    if (!order) {
      throw new DomainException(
        "ORDER_NOT_FOUND",
        `Order with number ${dto.number} was not found.`,
      );
    }

    if (
      order.customerDocument !== this.normalizeDocument(dto.customerDocument)
    ) {
      throw new DomainException(
        "PUBLIC_ORDER_ACCESS_DENIED",
        "Customer document does not match the requested order.",
      );
    }

    return this.toPublicOrderStatusResponse(order);
  }

  private async getRequiredOrder(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);

    if (!order) {
      throw new DomainException(
        "ORDER_NOT_FOUND",
        `Order with id ${orderId} was not found.`,
      );
    }

    return order;
  }

  private normalizeDocument(document: string): string {
    return document.replace(/\D/g, "");
  }

  private toOrderResponse(order: Order): OrderResponseDto {
    return {
      id: order.id,
      number: order.number.value,
      status: order.status,
      statusDescription: order.statusDescription,
      nextStepDescription: order.nextStepDescription,
      customer: {
        id: order.customerId,
        document: order.customerDocument,
        name: order.customerName,
      },
      vehicle: order.vehicleId
        ? {
            id: order.vehicleId,
            plate: order.vehiclePlate,
            brand: order.vehicleBrand,
            model: order.vehicleModel,
            year: order.vehicleYear,
          }
        : undefined,
      notes: order.notes,
      totalAmount: order.totalAmount,
      totalAmountFormatted: order.totalAmountFormatted,
      receivedAt: order.receivedAt,
      expectedDeliveryDate: order.expectedDeliveryDate,
      budgetSentAt: order.budgetSentAt,
      finishedAt: order.finishedAt,
      deliveredAt: order.deliveredAt,
      rejectionReason: order.rejectionReason,
      cancellationReason: order.cancellationReason,
      serviceItems: order.serviceItems.map((item) =>
        this.toServiceItemResponse(item),
      ),
      partItems: order.partItems.map((item) => this.toPartItemResponse(item)),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private toOrderListItemResponse(order: Order): OrderListItemResponseDto {
    return {
      id: order.id,
      number: order.number.value,
      status: order.status,
      customerName: order.customerName,
      customerDocument: order.customerDocument,
      vehiclePlate: order.vehiclePlate,
      totalAmount: order.totalAmount,
      receivedAt: order.receivedAt,
      updatedAt: order.updatedAt,
    };
  }

  private toHistoryEntryResponse(
    entry: OrderHistoryEntry,
  ): OrderHistoryEntryResponseDto {
    return {
      id: entry.id,
      orderId: entry.orderId,
      status: entry.status,
      description: entry.description,
      reason: entry.reason,
      createdAt: entry.createdAt,
    };
  }

  private toPublicOrderStatusResponse(
    order: Order,
  ): PublicOrderStatusResponseDto {
    return {
      number: order.number.value,
      status: order.status,
      statusDescription: order.statusDescription,
      nextStepDescription: order.nextStepDescription,
      totalAmount: order.totalAmount,
      totalAmountFormatted: order.totalAmountFormatted,
      receivedAt: order.receivedAt,
      expectedDeliveryDate: order.expectedDeliveryDate,
      finishedAt: order.finishedAt,
      deliveredAt: order.deliveredAt,
      vehicle: order.vehicleId
        ? {
            id: order.vehicleId,
            plate: order.vehiclePlate,
            brand: order.vehicleBrand,
            model: order.vehicleModel,
            year: order.vehicleYear,
          }
        : undefined,
    };
  }

  private toServiceItemResponse(
    item: Order["serviceItems"][number],
  ): OrderServiceItemResponseDto {
    return {
      id: item.id,
      serviceId: item.serviceCatalogItemId,
      serviceName: item.serviceName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      createdAt: item.createdAt,
    };
  }

  private toPartItemResponse(
    item: Order["partItems"][number],
  ): OrderPartItemResponseDto {
    return {
      id: item.id,
      partId: item.partId,
      partCode: item.partCode,
      partName: item.partName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      createdAt: item.createdAt,
    };
  }
}
