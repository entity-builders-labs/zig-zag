import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool;

  constructor(private configService: ConfigService) {
    // Get database URL from config service or fallback to environment variable
    const databaseUrl =
      configService.get<string>('database.url') || process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is not configured. Please set DATABASE_URL environment variable or configure it in your config module.',
      );
    }

    // Set DATABASE_URL environment variable for PrismaClient to read
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = databaseUrl;
    }

    // Create PostgreSQL pool and adapter for Prisma 7
    // Must create before calling super()
    const pool = new Pool({ connectionString: databaseUrl });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['error', 'warn'], // Only log errors and warnings, not queries
    });

    // Assign pool to instance property after super()
    this.pool = pool;
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
    await this.pool.end();
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
