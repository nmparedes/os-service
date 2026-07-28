import { Order } from "../entities/order.entity";
import { OrderHistoryEntry } from "./order-history-entry.interface";
import { OrderListFilters } from "./order-list-filters.interface";
import { PaginatedResponse } from "../../../common/interfaces/paginated-response.interface";

export interface OrderRepository {
  save(order: Order): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  findByNumber(number: string): Promise<Order | null>;
  findAll(filters: OrderListFilters): Promise<PaginatedResponse<Order>>;
  findHistoryByOrderId(orderId: string): Promise<OrderHistoryEntry[]>;
  getNextSequenceForDate(date: Date): Promise<number>;
}
