import { SagaInstance } from "../saga-instance.entity";

export interface SagaInstanceRepository {
  create(saga: SagaInstance): Promise<SagaInstance>;
  findById(sagaId: string): Promise<SagaInstance | null>;
  findByOrderId(orderId: string): Promise<SagaInstance | null>;
  save(saga: SagaInstance, expectedVersion: number): Promise<SagaInstance>;
}
