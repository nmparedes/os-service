export interface ApplicationMessage {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId: string;
  sagaId: string;
  orderId: string;
  payload: unknown;
}

export interface MessagePublisher {
  publish(
    exchange: string,
    routingKey: string,
    message: ApplicationMessage,
  ): Promise<void>;
}

export interface MessageConsumer {
  subscribe(
    queue: string,
    handler: (message: ApplicationMessage) => Promise<void>,
  ): Promise<void>;
}

export const MESSAGE_PUBLISHER = Symbol("MESSAGE_PUBLISHER");
export const MESSAGE_CONSUMER = Symbol("MESSAGE_CONSUMER");
