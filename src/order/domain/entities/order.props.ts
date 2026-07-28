import { OrderStatus } from "../enums/order-status.enum";
import { OrderNumber } from "../value-objects/order-number.value-object";

export interface CreateOrderProps {
  number: OrderNumber;
  customerId: string;
  customerDocument?: string;
  customerName?: string;
  vehicleId?: string;
  vehiclePlate?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  notes?: string;
  expectedDeliveryDate?: Date;
}

export interface UpdateOrderProps {
  status?: OrderStatus;
  vehicleId?: string;
  customerDocument?: string;
  customerName?: string;
  vehiclePlate?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  notes?: string;
  expectedDeliveryDate?: Date;
  finishedAt?: Date;
  deliveredAt?: Date;
}
