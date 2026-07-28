import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { OrderStatus } from "../../domain/enums/order-status.enum";

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ example: "OS-20260724-0001" })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional({ enum: OrderStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) {
      return undefined;
    }

    return Array.isArray(value) ? value : [value];
  })
  @IsEnum(OrderStatus, { each: true })
  statuses?: OrderStatus[];

  @ApiPropertyOptional({ example: "customer-123" })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ example: "12345678900" })
  @IsOptional()
  @IsString()
  customerDocument?: string;

  @ApiPropertyOptional({ example: "John" })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ example: "vehicle-123" })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional({ example: "ABC1D23" })
  @IsOptional()
  @IsString()
  vehiclePlate?: string;

  @ApiPropertyOptional({ example: "2026-07-01T00:00:00.000Z" })
  @IsOptional()
  @Type(() => Date)
  receivedAtFrom?: Date;

  @ApiPropertyOptional({ example: "2026-07-31T23:59:59.999Z" })
  @IsOptional()
  @Type(() => Date)
  receivedAtTo?: Date;

  @ApiPropertyOptional({ example: "2026-07-01T00:00:00.000Z" })
  @IsOptional()
  @Type(() => Date)
  finishedAtFrom?: Date;

  @ApiPropertyOptional({ example: "2026-07-31T23:59:59.999Z" })
  @IsOptional()
  @Type(() => Date)
  finishedAtTo?: Date;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minTotalAmount?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxTotalAmount?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;

  @ApiPropertyOptional({
    enum: [
      "number",
      "status",
      "receivedAt",
      "finishedAt",
      "totalAmount",
      "createdAt",
    ],
    default: "createdAt",
  })
  @IsOptional()
  @IsIn([
    "number",
    "status",
    "receivedAt",
    "finishedAt",
    "totalAmount",
    "createdAt",
  ])
  orderBy:
    | "number"
    | "status"
    | "receivedAt"
    | "finishedAt"
    | "totalAmount"
    | "createdAt" = "createdAt";

  @ApiPropertyOptional({ enum: ["ASC", "DESC"], default: "DESC" })
  @IsOptional()
  @IsIn(["ASC", "DESC"])
  order: "ASC" | "DESC" = "DESC";
}
