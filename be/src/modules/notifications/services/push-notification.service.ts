import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as webpush from 'web-push';
import { PrismaService } from '../../../core/database/prisma.service';
import { RegisterDeviceDto } from '../dto/register-device.dto';
import { RegisterWebPushSubscriptionDto } from '../dto/web-push-subscription.dto';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export function isExpoPushToken(token: string): boolean {
  if (typeof token !== 'string') return false;
  return /^(ExponentPushToken|ExpoPushToken)\[.*\]$/.test(token.trim());
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers or refreshes a device push token for an authenticated user.
   */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    return this.prisma.userDevice.upsert({
      where: { expoPushToken: dto.expoPushToken },
      update: {
        userId,
        platform: dto.platform,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        expoPushToken: dto.expoPushToken,
        platform: dto.platform,
        enabled: true,
        lastSeenAt: new Date(),
      },
    });
  }

  /**
   * Disables/unregisters a device push token (e.g. on logout).
   */
  async unregisterDevice(userId: string, expoPushToken: string) {
    return this.prisma.userDevice.updateMany({
      where: {
        userId,
        expoPushToken,
      },
      data: {
        enabled: false,
        updatedAt: new Date(),
      },
    });
  }

  async registerWebPushSubscription(
    userId: string,
    dto: RegisterWebPushSubscriptionDto,
  ) {
    return this.prisma.webPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: {
        userId,
        p256dh: dto.p256dh,
        auth: dto.auth,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
        enabled: true,
        lastSeenAt: new Date(),
      },
    });
  }

  async unregisterWebPushSubscription(userId: string, endpoint: string) {
    return this.prisma.webPushSubscription.updateMany({
      where: { userId, endpoint },
      data: { enabled: false, updatedAt: new Date() },
    });
  }

  /**
   * Dispatches push notification to all enabled device tokens belonging to the given user.
   */
  async sendPushNotification(params: {
    userId?: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<boolean> {
    const { userId, title, body, data } = params;

    if (!userId) {
      this.logger.debug(
        '[PushNotification] No userId provided for push notification. Skipping.',
      );
      return false;
    }

    const [expoSent, webSent] = await Promise.all([
      this.sendExpoPush(userId, title, body, data),
      this.sendWebPush(userId, title, body, data),
    ]);
    return expoSent || webSent;
  }

  private async sendExpoPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<boolean> {
    try {
      const devices = await this.prisma.userDevice.findMany({
        where: {
          userId,
          enabled: true,
        },
      });

      if (!devices || devices.length === 0) {
        this.logger.debug(
          `[PushNotification] No active devices found for user "${userId}".`,
        );
        return false;
      }

      const validDevices = devices.filter((d) =>
        isExpoPushToken(d.expoPushToken),
      );

      if (validDevices.length === 0) {
        this.logger.warn(
          `[PushNotification] All registered device tokens for user "${userId}" have invalid format.`,
        );
        return false;
      }

      const messages = validDevices.map((d) => ({
        to: d.expoPushToken,
        sound: 'default',
        title,
        body,
        data,
      }));

      const response = await axios.post(EXPO_PUSH_URL, messages, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        timeout: 5000,
      });

      // Handle ticket responses to disable invalidated tokens
      const tickets = response.data?.data;
      if (Array.isArray(tickets)) {
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const device = validDevices[i];
          if (ticket?.status === 'error') {
            this.logger.warn(
              `[PushNotification] Push error for token "${device.expoPushToken}": ${ticket.message} (${ticket.details?.error})`,
            );
            if (
              ticket.details?.error === 'DeviceNotRegistered' ||
              ticket.message?.includes('not registered')
            ) {
              await this.prisma.userDevice
                .update({
                  where: { id: device.id },
                  data: { enabled: false },
                })
                .catch(() => {});
            }
          }
        }
      }

      this.logger.log(
        `[PushNotification] Successfully dispatched push notification to ${validDevices.length} device(s) for user "${userId}": "${title}"`,
      );
      return true;
    } catch (error: any) {
      this.logger.warn(
        `[PushNotification] Failed to send push notification to user "${userId}": ${error?.message || error}`,
      );
      return false;
    }
  }

  private async sendWebPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<boolean> {
    try {
      const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
      const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
      const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
      if (!publicKey || !privateKey || !subject) {
        return false;
      }

      webpush.setVapidDetails(subject, publicKey, privateKey);
      const subscriptions = await this.prisma.webPushSubscription.findMany({
        where: { userId, enabled: true },
      });
      if (subscriptions.length === 0) return false;

      let delivered = false;
      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify({ title, body, data }),
          );
          delivered = true;
        } catch (error: any) {
          const statusCode = Number(error?.statusCode);
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.webPushSubscription.update({
              where: { id: subscription.id },
              data: { enabled: false },
            });
          } else {
            this.logger.warn(
              `[PushNotification] Web Push failed for subscription "${subscription.id}": ${error?.message || error}`,
            );
          }
        }
      }
      return delivered;
    } catch (error: any) {
      this.logger.warn(
        `[PushNotification] Web Push setup failed for user "${userId}": ${error?.message || error}`,
      );
      return false;
    }
  }
}
