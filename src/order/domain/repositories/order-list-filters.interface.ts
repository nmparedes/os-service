import { OrderStatus } from "../enums/order-status.enum";

export interface OrderListFilters {
  number?: string;
  statuses?: OrderStatus[];
  customerId?: string;
  customerDocument?: string;
  customerName?: string;
  vehicleId?: string;
  vehiclePlate?: string;
  receivedAtFrom?: Date;
  receivedAtTo?: Date;
  finishedAtFrom?: Date;
  finishedAtTo?: Date;
  minTotalAmount?: number;
  maxTotalAmount?: number;
  page: number;
  limit: number;
  orderBy:
    | "number"
    | "status"
    | "receivedAt"
    | "finishedAt"
    | "totalAmount"
    | "createdAt";
  order: "ASC" | "DESC";
}
