import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../../core/database/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dispatches push notification to a user's registered device tokens.
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

    try {
      // Look up user device tokens or crawler searches
      const crawler = await this.prisma.crawlerSearch.findFirst({
        where: { deviceToken: { not: null } },
        select: { deviceToken: true },
      });

      const token = crawler?.deviceToken;
      if (!token) {
        this.logger.debug(
          `[PushNotification] No push token found for user "${userId}".`,
        );
        return false;
      }

      await axios.post(
        EXPO_PUSH_URL,
        {
          to: token,
          sound: 'default',
          title,
          body,
          data,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        },
      );

      this.logger.log(
        `[PushNotification] Successfully sent push notification to user "${userId}": "${title}"`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `[PushNotification] Failed to send push notification to user "${userId}": ${error?.message || error}`,
      );
      return false;
    }
  }
}
