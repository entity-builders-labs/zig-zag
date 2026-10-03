import { Module, Global } from '@nestjs/common';
import { MESSAGE_QUEUE_SERVICE } from './interfaces/message-queue.interface';
import { InMemoryQueueService } from './services/in-memory-queue.service';

@Global()
@Module({
  providers: [
    InMemoryQueueService,
    {
      provide: MESSAGE_QUEUE_SERVICE,
      useExisting: InMemoryQueueService,
    },
  ],
  exports: [MESSAGE_QUEUE_SERVICE, InMemoryQueueService],
})
export class QueueModule {}
