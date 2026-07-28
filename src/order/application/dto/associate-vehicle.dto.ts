import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class AssociateVehicleDto {
  @ApiProperty({
    description: "Vehicle identifier owned by the customer.",
    example: "vehicle-123",
  })
  @IsString()
  vehicleId: string;
}
