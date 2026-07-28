import { OrderRepository } from "../../../order/domain/repositories/order.repository.interface";
import { SagaInstanceRepository } from "../../domain/repositories/saga-instance.repository.interface";

export interface ConsumedMessageClaim {
  token: string;
}

export interface ConsumedMessageLedger {
  claim(
    consumerName: string,
    eventId: string,
  ): Promise<ConsumedMessageClaim | null>;
  markProcessed(
    consumerName: string,
    eventId: string,
    token: string,
  ): Promise<void>;
  markFailed(
    consumerName: string,
    eventId: string,
    token: string,
  ): Promise<void>;
}

export interface SagaLocalRepositories {
  orders: OrderRepository;
  sagas: SagaInstanceRepository;
  consumedMessages: ConsumedMessageLedger;
}

export interface SagaLocalUnitOfWork {
  execute<T>(
    work: (repositories: SagaLocalRepositories) => Promise<T>,
  ): Promise<T>;
  readonly consumedMessages: ConsumedMessageLedger;
}

export const SAGA_LOCAL_UNIT_OF_WORK = Symbol("SAGA_LOCAL_UNIT_OF_WORK");
