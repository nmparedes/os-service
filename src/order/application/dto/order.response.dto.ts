import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderStatus } from "../../domain/enums/order-status.enum";

export class OrderCustomerSnapshotResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  document?: string;

  @ApiPropertyOptional()
  name?: string;
}

export class OrderVehicleSnapshotResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  plate?: string;

  @ApiPropertyOptional()
  brand?: string;

  @ApiPropertyOptional()
  model?: string;

  @ApiPropertyOptional()
  year?: number;
}

export class OrderServiceItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  serviceId: string;

  @ApiProperty()
  serviceName: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  createdAt: Date;
}

export class OrderPartItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  partId: string;

  @ApiProperty()
  partCode: string;

  @ApiProperty()
  partName: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  createdAt: Date;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  number: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty()
  statusDescription: string;

  @ApiProperty()
  nextStepDescription: string;

  @ApiProperty({ type: OrderCustomerSnapshotResponseDto })
  customer: OrderCustomerSnapshotResponseDto;

  @ApiPropertyOptional({ type: OrderVehicleSnapshotResponseDto })
  vehicle?: OrderVehicleSnapshotResponseDto;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  totalAmountFormatted: string;

  @ApiProperty()
  receivedAt: Date;

  @ApiPropertyOptional()
  expectedDeliveryDate?: Date;

  @ApiPropertyOptional()
  budgetSentAt?: Date;

  @ApiPropertyOptional()
  finishedAt?: Date;

  @ApiPropertyOptional()
  deliveredAt?: Date;

  @ApiPropertyOptional()
  rejectionReason?: string;

  @ApiPropertyOptional()
  cancellationReason?: string;

  @ApiProperty({ type: [OrderServiceItemResponseDto] })
  serviceItems: OrderServiceItemResponseDto[];

  @ApiProperty({ type: [OrderPartItemResponseDto] })
  partItems: OrderPartItemResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class OrderListItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  number: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiPropertyOptional()
  customerName?: string;

  @ApiPropertyOptional()
  customerDocument?: string;

  @ApiPropertyOptional()
  vehiclePlate?: string;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  receivedAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class OrderHistoryEntryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty()
  description: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty()
  createdAt: Date;
}

export class PublicOrderStatusResponseDto {
  @ApiProperty()
  number: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty()
  statusDescription: string;

  @ApiProperty()
  nextStepDescription: string;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  totalAmountFormatted: string;

  @ApiProperty()
  receivedAt: Date;

  @ApiPropertyOptional()
  expectedDeliveryDate?: Date;

  @ApiPropertyOptional()
  finishedAt?: Date;

  @ApiPropertyOptional()
  deliveredAt?: Date;

  @ApiPropertyOptional({ type: OrderVehicleSnapshotResponseDto })
  vehicle?: OrderVehicleSnapshotResponseDto;
}
