import { Module, Global } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SSEHubService } from './services/sse-hub.service';
import { PushNotificationService } from './services/push-notification.service';
import { NotificationDeliveryService } from './services/notification-delivery.service';
import { SSEController } from './controllers/sse.controller';
import { DevicesController } from './controllers/devices.controller';
import { PrismaService } from '../../core/database/prisma.service';

@Global()
@Module({
  imports: [QueueModule],
  controllers: [SSEController, DevicesController],
  providers: [
    PrismaService,
    SSEHubService,
    PushNotificationService,
    NotificationDeliveryService,
  ],
  exports: [
    SSEHubService,
    PushNotificationService,
    NotificationDeliveryService,
  ],
})
export class NotificationsModule {}
