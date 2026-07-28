import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, Min } from "class-validator";

export class AddPartItemDto {
  @ApiProperty({
    description: "Part identifier.",
    example: "part-123",
  })
  @IsString()
  partId: string;

  @ApiProperty({
    description: "Requested quantity.",
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;
}
