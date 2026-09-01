import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IOverpassApiService,
  OverpassElement,
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
  QueryAdminBoundariesWithinAreaParams,
} from '../interfaces/overpass.interface';
import {
  buildBoundaryByNameQuery,
  buildContainingBoundaryQuery,
  buildStreetsQuery,
  buildBoundaryByIdQuery,
  buildAdminBoundariesWithinAreaQuery,
  buildStreetsWithinAreaQuery,
  buildPoisWithinAreaQuery,
} from '../utils/overpass-query.util';
import { OverpassConcurrencyLimiter } from '../utils/overpass-concurrency.util';

const DEFAULT_API_URL = 'https://overpass-api.de/api/interpreter';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_TOTAL_BUDGET_MS = 25000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

// Overpass's public instance rejects generic/bot-looking clients (axios's
// own default User-Agent gets a flat 406) — its usage policy asks every
// client to self-identify. No env var for this: it doesn't vary by
// deployment, it's just naming the app.
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';

@Injectable()
export class OverpassApiService implements IOverpassApiService {
  private readonly logger = new Logger(OverpassApiService.name);
  private readonly limiter: OverpassConcurrencyLimiter;

  constructor(private readonly configService: ConfigService) {
    const maxConcurrency = parseInt(
      this.configService.get<string>('OVERPASS_MAX_CONCURRENCY') ||
        String(DEFAULT_MAX_CONCURRENCY),
      10,
    );
    this.limiter = new OverpassConcurrencyLimiter(maxConcurrency);
  }

  private get apiUrl(): string {
    return (
      this.configService.get<string>('OVERPASS_API_URL') || DEFAULT_API_URL
    );
  }

  private get timeoutMs(): number {
    return parseInt(
      this.configService.get<string>('OVERPASS_TIMEOUT_MS') ||
        String(DEFAULT_TIMEOUT_MS),
      10,
    );
  }

  private get maxRetries(): number {
    return parseInt(
      this.configService.get<string>('OVERPASS_MAX_RETRIES') ||
        String(DEFAULT_MAX_RETRIES),
      10,
    );
  }

  private get retryBaseMs(): number {
    return parseInt(
      this.configService.get<string>('OVERPASS_RETRY_BASE_MS') ||
        String(DEFAULT_RETRY_BASE_MS),
      10,
    );
  }

  private get totalBudgetMs(): number {
    return parseInt(
      this.configService.get<string>('OVERPASS_TOTAL_BUDGET_MS') ||
        String(DEFAULT_TOTAL_BUDGET_MS),
      10,
    );
  }

  private async execute(query: string): Promise<OverpassElement[]> {
    return this.limiter.run(async () => {
      const startedAt = Date.now();
      let attempt = 0;
      while (true) {
        try {
          const remainingBudget = this.totalBudgetMs - (Date.now() - startedAt);
          if (remainingBudget <= 0) {
            throw new Error('Overpass request budget exhausted');
          }
          const response = await axios.post<{ elements: OverpassElement[] }>(
            this.apiUrl,
            new URLSearchParams({ data: query }).toString(),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT,
              },
              timeout: Math.min(this.timeoutMs, remainingBudget),
            },
          );
          return response.data?.elements || [];
        } catch (error: any) {
          const status = error.response?.status;
          const retryable = RETRYABLE_STATUS_CODES.has(status);
          const retryAfterMs = this.parseRetryAfterMs(
            error.response?.headers?.['retry-after'],
          );
          const exponentialDelay =
            this.retryBaseMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
          const delayMs = retryAfterMs ?? exponentialDelay;
          const elapsedWithDelay = Date.now() - startedAt + delayMs;

          if (
            retryable &&
            attempt < this.maxRetries &&
            elapsedWithDelay < this.totalBudgetMs
          ) {
            attempt++;
            this.logger.warn(
              `Overpass returned ${status}; retrying attempt ${attempt}/${this.maxRetries} in ${Math.round(delayMs)}ms.`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }

          this.logger.error(
            `Overpass query failed after ${attempt + 1} attempt(s): ${error.message}`,
            error.response?.data,
          );
          throw error;
        }
      }
    });
  }

  private parseRetryAfterMs(value: unknown): number | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  async queryBoundaryByName(
    params: QueryBoundaryByNameParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildBoundaryByNameQuery(params));
  }

  async queryContainingBoundary(
    params: QueryContainingBoundaryParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildContainingBoundaryQuery(params));
  }

  async queryStreets(params: QueryStreetsParams): Promise<OverpassElement[]> {
    return this.execute(buildStreetsQuery(params));
  }

  async queryBoundaryById(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.execute(buildBoundaryByIdQuery(params));
  }

  async queryAdminBoundariesWithinArea(
    params: QueryAdminBoundariesWithinAreaParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildAdminBoundariesWithinAreaQuery(params));
  }

  async queryStreetsWithinArea(
    params: QueryByIdParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildStreetsWithinAreaQuery(params));
  }

  async queryPoisWithinArea(
    params: QueryByIdParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildPoisWithinAreaQuery(params));
  }
}
