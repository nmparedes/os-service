import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateOrderDto {
  @ApiProperty({
    description: "Customer CPF or CNPJ.",
    example: "111.444.777-35",
  })
  @IsString()
  customerDocument: string;

  @ApiPropertyOptional({
    description: "Initial order notes.",
    example: "Customer reported brake noise.",
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: "Expected delivery date in ISO 8601 format.",
    example: "2026-08-01T15:00:00.000Z",
  })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;
}
