import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private configService: ConfigService) {
    super({
      datasources: {
        db: {
          url: configService.get<string>('database.url'),
        },
      },
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    });
  }

  async onModuleInit() {
    try {
      const databaseUrl = this.configService.get<string>('database.url');
      if (!databaseUrl) {
        this.logger.error(
          'DATABASE_URL is not configured. Please set DATABASE_URL environment variable.',
        );
        throw new Error('DATABASE_URL is not configured');
      }

      this.logger.log(
        `Connecting to database: ${this.maskDatabaseUrl(databaseUrl)}`,
      );
      await this.$connect();
      this.logger.log('Successfully connected to database');
    } catch (error) {
      this.logger.error('Failed to connect to database', error.stack);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }

  private maskDatabaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.username}:***@${urlObj.hostname}:${urlObj.port}${urlObj.pathname}`;
    } catch {
      return '***';
    }
  }
}
