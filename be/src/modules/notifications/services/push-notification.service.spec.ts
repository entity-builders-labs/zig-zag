import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import * as webpush from 'web-push';
import { PushNotificationService, isExpoPushToken } from './push-notification.service';
import { PrismaService } from '../../../core/database/prisma.service';

jest.mock('axios');
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedWebPush = webpush as jest.Mocked<typeof webpush>;

describe('PushNotificationService', () => {
  let service: PushNotificationService;
  let prismaMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_VAPID_SUBJECT;

    prismaMock = {
      userDevice: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      webPushSubscription: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushNotificationService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<PushNotificationService>(PushNotificationService);
  });

  describe('isExpoPushToken', () => {
    it('validates ExponentPushToken and ExpoPushToken formats correctly', () => {
      expect(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
      expect(isExpoPushToken('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
      expect(isExpoPushToken('invalid-token')).toBe(false);
      expect(isExpoPushToken('')).toBe(false);
      expect(isExpoPushToken(null as any)).toBe(false);
    });
  });

  describe('registerDevice', () => {
    it('registers or updates a user device token', async () => {
      prismaMock.userDevice.upsert.mockResolvedValue({
        id: 'dev-1',
        userId: 'user-123',
        expoPushToken: 'ExponentPushToken[token1]',
        platform: 'ios',
        enabled: true,
      });

      const res = await service.registerDevice('user-123', {
        expoPushToken: 'ExponentPushToken[token1]',
        platform: 'ios',
      });

      expect(prismaMock.userDevice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expoPushToken: 'ExponentPushToken[token1]' },
          create: expect.objectContaining({
            userId: 'user-123',
            expoPushToken: 'ExponentPushToken[token1]',
            platform: 'ios',
            enabled: true,
          }),
        }),
      );
      expect(res.id).toBe('dev-1');
    });
  });

  describe('unregisterDevice', () => {
    it('marks a device token as disabled on logout', async () => {
      prismaMock.userDevice.updateMany.mockResolvedValue({ count: 1 });

      await service.unregisterDevice('user-123', 'ExponentPushToken[token1]');

      expect(prismaMock.userDevice.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          expoPushToken: 'ExponentPushToken[token1]',
        },
        data: {
          enabled: false,
          updatedAt: expect.any(Date),
        },
      });
    });
  });

  describe('web push subscriptions', () => {
    it('registers a browser subscription for the authenticated user', async () => {
      prismaMock.webPushSubscription.upsert.mockResolvedValue({ id: 'web-1' });

      await service.registerWebPushSubscription('user-123', {
        endpoint: 'https://push.example/subscription-1',
        p256dh: 'public-key',
        auth: 'auth-secret',
      });

      expect(prismaMock.webPushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: 'https://push.example/subscription-1' },
          create: expect.objectContaining({
            userId: 'user-123',
            enabled: true,
          }),
        }),
      );
    });

    it('delivers to an enabled browser subscription', async () => {
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'public-vapid';
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'private-vapid';
      process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@example.com';
      prismaMock.userDevice.findMany.mockResolvedValue([]);
      prismaMock.webPushSubscription.findMany.mockResolvedValue([
        {
          id: 'web-1',
          endpoint: 'https://push.example/subscription-1',
          p256dh: 'public-key',
          auth: 'auth-secret',
        },
      ]);
      mockedWebPush.sendNotification.mockResolvedValue({} as any);

      const result = await service.sendPushNotification({
        userId: 'user-123',
        title: 'Tour listo',
        body: 'Abrí Zig-Zag para verlo.',
        data: { tourId: 'tour-1' },
      });

      expect(result).toBe(true);
      expect(mockedWebPush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:ops@example.com',
        'public-vapid',
        'private-vapid',
      );
      expect(mockedWebPush.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://push.example/subscription-1',
        }),
        JSON.stringify({
          title: 'Tour listo',
          body: 'Abrí Zig-Zag para verlo.',
          data: { tourId: 'tour-1' },
        }),
      );
    });
  });

  describe('sendPushNotification', () => {
    it('returns false if no userId is provided', async () => {
      const result = await service.sendPushNotification({
        title: 'Test',
        body: 'Message',
      });
      expect(result).toBe(false);
      expect(prismaMock.userDevice.findMany).not.toHaveBeenCalled();
    });

    it('returns false if user has no enabled devices', async () => {
      prismaMock.userDevice.findMany.mockResolvedValue([]);
      const result = await service.sendPushNotification({
        userId: 'user-123',
        title: 'Test',
        body: 'Message',
      });
      expect(result).toBe(false);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('sends push to all enabled devices belonging to the user', async () => {
      prismaMock.userDevice.findMany.mockResolvedValue([
        { id: 'dev-1', expoPushToken: 'ExponentPushToken[token1]', enabled: true },
        { id: 'dev-2', expoPushToken: 'ExpoPushToken[token2]', enabled: true },
      ]);
      mockedAxios.post.mockResolvedValue({
        data: {
          data: [{ status: 'ok' }, { status: 'ok' }],
        },
      });

      const result = await service.sendPushNotification({
        userId: 'user-123',
        title: '¡Listo!',
        body: 'Tu tour está preparado.',
        data: { tourId: 'tour-123', eventName: 'tour.completed' },
      });

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://exp.host/--/api/v2/push/send',
        [
          {
            to: 'ExponentPushToken[token1]',
            sound: 'default',
            title: '¡Listo!',
            body: 'Tu tour está preparado.',
            data: { tourId: 'tour-123', eventName: 'tour.completed' },
          },
          {
            to: 'ExpoPushToken[token2]',
            sound: 'default',
            title: '¡Listo!',
            body: 'Tu tour está preparado.',
            data: { tourId: 'tour-123', eventName: 'tour.completed' },
          },
        ],
        expect.any(Object),
      );
    });

    it('disables device when Expo reports DeviceNotRegistered error', async () => {
      prismaMock.userDevice.findMany.mockResolvedValue([
        { id: 'dev-1', expoPushToken: 'ExponentPushToken[staleToken]', enabled: true },
      ]);
      mockedAxios.post.mockResolvedValue({
        data: {
          data: [
            {
              status: 'error',
              message: '"ExponentPushToken[staleToken]" is not registered',
              details: { error: 'DeviceNotRegistered' },
            },
          ],
        },
      });
      prismaMock.userDevice.update.mockResolvedValue({});

      const result = await service.sendPushNotification({
        userId: 'user-123',
        title: '¡Listo!',
        body: 'Tu tour está preparado.',
      });

      expect(result).toBe(true);
      expect(prismaMock.userDevice.update).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
        data: { enabled: false },
      });
    });
  });
});
