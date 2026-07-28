import { join } from "node:path";
import { defineFeature, loadFeature } from "jest-cucumber";
import { SagaOrchestratorService } from "../../src/saga/application/saga-orchestrator.service";
import {
  ApplicationMessage,
  MessageConsumer,
  MessagePublisher,
} from "../../src/saga/application/ports/message-broker";
import {
  ConsumedMessageClaim,
  ConsumedMessageLedger,
  SagaLocalRepositories,
  SagaLocalUnitOfWork,
} from "../../src/saga/application/ports/saga-local-unit-of-work";
import { SagaInstance } from "../../src/saga/domain/saga-instance.entity";
import { SagaStatus, SagaStep } from "../../src/saga/domain/saga.enums";
import { Order } from "../../src/order/domain/entities/order.entity";
import { OrderStatus } from "../../src/order/domain/enums/order-status.enum";
import { createOrder } from "../order/order.factory";

const feature = loadFeature(
  join(__dirname, "features", "complete-service-order-flow.feature"),
);

class InMemoryConsumedMessageLedger implements ConsumedMessageLedger {
  private readonly states = new Map<
    string,
    { status: "PROCESSING" | "PROCESSED" | "FAILED"; token: string }
  >();

  async claim(
    consumerName: string,
    eventId: string,
  ): Promise<ConsumedMessageClaim | null> {
    const key = `${consumerName}:${eventId}`;
    const current = this.states.get(key);
    if (current?.status === "PROCESSED") {
      return null;
    }

    const token = `${key}:token`;
    this.states.set(key, { status: "PROCESSING", token });
    return { token };
  }

  async markProcessed(
    consumerName: string,
    eventId: string,
    token: string,
  ): Promise<void> {
    const key = `${consumerName}:${eventId}`;
    this.states.set(key, { status: "PROCESSED", token });
  }

  async markFailed(
    consumerName: string,
    eventId: string,
    token: string,
  ): Promise<void> {
    const key = `${consumerName}:${eventId}`;
    this.states.set(key, { status: "FAILED", token });
  }
}

class InMemoryPublisher implements MessagePublisher {
  readonly messages: Array<{
    exchange: string;
    routingKey: string;
    message: ApplicationMessage;
  }> = [];

  async publish(
    exchange: string,
    routingKey: string,
    message: ApplicationMessage,
  ): Promise<void> {
    this.messages.push({
      exchange,
      routingKey,
      message: JSON.parse(JSON.stringify(message)) as ApplicationMessage,
    });
  }
}

class InMemoryConsumer implements MessageConsumer {
  private readonly handlers = new Map<
    string,
    (message: ApplicationMessage) => Promise<void>
  >();

  async subscribe(
    queue: string,
    handler: (message: ApplicationMessage) => Promise<void>,
  ): Promise<void> {
    this.handlers.set(queue, handler);
  }

  async deliver(queue: string, message: ApplicationMessage): Promise<void> {
    const handler = this.handlers.get(queue);
    if (!handler) {
      throw new Error(`Missing consumer for queue ${queue}`);
    }

    await handler(JSON.parse(JSON.stringify(message)) as ApplicationMessage);
  }
}

class InMemoryOrderRepository {
  private current: Order | null = null;

  constructor(initialOrder: Order) {
    this.current = initialOrder;
  }

  async save(order: Order): Promise<Order> {
    this.current = order;
    return order;
  }

  async findById(orderId: string): Promise<Order | null> {
    return this.current?.id === orderId ? this.current : null;
  }

  currentOrder(): Order {
    if (!this.current) {
      throw new Error("Order was not persisted.");
    }
    return this.current;
  }
}

class InMemorySagaRepository {
  private current: SagaInstance | null = null;

  async create(saga: SagaInstance): Promise<SagaInstance> {
    this.current = saga;
    return saga;
  }

  async findById(sagaId: string): Promise<SagaInstance | null> {
    return this.current?.values.sagaId === sagaId ? this.current : null;
  }

  async findByOrderId(orderId: string): Promise<SagaInstance | null> {
    return this.current?.values.orderId === orderId ? this.current : null;
  }

  async save(saga: SagaInstance): Promise<SagaInstance> {
    this.current = SagaInstance.restore({
      ...saga.values,
      version: saga.values.version + 1,
    });
    return this.current;
  }

  currentSaga(): SagaInstance {
    if (!this.current) {
      throw new Error("Saga was not persisted.");
    }
    return this.current;
  }
}

class InMemorySagaLocalUnitOfWork implements SagaLocalUnitOfWork {
  readonly consumedMessages: ConsumedMessageLedger;

  constructor(
    private readonly orders: InMemoryOrderRepository,
    private readonly sagas: InMemorySagaRepository,
    ledger: ConsumedMessageLedger,
  ) {
    this.consumedMessages = ledger;
  }

  async execute<T>(
    work: (repositories: SagaLocalRepositories) => Promise<T>,
  ): Promise<T> {
    return work({
      orders: this.orders as never,
      sagas: this.sagas as never,
      consumedMessages: this.consumedMessages,
    });
  }
}

defineFeature(feature, (test) => {
  test("Finish a service order through the happy path Saga flow", ({
    given,
    when,
    and,
    then,
  }) => {
    let order: Order;
    let publisher: InMemoryPublisher;
    let consumer: InMemoryConsumer;
    let orders: InMemoryOrderRepository;
    let sagas: InMemorySagaRepository;
    let orchestrator: SagaOrchestratorService;
    let budgetRequest: ApplicationMessage;
    let stockReserveRequest: ApplicationMessage;
    let executionRequest: ApplicationMessage;
    let flowCorrelationId = "";
    let flowSagaId = "";

    given("a valid service order is ready to start its Saga", async () => {
      order = createOrder();
      publisher = new InMemoryPublisher();
      consumer = new InMemoryConsumer();
      orders = new InMemoryOrderRepository(order);
      sagas = new InMemorySagaRepository();

      orchestrator = new SagaOrchestratorService(
        new InMemorySagaLocalUnitOfWork(
          orders,
          sagas,
          new InMemoryConsumedMessageLedger(),
        ) as never,
        { get: jest.fn().mockReturnValue(true) } as never,
        publisher,
        consumer,
        {
          recordOrderCreated: jest.fn(),
          recordTerminalProcessingFailure: jest.fn(),
        },
      );

      await orchestrator.onModuleInit();
      await orchestrator.createOrderWithSaga(order);
      order.sendForBudgetApproval();
      await orchestrator.requestBudget(order);

      [budgetRequest] = publisher.messages.map((entry) => entry.message);
      flowCorrelationId = budgetRequest.correlationId;
      flowSagaId = sagas.currentSaga().values.sagaId;
    });

    when("the budget is created and approved", async () => {
      await consumer.deliver(
        "os.billing.events",
        message("budget.created", order.id, flowSagaId, flowCorrelationId, {
          budgetId: "budget-001",
          status: "CREATED",
          totalAmount: 450,
          currency: "BRL",
        }),
      );
      await consumer.deliver(
        "os.billing.events",
        message("budget.approved", order.id, flowSagaId, flowCorrelationId, {
          budgetId: "budget-001",
          status: "APPROVED",
          totalAmount: 450,
          currency: "BRL",
        }),
      );
    });

    and("the payment is created and approved", async () => {
      await consumer.deliver(
        "os.billing.events",
        message("payment.created", order.id, flowSagaId, flowCorrelationId, {
          paymentId: "payment-001",
          budgetId: "budget-001",
          status: "PENDING",
        }),
      );
      await consumer.deliver(
        "os.billing.events",
        message("payment.approved", order.id, flowSagaId, flowCorrelationId, {
          paymentId: "payment-001",
          budgetId: "budget-001",
          status: "APPROVED",
        }),
      );

      stockReserveRequest = lastPublishedCommand(
        publisher,
        "stock.reserve.requested",
      );
    });

    and("the stock is reserved", async () => {
      await consumer.deliver(
        "os.workshop.events",
        message(
          "stock.reserved",
          order.id,
          flowSagaId,
          flowCorrelationId,
          {
            reservations: [{ partId: "part-1", quantity: 3 }],
          },
          {
            causationId: stockReserveRequest.eventId,
          },
        ),
      );

      executionRequest = lastPublishedCommand(publisher, "execution.requested");
    });

    and("the workshop starts and finishes the execution", async () => {
      await consumer.deliver(
        "os.workshop.events",
        message(
          "execution.started",
          order.id,
          flowSagaId,
          flowCorrelationId,
          {},
          {
            causationId: executionRequest.eventId,
          },
        ),
      );
      await consumer.deliver(
        "os.workshop.events",
        message(
          "execution.finished",
          order.id,
          flowSagaId,
          flowCorrelationId,
          {},
          {
            causationId: executionRequest.eventId,
          },
        ),
      );
    });

    then("the service order is finished", () => {
      expect(orders.currentOrder().status).toBe(OrderStatus.FINISHED);
    });

    and("the Saga is completed", () => {
      const saga = sagas.currentSaga();
      expect(saga.values.status).toBe(SagaStatus.COMPLETED);
      expect(saga.values.currentStep).toBe(SagaStep.FINISHED);
    });

    and("the expected commands were published without compensation", () => {
      const publishedRoutingKeys = publisher.messages.map(
        (entry) => entry.routingKey,
      );

      expect(publishedRoutingKeys).toEqual([
        "budget.requested",
        "stock.reserve.requested",
        "execution.requested",
      ]);
      expect(publishedRoutingKeys).not.toContain("stock.release.requested");
      expect(publishedRoutingKeys).not.toContain("payment.refund.requested");
    });

    and(
      "the same correlation and Saga identifiers are preserved through the flow",
      () => {
        const saga = sagas.currentSaga();

        expect(budgetRequest.orderId).toBe(order.id);
        expect(budgetRequest.sagaId).toBe(saga.values.sagaId);
        expect(stockReserveRequest.orderId).toBe(order.id);
        expect(stockReserveRequest.sagaId).toBe(saga.values.sagaId);
        expect(executionRequest.orderId).toBe(order.id);
        expect(executionRequest.sagaId).toBe(saga.values.sagaId);

        expect(budgetRequest.correlationId).toBe(flowCorrelationId);
        expect(stockReserveRequest.correlationId).toBe(flowCorrelationId);
        expect(executionRequest.correlationId).toBe(flowCorrelationId);
      },
    );
  });
});

function message(
  eventName: string,
  orderId: string,
  sagaId: string,
  correlationId: string,
  payload: unknown,
  overrides: Partial<ApplicationMessage> = {},
): ApplicationMessage {
  return {
    eventId: `${eventName}-001`,
    eventName,
    eventVersion: 1,
    occurredAt: "2026-01-18T12:00:00.000Z",
    correlationId,
    causationId: "budget.requested-001",
    sagaId,
    orderId,
    payload,
    ...overrides,
  };
}

function lastPublishedCommand(
  publisher: InMemoryPublisher,
  routingKey: string,
): ApplicationMessage {
  const match = [...publisher.messages]
    .reverse()
    .find((entry) => entry.routingKey === routingKey);

  if (!match) {
    throw new Error(`Published command ${routingKey} was not found.`);
  }

  return match.message;
}
