import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  CreateOutboxEventDto,
  OutboxEvent,
  OutboxStatus,
} from '../interfaces/outbox.interface';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically enqueues an outbox event inside an existing Prisma transaction client.
   * This ensures the event is committed together with the business entity mutation.
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    dto: CreateOutboxEventDto,
  ): Promise<OutboxEvent> {
    const event = await tx.outboxEvent.create({
      data: {
        eventType: dto.eventType,
        payload: dto.payload as Prisma.InputJsonValue,
        status: OutboxStatus.PENDING,
        maxAttempts: dto.maxAttempts ?? 5,
        attemptCount: 0,
      },
    });

    this.logger.debug(
      `[OutboxService] Enqueued event "${dto.eventType}" (id: ${event.id}) in transaction.`,
    );
    return event;
  }

  /**
   * Creates an outbox event outside a transaction.
   */
  async create(dto: CreateOutboxEventDto): Promise<OutboxEvent> {
    return this.createInTx(this.prisma, dto);
  }
}
