import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { OrderStatus } from "../../domain/enums/order-status.enum";

export class UpdateOrderStatusDto {
  @ApiProperty({
    description: "Target order status owned by the OS service in this phase.",
    enum: OrderStatus,
    example: OrderStatus.IN_DIAGNOSIS,
  })
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @ApiPropertyOptional({
    description: "Optional reason for cancellation.",
    example: "Customer requested cancellation.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
