import { SagaOrchestratorService } from "../../src/saga/application/saga-orchestrator.service";
import { OrderFlowMetrics } from "../../src/saga/application/ports/order-flow-metrics.port";
import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import { SagaStep } from "../../src/saga/domain/saga.enums";
import { OrderStatus } from "../../src/order/domain/enums/order-status.enum";
import { createOrder } from "../order/order.factory";

describe("SagaOrchestratorService", () => {
  let service: SagaOrchestratorService;
  let saga: SagaInstance;
  let order = createOrder();
  let publisher: { publish: jest.Mock };
  let consumer: { subscribe: jest.Mock };
  let claims: {
    claim: jest.Mock;
    markProcessed: jest.Mock;
    markFailed: jest.Mock;
  };
  let sagas: {
    findById: jest.Mock;
    findByOrderId: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orders: { findById: jest.Mock; save: jest.Mock };
  let orderFlowMetrics: jest.Mocked<OrderFlowMetrics>;

  beforeEach(() => {
    saga = SagaInstance.create(order.id, "saga-001");
    order = createOrder();
    publisher = { publish: jest.fn() };
    consumer = { subscribe: jest.fn() };
    claims = {
      claim: jest.fn().mockResolvedValue({ token: "claim-001" }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    sagas = {
      findById: jest.fn().mockImplementation(async () => saga),
      findByOrderId: jest.fn().mockImplementation(async () => saga),
      create: jest.fn().mockResolvedValue(saga),
      save: jest.fn().mockImplementation(async (current: SagaInstance) => {
        saga = SagaInstance.restore({
          ...current.values,
          version: current.values.version + 1,
        });
        return saga;
      }),
    };
    orders = {
      findById: jest.fn().mockImplementation(async () => order),
      save: jest.fn().mockImplementation(async (current) => current),
    };
    orderFlowMetrics = {
      recordOrderCreated: jest.fn(),
      recordTerminalProcessingFailure: jest.fn(),
    };
    const unitOfWork = {
      consumedMessages: claims,
      execute: async <T>(
        work: (repositories: {
          orders: typeof orders;
          sagas: typeof sagas;
          consumedMessages: typeof claims;
        }) => Promise<T>,
      ): Promise<T> => work({ orders, sagas, consumedMessages: claims }),
    };
    service = new SagaOrchestratorService(
      unitOfWork as never,
      { get: jest.fn().mockReturnValue(true) } as never,
      publisher,
      consumer,
      orderFlowMetrics,
    );
  });

  it("creates the order and its active saga without publishing a budget", async () => {
    await service.createOrderWithSaga(order);
    expect(orders.save).toHaveBeenCalledWith(order);
    expect(sagas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({
          currentStep: SagaStep.ORDER_PREPARATION,
        }),
      }),
    );
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publishes the persisted budget snapshot only after the manual transition", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    expect(saga.values.currentStep).toBe(SagaStep.BUDGET_REQUESTED);
    expect(publisher.publish).toHaveBeenCalledWith(
      "orders.topic",
      "budget.requested",
      expect.objectContaining({
        eventName: "budget.requested",
        eventVersion: 1,
        orderId: order.id,
        payload: expect.objectContaining({
          orderNumber: order.number.value,
          partItems: [
            {
              partId: "part-1",
              partCode: "BRK-001",
              partName: "Brake Pad",
              unitPrice: 50,
              quantity: 3,
            },
          ],
        }),
      }),
    );
  });

  it("rebuilds an identical budget command after a publish retry", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    const first = publisher.publish.mock.calls[0][2];
    await service.retryBudgetRequest(order.id);
    expect(publisher.publish.mock.calls[1][2]).toEqual(first);
  });

  it("fails budget request when the saga is missing", async () => {
    sagas.findByOrderId.mockResolvedValueOnce(null);

    await expect(service.requestBudget(order)).rejects.toMatchObject({
      code: "SAGA_NOT_FOUND",
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("fails budget request when the saga is not in ORDER_PREPARATION or BUDGET_REQUESTED", async () => {
    saga.transitionTo(SagaStep.BUDGET_REQUESTED);
    saga.setBudgetId("budget-001");
    saga.transitionTo(SagaStep.WAITING_BUDGET_APPROVAL);

    await expect(service.requestBudget(order)).rejects.toMatchObject({
      code: "SAGA_INVALID_STEP",
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("fails budget retry when the saga or order is missing", async () => {
    orders.findById.mockResolvedValueOnce(null);

    await expect(service.retryBudgetRequest(order.id)).rejects.toMatchObject({
      code: "SAGA_NOT_FOUND",
    });
  });

  it("fails budget retry when the budget command is not pending", async () => {
    await expect(service.retryBudgetRequest(order.id)).rejects.toMatchObject({
      code: "SAGA_INVALID_STEP",
    });
  });

  it("runs the OS happy path and publishes stock then execution commands", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    expect(order.status).toBe(OrderStatus.BUDGET_APPROVED);
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    expect(saga.values.paymentApprovedAt).toEqual(
      new Date("2026-01-18T12:00:00.000Z"),
    );
    expect(publisher.publish).toHaveBeenLastCalledWith(
      "orders.topic",
      "stock.reserve.requested",
      expect.objectContaining({
        eventName: "stock.reserve.requested",
        sagaId: "saga-001",
      }),
    );
    await workshop(service, "stock.reserved", {
      reservations: [{ partId: "part-1", quantity: 3 }],
    });
    expect(publisher.publish).toHaveBeenLastCalledWith(
      "orders.topic",
      "execution.requested",
      expect.objectContaining({ eventName: "execution.requested" }),
    );
    await workshop(service, "execution.started", {});
    await workshop(service, "execution.finished", {});
    expect(order.status).toBe(OrderStatus.FINISHED);
    expect(saga.values.currentStep).toBe(SagaStep.FINISHED);
  });

  it("handles budget.rejected without creating compensation commands", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });

    await billing(service, "budget.rejected", {
      budgetId: "budget-001",
      status: "REJECTED",
      totalAmount: 450,
      currency: "BRL",
      rejectionReason: "customer rejected",
    });

    expect(order.status).toBe(OrderStatus.BUDGET_REJECTED);
    expect(saga.values.status).toBe("FAILED");
    expect(saga.values.compensationStatus).toBe("NOT_REQUIRED");
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(
      orderFlowMetrics.recordTerminalProcessingFailure,
    ).toHaveBeenCalledTimes(1);
  });

  it("handles payment.failed as a local cancellation without refund", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });

    await billing(service, "payment.failed", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "FAILED",
    });

    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(saga.values.status).toBe("FAILED");
    expect(saga.values.compensationStatus).toBe("NOT_REQUIRED");
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("rejects payment.failed after approval was already recorded", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });

    await expect(
      billing(service, "payment.failed", {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "FAILED",
      }),
    ).rejects.toMatchObject({ code: "SAGA_EVENT_CONFLICT" });
  });

  it("keeps cancellation waiting for the stock result when payment approval already published stock reservation", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    await service.cancelOrder(order.id, "customer cancellation");

    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(saga.values.stockReleaseStatus).toBe(
      "WAITING_RESOURCE_CONFIRMATION",
    );
  });

  it("waits for late stock confirmation after cancellation and publishes release before refund", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    publisher.publish.mockClear();

    await service.cancelOrder(order.id, "cancel while waiting stock");
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(saga.values.stockReleaseStatus).toBe(
      "WAITING_RESOURCE_CONFIRMATION",
    );

    await workshop(service, "stock.reserved", {
      reservations: [{ partId: "part-1", quantity: 3 }],
    });

    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(publisher.publish).toHaveBeenCalledWith(
      "orders.topic",
      "stock.release.requested",
      expect.objectContaining({
        eventName: "stock.release.requested",
        payload: {
          reservations: [{ partId: "part-1", quantity: 3 }],
        },
      }),
    );
  });

  it("moves to manual intervention on stock.release.failed and does not publish refund", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    await service.cancelOrder(order.id, "cancel while waiting stock");
    await workshop(service, "stock.reserved", {
      reservations: [{ partId: "part-1", quantity: 3 }],
    });
    publisher.publish.mockClear();
    const releaseCommand = saga.values.stockReleaseCommand;
    expect(releaseCommand).toBeTruthy();

    await workshopWithMessage(service, {
      eventId: "stock.release.failed-001",
      eventName: "stock.release.failed",
      eventVersion: 1,
      occurredAt: "2026-01-18T12:05:00.000Z",
      correlationId: releaseCommand?.correlationId ?? "missing",
      causationId: releaseCommand?.eventId ?? "missing",
      sagaId: "saga-001",
      orderId: "order-1",
      payload: {
        reservations: [
          {
            partId: "part-1",
            quantity: 3,
            status: "FAILED",
            failureCode: "STOCK_RESERVATION_ALREADY_COMMITTED",
          },
        ],
      },
    });

    expect(saga.values.status).toBe("MANUAL_INTERVENTION_REQUIRED");
    expect(saga.values.compensationStatus).toBe("FAILED");
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(orderFlowMetrics.recordTerminalProcessingFailure).toHaveBeenCalled();
  });

  it("publishes refund directly when a late stock.reservation.failed confirms that nothing was reserved", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    publisher.publish.mockClear();

    await service.cancelOrder(order.id, "cancel while waiting stock");
    await workshop(service, "stock.reservation.failed", {
      reservations: [
        {
          partId: "part-1",
          quantity: 3,
          status: "FAILED",
          failureCode: "PART_NOT_FOUND",
        },
      ],
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      "orders.topic",
      "payment.refund.requested",
      expect.objectContaining({
        eventName: "payment.refund.requested",
        payload: {
          paymentId: "payment-001",
          reason: "cancel while waiting stock",
        },
      }),
    );
    expect(saga.values.stockReleaseCommand).toBeNull();
  });

  it("records refund completion after explicit payment.refunded", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await service.cancelOrder(order.id, "customer cancellation");
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    publisher.publish.mockClear();
    const refundCommand = saga.values.paymentRefundCommand;
    expect(refundCommand).toBeTruthy();

    await billingWithMessage(service, {
      eventId: "payment.refunded-001",
      eventName: "payment.refunded",
      eventVersion: 1,
      occurredAt: "2026-01-18T12:05:00.000Z",
      correlationId: refundCommand?.correlationId ?? "missing",
      causationId: refundCommand?.eventId ?? "missing",
      sagaId: "saga-001",
      orderId: "order-1",
      payload: {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "REFUNDED",
        providerPaymentId: "provider-payment-001",
        providerRefundId: "provider-refund-001",
      },
    });

    expect(saga.values.status).toBe("COMPENSATED");
    expect(saga.values.compensationStatus).toBe("COMPLETED");
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("converts a late payment.approved after cancellation into a persisted refund command", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    publisher.publish.mockClear();

    await service.cancelOrder(order.id, "cancel before approval");
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(publisher.publish).not.toHaveBeenCalled();

    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });

    expect(saga.values.status).toBe("COMPENSATING");
    expect(publisher.publish).toHaveBeenCalledWith(
      "orders.topic",
      "payment.refund.requested",
      expect.objectContaining({
        eventName: "payment.refund.requested",
        payload: {
          paymentId: "payment-001",
          reason: "cancel before approval",
        },
      }),
    );
  });

  it("moves to manual intervention when payment.refund.failed is confirmed", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await service.cancelOrder(order.id, "customer cancellation");
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    publisher.publish.mockClear();
    const refundCommand = saga.values.paymentRefundCommand;

    await billingWithMessage(service, {
      eventId: "payment.refund.failed-001",
      eventName: "payment.refund.failed",
      eventVersion: 1,
      occurredAt: "2026-01-18T12:05:00.000Z",
      correlationId: refundCommand?.correlationId ?? "missing",
      causationId: refundCommand?.eventId ?? "missing",
      sagaId: "saga-001",
      orderId: "order-1",
      payload: {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "REFUND_FAILED",
        providerPaymentId: "provider-payment-001",
        failureCode: "REFUND_PROVIDER_REJECTED",
      },
    });

    expect(saga.values.status).toBe("MANUAL_INTERVENTION_REQUIRED");
    expect(saga.values.compensationStatus).toBe("FAILED");
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publishes stock release after execution.failed when stock was already reserved", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    await workshop(service, "stock.reserved", {
      reservations: [{ partId: "part-1", quantity: 3 }],
    });
    publisher.publish.mockClear();

    await workshop(service, "execution.failed", {
      failureCode: "EXECUTION_FAILURE",
    });

    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(publisher.publish).toHaveBeenCalledWith(
      "orders.topic",
      "stock.release.requested",
      expect.objectContaining({
        eventName: "stock.release.requested",
        payload: {
          reservations: [{ partId: "part-1", quantity: 3 }],
        },
      }),
    );
  });

  it("does not connect or publish when messaging is disabled", async () => {
    (
      service as never as { configService: { get: jest.Mock } }
    ).configService.get.mockReturnValue(false);
    await service.onModuleInit();
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    expect(consumer.subscribe).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("subscribes only to the two assigned concrete event queues", async () => {
    await service.onModuleInit();
    expect(consumer.subscribe).toHaveBeenNthCalledWith(
      1,
      "os.billing.events",
      expect.any(Function),
    );
    expect(consumer.subscribe).toHaveBeenNthCalledWith(
      2,
      "os.workshop.events",
      expect.any(Function),
    );
  });

  it("leaves a retryable claim when publisher confirmation fails", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    publisher.publish.mockRejectedValueOnce(new Error("broker unavailable"));

    await expect(
      billing(service, "payment.approved", {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "APPROVED",
      }),
    ).rejects.toThrow("broker unavailable");
    expect(claims.markFailed).toHaveBeenCalledWith(
      "os.billing.events",
      "payment.approved-001",
      "claim-001",
    );

    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    const firstCommand = publisher.publish.mock.calls[1][2];
    expect(publisher.publish).toHaveBeenLastCalledWith(
      "orders.topic",
      "stock.reserve.requested",
      firstCommand,
    );
    expect(publisher.publish.mock.calls[2][2]).toEqual(firstCommand);
  });

  it("rebuilds the stock command from reloaded saga state after a publish failure", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    publisher.publish.mockRejectedValueOnce(new Error("broker unavailable"));
    await expect(
      billing(service, "payment.approved", {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "APPROVED",
      }),
    ).rejects.toThrow("broker unavailable");
    const persistedValues = saga.values;
    saga = SagaInstance.restore({
      ...persistedValues,
      stepOccurredAt: { ...persistedValues.stepOccurredAt },
      commandContexts: { ...persistedValues.commandContexts },
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    expect(publisher.publish.mock.calls[2][2]).toEqual(
      publisher.publish.mock.calls[1][2],
    );
  });

  it("rebuilds the execution command from reloaded saga state after a publish failure", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    await billing(service, "payment.approved", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "APPROVED",
    });
    publisher.publish.mockRejectedValueOnce(new Error("broker unavailable"));
    await expect(
      workshop(service, "stock.reserved", {
        reservations: [{ partId: "part-1", quantity: 3 }],
      }),
    ).rejects.toThrow("broker unavailable");
    const persistedValues = saga.values;
    saga = SagaInstance.restore({
      ...persistedValues,
      stepOccurredAt: { ...persistedValues.stepOccurredAt },
      commandContexts: { ...persistedValues.commandContexts },
    });
    await workshop(service, "stock.reserved", {
      reservations: [{ partId: "part-1", quantity: 3 }],
    });
    expect(publisher.publish.mock.calls[3][2]).toEqual(
      publisher.publish.mock.calls[2][2],
    );
  });

  it("rejects invalid envelopes before advancing the saga", async () => {
    await expect(
      billing(service, "budget.created", {
        budgetId: "",
        status: "CREATED",
        totalAmount: 450,
        currency: "BRL",
      }),
    ).rejects.toMatchObject({ code: "SAGA_INVALID_MESSAGE" });
    expect(claims.claim).toHaveBeenCalledWith(
      "os.billing.events",
      "budget.created-001",
    );
    expect(saga.values.currentStep).toBe(SagaStep.ORDER_PREPARATION);
  });

  it("validates all command and result boundaries before mutating local state", () => {
    const internals = service as unknown as {
      validateEnvelope: (message: unknown, events: string[]) => void;
      requireStockReservedPayload: (payload: unknown) => unknown;
      requireStockReservationFailedPayload: (
        order: unknown,
        payload: unknown,
      ) => unknown;
      requireStockReleasedPayload: (
        command: unknown,
        payload: unknown,
      ) => unknown;
      requireStockReleaseFailedPayload: (
        command: unknown,
        payload: unknown,
      ) => unknown;
      requireExecutionFailedPayload: (payload: unknown) => unknown;
      requireEmptyPayload: (payload: unknown) => void;
      requireSameReservationItems: (
        current: unknown,
        reservations: unknown,
      ) => void;
      requireIdentifierMatch: (
        actual: string | null,
        expected: string,
        field: string,
      ) => void;
      requireStep: (current: SagaInstance, expected: SagaStep) => void;
    };
    for (const invalid of [
      { ...envelope("budget.created", {}), eventVersion: 2 },
      { ...envelope("budget.created", {}), eventId: "" },
      { ...envelope("budget.created", {}), sagaId: "" },
      { ...envelope("budget.created", {}), orderId: "" },
      { ...envelope("budget.created", {}), correlationId: "" },
      { ...envelope("budget.created", {}), causationId: "" },
      { ...envelope("budget.created", {}), occurredAt: "" },
    ]) {
      expect(() =>
        internals.validateEnvelope(invalid, ["budget.created"]),
      ).toThrow("envelope");
    }
    expect(() =>
      internals.requireStockReservedPayload({ reservations: [] }),
    ).toThrow("required");
    expect(() =>
      internals.requireStockReservedPayload({
        reservations: [{ partId: "", quantity: 1 }],
      }),
    ).toThrow("invalid");
    expect(() =>
      internals.requireStockReservedPayload({
        reservations: [{ partId: "part-1", quantity: 1.5 }],
      }),
    ).toThrow("invalid");
    expect(() =>
      internals.requireStockReservationFailedPayload(order, {
        reservations: [
          { partId: "part-1", quantity: 3, status: "FAILED" },
          {
            partId: "part-1",
            quantity: 3,
            status: "FAILED",
            failureCode: "PART_NOT_FOUND",
          },
        ],
      }),
    ).toThrow("invalid");
    expect(() =>
      internals.requireStockReservationFailedPayload(order, {
        reservations: [{ partId: "part-1", quantity: 3, status: "RESERVED" }],
      }),
    ).toThrow("at least one failed item");
    expect(() =>
      internals.requireSameReservationItems(order, [
        { partId: "part-1", quantity: 2 },
      ]),
    ).toThrow("do not match");
    expect(() =>
      internals.requireIdentifierMatch(null, "value", "budgetId"),
    ).toThrow("does not match");
    expect(() => internals.requireStep(saga, SagaStep.WAITING_PAYMENT)).toThrow(
      "current saga step",
    );
    expect(() => internals.requireExecutionFailedPayload({})).toThrow(
      "Execution failure payload is invalid",
    );
    expect(() => internals.requireEmptyPayload({ ignored: true })).toThrow(
      "payload must be empty",
    );
  });

  it("validates persisted compensation result payloads against the stored command", () => {
    const internals = service as unknown as {
      requireStockReleasedPayload: (
        command: unknown,
        payload: unknown,
      ) => unknown;
      requireStockReleaseFailedPayload: (
        command: unknown,
        payload: unknown,
      ) => unknown;
    };
    const command = {
      eventId: "stock.release.requested-001",
      eventName: "stock.release.requested",
      eventVersion: 1,
      occurredAt: new Date("2026-01-18T12:00:00.000Z"),
      correlationId: "correlation-001",
      causationId: "causation-001",
      sagaId: "saga-001",
      orderId: "order-1",
      payload: {
        reservations: [{ partId: "part-1", quantity: 3 }],
      },
    };

    expect(() =>
      internals.requireStockReleasedPayload(null, {
        reservations: [{ partId: "part-1", quantity: 3, status: "RELEASED" }],
      }),
    ).toThrow("was not persisted");
    expect(() =>
      internals.requireStockReleasedPayload(command, {
        reservations: [{ partId: "part-1", quantity: 3, status: "FAILED" }],
      }),
    ).toThrow("does not match");

    expect(() =>
      internals.requireStockReleaseFailedPayload(command, {
        reservations: [{ partId: "part-1", quantity: 3, status: "RELEASED" }],
      }),
    ).toThrow("at least one failed item");
    expect(() =>
      internals.requireStockReleaseFailedPayload(command, {
        reservations: [
          {
            partId: "part-1",
            quantity: 3,
            status: "RELEASED",
            failureCode: "INVALID",
          },
        ],
      }),
    ).toThrow("cannot contain failure codes");
    expect(() =>
      internals.requireStockReleaseFailedPayload(command, {
        reservations: [{ partId: "part-1", quantity: 3, status: "FAILED" }],
      }),
    ).toThrow("require a failure code");
  });

  it("rejects future events and marks their claim for retry", async () => {
    await expect(
      billing(service, "payment.approved", {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "APPROVED",
      }),
    ).rejects.toMatchObject({ code: "SAGA_IDENTIFIER_MISMATCH" });
    expect(claims.markFailed).toHaveBeenCalled();
  });

  it("marks the claim as failed when the handler raises a technical error", async () => {
    orders.findById.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      billing(service, "budget.created", {
        budgetId: "budget-001",
        status: "CREATED",
        totalAmount: 450,
        currency: "BRL",
      }),
    ).rejects.toThrow("database unavailable");
    expect(claims.markFailed).toHaveBeenCalledWith(
      "os.billing.events",
      "budget.created-001",
      "claim-001",
    );
  });

  it("treats a processed duplicate as a no-op", async () => {
    claims.claim.mockResolvedValueOnce(null);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    expect(sagas.save).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("does not publish when the local transaction rejects a concurrent update", async () => {
    order.sendForBudgetApproval();
    await service.requestBudget(order);
    await billing(service, "budget.created", {
      budgetId: "budget-001",
      status: "CREATED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "budget.approved", {
      budgetId: "budget-001",
      status: "APPROVED",
      totalAmount: 450,
      currency: "BRL",
    });
    await billing(service, "payment.created", {
      paymentId: "payment-001",
      budgetId: "budget-001",
      status: "PENDING",
    });
    sagas.save.mockRejectedValueOnce(new Error("optimistic conflict"));

    await expect(
      billing(service, "payment.approved", {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "APPROVED",
      }),
    ).rejects.toThrow("optimistic conflict");
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(claims.markFailed).toHaveBeenCalled();
  });

  it("rejects unsupported billing events at the application boundary", async () => {
    await expect(
      (
        service as unknown as {
          handleBillingEvent: (
            message: ReturnType<typeof envelope>,
          ) => Promise<void>;
        }
      ).handleBillingEvent(envelope("unsupported.event", {})),
    ).rejects.toMatchObject({ code: "SAGA_INVALID_MESSAGE" });
  });

  it("rejects unsupported workshop events at the application boundary", async () => {
    await expect(
      (
        service as unknown as {
          handleWorkshopEvent: (
            message: ReturnType<typeof envelope>,
          ) => Promise<void>;
        }
      ).handleWorkshopEvent(envelope("unsupported.workshop", {})),
    ).rejects.toMatchObject({ code: "SAGA_INVALID_MESSAGE" });
  });
});

function envelope(eventName: string, payload: unknown) {
  return {
    eventId: `${eventName}-001`,
    eventName,
    eventVersion: 1,
    occurredAt: "2026-01-18T12:00:00.000Z",
    correlationId: "correlation-001",
    causationId: "causation-001",
    sagaId: "saga-001",
    orderId: "order-1",
    payload,
  };
}

function billing(
  service: SagaOrchestratorService,
  eventName: string,
  payload: unknown,
) {
  return billingWithMessage(service, envelope(eventName, payload));
}

function billingWithMessage(
  service: SagaOrchestratorService,
  message: ReturnType<typeof envelope>,
) {
  return (
    service as never as {
      handleBillingEvent: (
        message: ReturnType<typeof envelope>,
      ) => Promise<void>;
    }
  ).handleBillingEvent(message);
}

function workshop(
  service: SagaOrchestratorService,
  eventName: string,
  payload: unknown,
) {
  return workshopWithMessage(service, envelope(eventName, payload));
}

function workshopWithMessage(
  service: SagaOrchestratorService,
  message: ReturnType<typeof envelope>,
) {
  return (
    service as never as {
      handleWorkshopEvent: (
        message: ReturnType<typeof envelope>,
      ) => Promise<void>;
    }
  ).handleWorkshopEvent(message);
}
