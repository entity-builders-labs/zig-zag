import { Module, Global } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { OutboxService } from './services/outbox.service';
import { OutboxPublisherService } from './services/outbox-publisher.service';
import { OutboxCleanerService } from './services/outbox-cleaner.service';
import { PrismaService } from '../../core/database/prisma.service';

@Global()
@Module({
  imports: [QueueModule],
  providers: [
    PrismaService,
    OutboxService,
    OutboxPublisherService,
    OutboxCleanerService,
  ],
  exports: [OutboxService, OutboxPublisherService, OutboxCleanerService],
})
export class OutboxModule {}
