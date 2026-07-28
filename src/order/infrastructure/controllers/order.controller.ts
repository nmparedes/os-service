import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { PaginatedResponse } from "../../../common/interfaces/paginated-response.interface";
import { AddPartItemDto } from "../../application/dto/add-part-item.dto";
import { AddServiceItemDto } from "../../application/dto/add-service-item.dto";
import { AssociateVehicleDto } from "../../application/dto/associate-vehicle.dto";
import { CreateOrderDto } from "../../application/dto/create-order.dto";
import { ListOrdersQueryDto } from "../../application/dto/list-orders.query.dto";
import {
  OrderHistoryEntryResponseDto,
  OrderListItemResponseDto,
  OrderResponseDto,
} from "../../application/dto/order.response.dto";
import { UpdateOrderStatusDto } from "../../application/dto/update-order-status.dto";
import { OrderService } from "../../application/services/order.service";

@ApiTags("Orders")
@ApiBearerAuth()
@Controller("orders")
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a new order." })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, type: OrderResponseDto })
  async create(@Body() dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.orderService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "List orders with pagination and filters." })
  @ApiResponse({ status: 200, description: "Paginated orders list." })
  async list(
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedResponse<OrderListItemResponseDto>> {
    return this.orderService.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an order by id." })
  @ApiParam({ name: "id", example: "order-123" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async getById(@Param("id") id: string): Promise<OrderResponseDto> {
    return this.orderService.getById(id);
  }

  @Post(":id/vehicle")
  @ApiOperation({ summary: "Associate a vehicle to an order." })
  @ApiParam({ name: "id", example: "order-123" })
  @ApiBody({ type: AssociateVehicleDto })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async associateVehicle(
    @Param("id") id: string,
    @Body() dto: AssociateVehicleDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.associateVehicle(id, dto);
  }

  @Post(":id/service-items")
  @ApiOperation({ summary: "Add a service snapshot item to an order." })
  @ApiParam({ name: "id", example: "order-123" })
  @ApiBody({ type: AddServiceItemDto })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async addServiceItem(
    @Param("id") id: string,
    @Body() dto: AddServiceItemDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.addServiceItem(id, dto);
  }

  @Post(":id/part-items")
  @ApiOperation({ summary: "Add a part snapshot item to an order." })
  @ApiParam({ name: "id", example: "order-123" })
  @ApiBody({ type: AddPartItemDto })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async addPartItem(
    @Param("id") id: string,
    @Body() dto: AddPartItemDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.addPartItem(id, dto);
  }

  @Patch(":id/status")
  @ApiOperation({ summary: "Update a locally managed order status." })
  @ApiParam({ name: "id", example: "order-123" })
  @ApiBody({ type: UpdateOrderStatusDto })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.updateStatus(id, dto);
  }

  @Get(":id/history")
  @ApiOperation({ summary: "Get order status history." })
  @ApiParam({ name: "id", example: "order-123" })
  @ApiResponse({ status: 200, type: [OrderHistoryEntryResponseDto] })
  async getHistory(
    @Param("id") id: string,
  ): Promise<OrderHistoryEntryResponseDto[]> {
    return this.orderService.getHistory(id);
  }
}
