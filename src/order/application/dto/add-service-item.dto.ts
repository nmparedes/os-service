import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, Min } from "class-validator";

export class AddServiceItemDto {
  @ApiProperty({
    description: "Service catalog item identifier.",
    example: "service-123",
  })
  @IsString()
  serviceId: string;

  @ApiProperty({
    description: "Requested quantity.",
    example: 1,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;
}
