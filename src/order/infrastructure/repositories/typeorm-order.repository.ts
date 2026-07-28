import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PaginatedResponse } from "../../../common/interfaces/paginated-response.interface";
import { Order } from "../../domain/entities/order.entity";
import { OrderHistoryEntry } from "../../domain/repositories/order-history-entry.interface";
import { OrderListFilters } from "../../domain/repositories/order-list-filters.interface";
import { OrderRepository } from "../../domain/repositories/order.repository.interface";
import { OrderMapper } from "../mappers/order.mapper";
import { OrderOrmEntity } from "../typeorm/order.orm-entity";

@Injectable()
export class TypeOrmOrderRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderOrmEntity)
    private readonly repository: Repository<OrderOrmEntity>,
  ) {}

  async save(order: Order): Promise<Order> {
    const ormEntity = OrderMapper.toOrmEntity(order);
    const existingEntity = await this.repository.findOne({
      where: { id: order.id },
      relations: {
        history_entries: true,
      },
    });

    if (existingEntity?.history_entries?.length) {
      const sortedHistoryEntries = [...existingEntity.history_entries].sort(
        (left, right) => left.created_at.getTime() - right.created_at.getTime(),
      );
      const latestHistoryEntry =
        sortedHistoryEntries[sortedHistoryEntries.length - 1];

      ormEntity.history_entries =
        latestHistoryEntry.status === order.status
          ? sortedHistoryEntries
          : [
              ...sortedHistoryEntries,
              OrderMapper.toHistoryEntry(order, ormEntity.id),
            ];
    }

    const savedEntity = await this.repository.save(ormEntity);
    return OrderMapper.toDomain(savedEntity);
  }

  async findById(id: string): Promise<Order | null> {
    const ormEntity = await this.repository.findOne({
      where: { id },
      relations: {
        service_items: true,
        part_items: true,
        history_entries: true,
      },
    });

    return ormEntity ? OrderMapper.toDomain(ormEntity) : null;
  }

  async findByNumber(number: string): Promise<Order | null> {
    const ormEntity = await this.repository.findOne({
      where: { number: number.trim() },
      relations: {
        service_items: true,
        part_items: true,
        history_entries: true,
      },
    });

    return ormEntity ? OrderMapper.toDomain(ormEntity) : null;
  }

  async findAll(filters: OrderListFilters): Promise<PaginatedResponse<Order>> {
    const queryBuilder = this.repository
      .createQueryBuilder("order")
      .leftJoinAndSelect("order.service_items", "service_item")
      .leftJoinAndSelect("order.part_items", "part_item")
      .leftJoinAndSelect("order.history_entries", "history_entry")
      .distinct(true);

    if (filters.number) {
      queryBuilder.andWhere("order.number LIKE :number", {
        number: `%${filters.number.trim()}%`,
      });
    }

    if (filters.statuses?.length) {
      queryBuilder.andWhere("order.status IN (:...statuses)", {
        statuses: filters.statuses,
      });
    }

    if (filters.customerId) {
      queryBuilder.andWhere("order.customer_id = :customerId", {
        customerId: filters.customerId,
      });
    }

    if (filters.customerDocument) {
      queryBuilder.andWhere("order.customer_document = :customerDocument", {
        customerDocument: filters.customerDocument,
      });
    }

    if (filters.customerName) {
      queryBuilder.andWhere("LOWER(order.customer_name) LIKE :customerName", {
        customerName: `%${filters.customerName.trim().toLowerCase()}%`,
      });
    }

    if (filters.vehicleId) {
      queryBuilder.andWhere("order.vehicle_id = :vehicleId", {
        vehicleId: filters.vehicleId,
      });
    }

    if (filters.vehiclePlate) {
      queryBuilder.andWhere("order.vehicle_plate = :vehiclePlate", {
        vehiclePlate: filters.vehiclePlate.trim().toUpperCase(),
      });
    }

    if (filters.receivedAtFrom) {
      queryBuilder.andWhere("order.received_at >= :receivedAtFrom", {
        receivedAtFrom: filters.receivedAtFrom,
      });
    }

    if (filters.receivedAtTo) {
      queryBuilder.andWhere("order.received_at <= :receivedAtTo", {
        receivedAtTo: filters.receivedAtTo,
      });
    }

    if (filters.finishedAtFrom) {
      queryBuilder.andWhere("order.finished_at >= :finishedAtFrom", {
        finishedAtFrom: filters.finishedAtFrom,
      });
    }

    if (filters.finishedAtTo) {
      queryBuilder.andWhere("order.finished_at <= :finishedAtTo", {
        finishedAtTo: filters.finishedAtTo,
      });
    }

    if (filters.minTotalAmount !== undefined) {
      queryBuilder.andWhere("order.total_amount >= :minTotalAmount", {
        minTotalAmount: filters.minTotalAmount,
      });
    }

    if (filters.maxTotalAmount !== undefined) {
      queryBuilder.andWhere("order.total_amount <= :maxTotalAmount", {
        maxTotalAmount: filters.maxTotalAmount,
      });
    }

    const orderByMapping = {
      number: "order.number",
      status: "order.status",
      receivedAt: "order.received_at",
      finishedAt: "order.finished_at",
      totalAmount: "order.total_amount",
      createdAt: "order.created_at",
    } as const;

    queryBuilder
      .orderBy(orderByMapping[filters.orderBy], filters.order)
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit);

    const [entities, total] = await queryBuilder.getManyAndCount();

    return {
      data: OrderMapper.toDomainList(entities),
      meta: {
        total,
        page: filters.page,
        limit: filters.limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / filters.limit),
      },
    };
  }

  async findHistoryByOrderId(orderId: string): Promise<OrderHistoryEntry[]> {
    const ormEntity = await this.repository.findOne({
      where: { id: orderId },
      relations: {
        history_entries: true,
      },
    });

    if (!ormEntity) {
      return [];
    }

    return [...(ormEntity.history_entries ?? [])]
      .sort(
        (left, right) => left.created_at.getTime() - right.created_at.getTime(),
      )
      .map((entry) => ({
        id: entry.id,
        orderId: entry.order_id,
        status: entry.status,
        description: entry.description,
        reason: entry.reason ?? undefined,
        createdAt: entry.created_at,
      }));
  }

  async getNextSequenceForDate(date: Date): Promise<number> {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const prefix = `OS-${year}${month}${day}-`;

    const sameDayOrder = await this.repository
      .createQueryBuilder("order")
      .where("order.number LIKE :prefix", { prefix: `${prefix}%` })
      .orderBy("order.number", "DESC")
      .getOne();

    if (!sameDayOrder) {
      return 1;
    }

    return Number.parseInt(sameDayOrder.number.slice(-4), 10) + 1;
  }
}
