import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class NegativeCacheService {
  private readonly logger = new Logger(NegativeCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Checks if a lookup key has been negatively cached (i.e. confirmed not to exist or failed recently).
   */
  async isNegative(
    provider: string,
    lookupStrategy: string,
    lookupKey: string,
  ): Promise<boolean> {
    if (!lookupKey || !lookupKey.trim()) return false;

    const normalizedKey = lookupKey.trim().toLowerCase();

    const record = await this.prisma.negativeMediaLookup.findFirst({
      where: {
        provider,
        lookupStrategy,
        lookupKey: normalizedKey,
        negativeUntil: {
          gt: new Date(),
        },
      },
      select: { id: true, negativeUntil: true },
    });

    if (record) {
      this.logger.debug(
        `[NegativeCache] Negative hit for [${provider}:${lookupStrategy}:${normalizedKey}] (valid until ${record.negativeUntil.toISOString()}). Skipping upstream call.`,
      );
      return true;
    }

    return false;
  }

  /**
   * Records a negative lookup result with a given TTL (default 30 days).
   */
  async recordNegative(
    provider: string,
    lookupStrategy: string,
    lookupKey: string,
    ttlDays = 30,
  ): Promise<void> {
    if (!lookupKey || !lookupKey.trim()) return;

    const normalizedKey = lookupKey.trim().toLowerCase();
    const negativeUntil = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    try {
      await this.prisma.negativeMediaLookup.upsert({
        where: {
          provider_lookupStrategy_lookupKey: {
            provider,
            lookupStrategy,
            lookupKey: normalizedKey,
          },
        },
        create: {
          provider,
          lookupStrategy,
          lookupKey: normalizedKey,
          negativeUntil,
        },
        update: {
          negativeUntil,
        },
      });

      this.logger.debug(
        `[NegativeCache] Recorded negative lookup for [${provider}:${lookupStrategy}:${normalizedKey}] until ${negativeUntil.toISOString()}.`,
      );
    } catch (error) {
      this.logger.warn(
        `[NegativeCache] Failed to record negative lookup for [${provider}:${lookupStrategy}:${normalizedKey}]: ${error?.message || error}`,
      );
    }
  }

  /**
   * Invalidates a negative cache entry so it can be re-queried immediately.
   */
  async invalidate(
    provider: string,
    lookupStrategy: string,
    lookupKey: string,
  ): Promise<void> {
    if (!lookupKey || !lookupKey.trim()) return;

    const normalizedKey = lookupKey.trim().toLowerCase();
    await this.prisma.negativeMediaLookup.deleteMany({
      where: {
        provider,
        lookupStrategy,
        lookupKey: normalizedKey,
      },
    });
  }
}
