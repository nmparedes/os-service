import { OrderStatus } from "../enums/order-status.enum";

export interface OrderHistoryEntry {
  id: string;
  orderId: string;
  status: OrderStatus;
  description: string;
  reason?: string;
  createdAt: Date;
}
