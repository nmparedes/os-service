import { DomainException } from "../../../src/common/exceptions/domain.exception";
import { OrderStatus } from "../../../src/order/domain/enums/order-status.enum";
import { OrderHistoryEntry } from "../../../src/order/domain/repositories/order-history-entry.interface";
import { OrderRepository } from "../../../src/order/domain/repositories/order.repository.interface";
import { OrderStatusTransitionService } from "../../../src/order/domain/services/order-status-transition.service";
import {
  CUSTOMER_CLIENT,
  ORDER_REPOSITORY,
  WORKSHOP_CLIENT,
} from "../../../src/order/order.tokens";
import { CustomerClient } from "../../../src/order/application/ports/customer.client";
import { WorkshopClient } from "../../../src/order/application/ports/workshop.client";
import { OrderService } from "../../../src/order/application/services/order.service";
import { SagaOrchestratorService } from "../../../src/saga/application/saga-orchestrator.service";
import {
  ORDER_FLOW_METRICS,
  type OrderFlowMetrics,
} from "../../../src/saga/application/ports/order-flow-metrics.port";
import { Test } from "@nestjs/testing";
import { createOrder } from "../order.factory";

describe("OrderService", () => {
  let service: OrderService;
  let orderRepository: jest.Mocked<OrderRepository>;
  let customerClient: jest.Mocked<CustomerClient>;
  let workshopClient: jest.Mocked<WorkshopClient>;
  let sagaOrchestrator: jest.Mocked<
    Pick<
      SagaOrchestratorService,
      | "createOrderWithSaga"
      | "requestBudget"
      | "retryBudgetRequest"
      | "cancelOrder"
    >
  >;
  let orderFlowMetrics: jest.Mocked<OrderFlowMetrics>;

  beforeEach(async () => {
    orderRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByNumber: jest.fn(),
      findAll: jest.fn(),
      findHistoryByOrderId: jest.fn(),
      getNextSequenceForDate: jest.fn(),
    };

    customerClient = {
      findCustomerByDocument: jest.fn(),
      findCustomerById: jest.fn(),
      findVehicleById: jest.fn(),
    };

    workshopClient = {
      findServiceCatalogItemById: jest.fn(),
      findPartById: jest.fn(),
    };
    sagaOrchestrator = {
      createOrderWithSaga: jest.fn(),
      requestBudget: jest.fn(),
      retryBudgetRequest: jest.fn(),
      cancelOrder: jest.fn(),
    };
    orderFlowMetrics = {
      recordOrderCreated: jest.fn(),
      recordTerminalProcessingFailure: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderStatusTransitionService,
        {
          provide: ORDER_REPOSITORY,
          useValue: orderRepository,
        },
        {
          provide: CUSTOMER_CLIENT,
          useValue: customerClient,
        },
        {
          provide: WORKSHOP_CLIENT,
          useValue: workshopClient,
        },
        {
          provide: SagaOrchestratorService,
          useValue: sagaOrchestrator,
        },
        {
          provide: ORDER_FLOW_METRICS,
          useValue: orderFlowMetrics,
        },
      ],
    }).compile();

    service = moduleRef.get(OrderService);
  });

  it("creates an order using a customer document lookup", async () => {
    customerClient.findCustomerByDocument.mockResolvedValue({
      id: "customer-1",
      document: "12345678901",
      name: "John Doe",
    });
    orderRepository.getNextSequenceForDate.mockResolvedValue(1);
    sagaOrchestrator.createOrderWithSaga.mockImplementation(
      async (order) => order,
    );

    const result = await service.create({
      customerDocument: "123.456.789-01",
      notes: "Customer reported noise",
      expectedDeliveryDate: "2026-07-30T12:00:00.000Z",
    });

    expect(customerClient.findCustomerByDocument).toHaveBeenCalledWith(
      "12345678901",
    );
    expect(orderRepository.getNextSequenceForDate).toHaveBeenCalled();
    expect(result.customer.document).toBe("12345678901");
    expect(result.number).toMatch(/^OS-\d{8}-0001$/);
    expect(orderFlowMetrics.recordOrderCreated).toHaveBeenCalledTimes(1);
  });

  it("fails to create an order when the customer does not exist", async () => {
    customerClient.findCustomerByDocument.mockResolvedValue(null);

    await expect(
      service.create({
        customerDocument: "123.456.789-01",
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "CUSTOMER_NOT_FOUND",
    });
  });

  it("associates a vehicle and stores the local snapshot", async () => {
    const order = createOrder({
      vehicleId: undefined as never,
      vehiclePlate: undefined as never,
      vehicleBrand: undefined as never,
      vehicleModel: undefined as never,
      vehicleYear: undefined as never,
    });
    orderRepository.findById.mockResolvedValue(order);
    customerClient.findVehicleById.mockResolvedValue({
      id: "vehicle-9",
      customerId: "customer-1",
      plate: "XYZ9Z99",
      brand: "Honda",
      model: "Civic",
      year: 2025,
    });
    orderRepository.save.mockImplementation(async (savedOrder) => savedOrder);

    const result = await service.associateVehicle("order-1", {
      vehicleId: "vehicle-9",
    });

    expect(result.vehicle).toMatchObject({
      id: "vehicle-9",
      plate: "XYZ9Z99",
      brand: "Honda",
    });
  });

  it("fails to associate a vehicle when it does not exist", async () => {
    orderRepository.findById.mockResolvedValue(createOrder());
    customerClient.findVehicleById.mockResolvedValue(null);

    await expect(
      service.associateVehicle("order-1", {
        vehicleId: "missing",
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "VEHICLE_NOT_FOUND",
    });
  });

  it("adds a service item using workshop snapshots", async () => {
    const order = createOrder({ id: "order-2" });
    orderRepository.findById.mockResolvedValue(order);
    workshopClient.findServiceCatalogItemById.mockResolvedValue({
      id: "service-2",
      name: "Alignment",
      unitPrice: 120,
      active: true,
    });
    orderRepository.save.mockImplementation(async (savedOrder) => savedOrder);

    const result = await service.addServiceItem("order-2", {
      serviceId: "service-2",
      quantity: 1,
    });

    expect(result.serviceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: "service-2",
          serviceName: "Alignment",
        }),
      ]),
    );
  });

  it("fails to add a service item when the workshop lookup does not find it", async () => {
    orderRepository.findById.mockResolvedValue(createOrder());
    workshopClient.findServiceCatalogItemById.mockResolvedValue(null);

    await expect(
      service.addServiceItem("order-1", {
        serviceId: "missing",
        quantity: 1,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "SERVICE_CATALOG_ITEM_NOT_FOUND",
    });
  });

  it("rejects adding a part when stock is insufficient", async () => {
    const order = createOrder({ id: "order-3" });
    orderRepository.findById.mockResolvedValue(order);
    workshopClient.findPartById.mockResolvedValue({
      id: "part-9",
      code: "PRT-009",
      name: "Filter",
      unitPrice: 35,
      availableQuantity: 1,
      active: true,
    });

    await expect(
      service.addPartItem("order-3", {
        partId: "part-9",
        quantity: 2,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "INSUFFICIENT_PART_STOCK",
    });
  });

  it("adds a part item using workshop snapshots", async () => {
    const order = createOrder({ id: "order-4" });
    orderRepository.findById.mockResolvedValue(order);
    workshopClient.findPartById.mockResolvedValue({
      id: "part-9",
      code: "PRT-009",
      name: "Filter",
      unitPrice: 35,
      availableQuantity: 10,
      active: true,
    });
    orderRepository.save.mockImplementation(async (savedOrder) => savedOrder);

    const result = await service.addPartItem("order-4", {
      partId: "part-9",
      quantity: 2,
    });

    expect(result.partItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partId: "part-9",
          partCode: "PRT-009",
        }),
      ]),
    );
  });

  it("fails to add a part item when the workshop lookup does not find it", async () => {
    orderRepository.findById.mockResolvedValue(createOrder());
    workshopClient.findPartById.mockResolvedValue(null);

    await expect(
      service.addPartItem("order-1", {
        partId: "missing",
        quantity: 1,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "PART_NOT_FOUND",
    });
  });

  it("lists orders using paginated repository results", async () => {
    orderRepository.findAll.mockResolvedValue({
      data: [createOrder()],
      meta: {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });

    const result = await service.list({
      page: 1,
      limit: 10,
      orderBy: "createdAt",
      order: "DESC",
    });

    expect(orderRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 10,
      }),
    );
    expect(result.data[0]).toMatchObject({
      id: "order-1",
      number: "OS-20260118-0001",
    });
  });

  it("updates a locally managed status", async () => {
    const order = createOrder({ status: OrderStatus.RECEIVED });
    orderRepository.findById.mockResolvedValue(order);
    orderRepository.save.mockImplementation(async (savedOrder) => savedOrder);

    const result = await service.updateStatus("order-1", {
      status: OrderStatus.IN_DIAGNOSIS,
    });

    expect(result.status).toBe(OrderStatus.IN_DIAGNOSIS);
  });

  it("moves an order to waiting budget approval when local validation passes", async () => {
    const order = createOrder({ status: OrderStatus.IN_DIAGNOSIS });
    orderRepository.findById.mockResolvedValue(order);
    orderRepository.save.mockImplementation(async (savedOrder) => savedOrder);

    const result = await service.updateStatus("order-1", {
      status: OrderStatus.WAITING_BUDGET_APPROVAL,
    });

    expect(result.status).toBe(OrderStatus.WAITING_BUDGET_APPROVAL);
  });

  it("cancels an order using the provided reason", async () => {
    const order = createOrder({ status: OrderStatus.IN_DIAGNOSIS });
    orderRepository.findById.mockResolvedValue(order);
    sagaOrchestrator.cancelOrder.mockImplementation(
      async (_orderId, reason) => {
        order.cancel(reason);
        return order;
      },
    );

    const result = await service.updateStatus("order-1", {
      status: OrderStatus.CANCELLED,
      reason: "Customer requested it",
    });

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(result.cancellationReason).toBe("Customer requested it");
  });

  it("blocks statuses managed by another service or later phase", async () => {
    const order = createOrder({ status: OrderStatus.WAITING_BUDGET_APPROVAL });
    orderRepository.findById.mockResolvedValue(order);

    await expect(
      service.updateStatus("order-1", {
        status: OrderStatus.BUDGET_APPROVED,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "STATUS_MANAGED_EXTERNALLY",
    });
  });

  it("returns public status only when the customer document matches", async () => {
    orderRepository.findByNumber.mockResolvedValue(createOrder());

    await expect(
      service.getPublicStatus({
        number: "OS-20260118-0001",
        customerDocument: "999.999.999-99",
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "PUBLIC_ORDER_ACCESS_DENIED",
    });
  });

  it("returns order history from the local repository", async () => {
    const historyEntry: OrderHistoryEntry = {
      id: "history-1",
      orderId: "order-1",
      status: OrderStatus.RECEIVED,
      description: "Order received",
      createdAt: new Date("2026-07-24T10:00:00.000Z"),
    };
    orderRepository.findById.mockResolvedValue(createOrder());
    orderRepository.findHistoryByOrderId.mockResolvedValue([historyEntry]);

    const result = await service.getHistory("order-1");

    expect(result).toEqual([
      expect.objectContaining({
        id: "history-1",
        status: OrderStatus.RECEIVED,
      }),
    ]);
  });

  it("returns public status when the customer document matches", async () => {
    orderRepository.findByNumber.mockResolvedValue(createOrder());

    const result = await service.getPublicStatus({
      number: "OS-20260118-0001",
      customerDocument: "123.456.789-01",
    });

    expect(result).toMatchObject({
      number: "OS-20260118-0001",
      status: OrderStatus.RECEIVED,
    });
  });

  it("fails when an order is requested by id and it does not exist", async () => {
    orderRepository.findById.mockResolvedValue(null);

    await expect(service.getById("missing")).rejects.toMatchObject<
      Partial<DomainException>
    >({
      code: "ORDER_NOT_FOUND",
    });
  });

  it("fails public status consultation when the order number does not exist", async () => {
    orderRepository.findByNumber.mockResolvedValue(null);

    await expect(
      service.getPublicStatus({
        number: "OS-unknown",
        customerDocument: "12345678901",
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "ORDER_NOT_FOUND",
    });
  });

  it("retries the persisted budget request when the order is already waiting for approval", async () => {
    const order = createOrder({ status: OrderStatus.WAITING_BUDGET_APPROVAL });
    orderRepository.findById.mockResolvedValue(order);

    const result = await service.updateStatus("order-1", {
      status: OrderStatus.WAITING_BUDGET_APPROVAL,
    });

    expect(sagaOrchestrator.retryBudgetRequest).toHaveBeenCalledWith("order-1");
    expect(result.status).toBe(OrderStatus.WAITING_BUDGET_APPROVAL);
    expect(orderRepository.save).not.toHaveBeenCalled();
  });

  it("delivers a finished order through the local repository", async () => {
    const order = createOrder({ status: OrderStatus.FINISHED });
    orderRepository.findById.mockResolvedValue(order);
    orderRepository.save.mockImplementation(async (savedOrder) => savedOrder);

    const result = await service.updateStatus("order-1", {
      status: OrderStatus.DELIVERED,
    });

    expect(result.status).toBe(OrderStatus.DELIVERED);
  });

  it("rejects invalid manual target statuses", async () => {
    orderRepository.findById.mockResolvedValue(createOrder());

    await expect(
      service.updateStatus("order-1", {
        status: OrderStatus.RECEIVED,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("blocks inactive workshop snapshots when adding services and parts", async () => {
    orderRepository.findById.mockResolvedValue(createOrder());
    workshopClient.findServiceCatalogItemById.mockResolvedValue({
      id: "service-2",
      name: "Alignment",
      unitPrice: 120,
      active: false,
    });
    workshopClient.findPartById.mockResolvedValue({
      id: "part-9",
      code: "PRT-009",
      name: "Filter",
      unitPrice: 35,
      availableQuantity: 10,
      active: false,
    });

    await expect(
      service.addServiceItem("order-1", {
        serviceId: "service-2",
        quantity: 1,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "SERVICE_CATALOG_ITEM_NOT_FOUND",
    });
    await expect(
      service.addPartItem("order-1", {
        partId: "part-9",
        quantity: 1,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: "PART_NOT_FOUND",
    });
  });
});
