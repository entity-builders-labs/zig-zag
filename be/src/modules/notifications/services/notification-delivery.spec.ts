import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDeliveryService } from './notification-delivery.service';
import { SSEHubService } from './sse-hub.service';
import { PushNotificationService } from './push-notification.service';
import { MESSAGE_QUEUE_SERVICE } from '../../queue/interfaces/message-queue.interface';
import { PrismaService } from '../../../core/database/prisma.service';

describe('NotificationDeliveryService', () => {
  let deliveryService: NotificationDeliveryService;
  let sseHubMock: any;
  let pushServiceMock: any;
  let queueMock: any;
  let prismaMock: any;

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

    prismaMock = {
      tourExperience: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliveryService,
        { provide: SSEHubService, useValue: sseHubMock },
        { provide: PushNotificationService, useValue: pushServiceMock },
        { provide: MESSAGE_QUEUE_SERVICE, useValue: queueMock },
        { provide: PrismaService, useValue: prismaMock },
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

    expect(sseHubMock.emit).toHaveBeenCalledWith(
      'tour:tour-123',
      'tour.completed',
      {
        tourId: 'tour-123',
        userId: 'user-456',
        status: 'COMPLETED',
      },
    );
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

  it('routes to Push Notification fallback when SSE stream is inactive on tour failure', async () => {
    sseHubMock.hasActiveClients.mockReturnValue(false);
    sseHubMock.emit.mockReturnValue(false);

    await (deliveryService as any).handleTourEvent('tour.failed', {
      tourId: 'tour-888',
      userId: 'user-111',
      status: 'FAILED',
      message: 'Error de conectividad con el proveedor de lugares.',
    });

    expect(pushServiceMock.sendPushNotification).toHaveBeenCalledWith({
      userId: 'user-111',
      title: '⚠️ No pudimos completar tu itinerario',
      body: 'Error de conectividad con el proveedor de lugares.',
      data: { tourId: 'tour-888', eventName: 'tour.failed' },
    });
  });

  it('delivers media only to the experience and related tour channels', async () => {
    sseHubMock.hasActiveClients.mockReturnValue(true);
    prismaMock.tourExperience.findMany.mockResolvedValue([
      { tourId: 'tour-1' },
      { tourId: 'tour-2' },
    ]);

    const mediaPayload = {
      experienceId: 'exp-1',
      mediaStatus: 'ENRICHED',
      photoCount: 2,
      mediaUpdatedAt: '2026-08-31T01:00:00.000Z',
      photos: [
        {
          url: 'https://example.com/photo.jpg',
          provider: 'wikimedia_commons' as const,
        },
      ],
    };

    await (deliveryService as any).handleMediaUpdated(mediaPayload);

    expect(sseHubMock.emit).toHaveBeenCalledWith(
      'experience:exp-1',
      'experience.media.updated',
      mediaPayload,
    );
    expect(sseHubMock.emit).toHaveBeenCalledWith(
      'tour:tour-1',
      'experience.media.updated',
      mediaPayload,
    );
    expect(sseHubMock.emit).toHaveBeenCalledWith(
      'tour:tour-2',
      'experience.media.updated',
      mediaPayload,
    );
    expect(sseHubMock.emit).toHaveBeenCalledTimes(3);
  });
});
