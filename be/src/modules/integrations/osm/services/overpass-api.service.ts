import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IOverpassApiService,
  OverpassElement,
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
} from '../interfaces/overpass.interface';
import {
  buildBoundaryByNameQuery,
  buildContainingBoundaryQuery,
  buildStreetsQuery,
} from '../utils/overpass-query.util';
import { OverpassConcurrencyLimiter } from '../utils/overpass-concurrency.util';

const DEFAULT_API_URL = 'https://overpass-api.de/api/interpreter';
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_MAX_CONCURRENCY = 2;

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

  private async execute(query: string): Promise<OverpassElement[]> {
    return this.limiter.run(async () => {
      try {
        const response = await axios.post<{ elements: OverpassElement[] }>(
          this.apiUrl,
          new URLSearchParams({ data: query }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': USER_AGENT,
            },
            timeout: this.timeoutMs,
          },
        );
        return response.data?.elements || [];
      } catch (error) {
        this.logger.error(
          `Overpass query failed: ${error.message}`,
          error.response?.data,
        );
        throw error;
      }
    });
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
}
