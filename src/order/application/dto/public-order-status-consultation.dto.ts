import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class PublicOrderStatusConsultationDto {
  @ApiProperty({
    description: "Order number.",
    example: "OS-20260724-0001",
  })
  @IsString()
  number: string;

  @ApiProperty({
    description: "Customer CPF or CNPJ used to validate public access.",
    example: "123.456.789-00",
  })
  @IsString()
  customerDocument: string;
}
