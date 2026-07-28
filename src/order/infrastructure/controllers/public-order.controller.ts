import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../auth/decorators/public.decorator";
import { PublicOrderStatusConsultationDto } from "../../application/dto/public-order-status-consultation.dto";
import { PublicOrderStatusResponseDto } from "../../application/dto/order.response.dto";
import { OrderService } from "../../application/services/order.service";

@ApiTags("Public Orders")
@Controller("public/orders")
export class PublicOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Public()
  @Post("status-consultation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Consult order status using order number and customer document.",
  })
  @ApiBody({ type: PublicOrderStatusConsultationDto })
  @ApiOkResponse({ type: PublicOrderStatusResponseDto })
  async getPublicStatus(
    @Body() dto: PublicOrderStatusConsultationDto,
  ): Promise<PublicOrderStatusResponseDto> {
    return this.orderService.getPublicStatus(dto);
  }
}
