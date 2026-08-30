import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDeliveryService } from './notification-delivery.service';
import { SSEHubService } from './sse-hub.service';
import { PushNotificationService } from './push-notification.service';
import { MESSAGE_QUEUE_SERVICE } from '../../queue/interfaces/message-queue.interface';

describe('NotificationDeliveryService', () => {
  let deliveryService: NotificationDeliveryService;
  let sseHubMock: any;
  let pushServiceMock: any;
  let queueMock: any;

  beforeEach(async () => {
    sseHubMock = {
      hasActiveClients: jest.fn(),
      emit: jest.fn(),
    };

    pushServiceMock = {
      sendPushNotification: jest.fn(),
    };

    queueMock = {
      publish: jest.fn(),
      subscribe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliveryService,
        { provide: SSEHubService, useValue: sseHubMock },
        { provide: PushNotificationService, useValue: pushServiceMock },
        { provide: MESSAGE_QUEUE_SERVICE, useValue: queueMock },
      ],
    }).compile();

    deliveryService = module.get<NotificationDeliveryService>(
      NotificationDeliveryService,
    );
  });

  it('delivers event via SSE when clients are actively listening', async () => {
    sseHubMock.hasActiveClients.mockReturnValue(true);
    sseHubMock.emit.mockReturnValue(true);

    await (deliveryService as any).handleTourEvent('tour.completed', {
      tourId: 'tour-123',
      userId: 'user-456',
      status: 'COMPLETED',
    });

    expect(sseHubMock.emit).toHaveBeenCalledWith('tour-123', 'tour.completed', {
      tourId: 'tour-123',
      userId: 'user-456',
      status: 'COMPLETED',
    });
    expect(pushServiceMock.sendPushNotification).not.toHaveBeenCalled();
  });

  it('routes to Push Notification fallback when SSE stream is inactive on tour completion', async () => {
    sseHubMock.hasActiveClients.mockReturnValue(false);
    sseHubMock.emit.mockReturnValue(false);

    await (deliveryService as any).handleTourEvent('tour.completed', {
      tourId: 'tour-999',
      userId: 'user-111',
      status: 'COMPLETED',
      message: 'Tu itinerario de San Telmo está listo.',
    });

    expect(pushServiceMock.sendPushNotification).toHaveBeenCalledWith({
      userId: 'user-111',
      title: '🎉 ¡Tu itinerario está listo!',
      body: 'Tu itinerario de San Telmo está listo.',
      data: { tourId: 'tour-999', eventName: 'tour.completed' },
    });
  });
});
