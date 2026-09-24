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
  QueryFeaturesNearParams,
  QueryHighwaysByNameParams,
} from '../interfaces/overpass.interface';
import {
  buildBoundaryByNameQuery,
  buildContainingBoundaryQuery,
  buildStreetsQuery,
  buildBoundaryByIdQuery,
  buildAdminBoundariesWithinAreaQuery,
  buildStreetsWithinAreaQuery,
  buildPoisWithinAreaQuery,
  buildPoisQuery,
  buildFeaturesNearQuery,
  buildHighwaysByNameQuery,
  buildContainingAdminBoundariesQuery,
} from '../utils/overpass-query.util';
import { OverpassConcurrencyLimiter } from '../utils/overpass-concurrency.util';

const DEFAULT_API_URL = 'https://overpass-api.de/api/interpreter';
// Query builders in overpass-query.util.ts tag their heaviest ("within area")
// queries with the server-side budget `[timeout:30]` — the client-side
// per-attempt timeout below MUST exceed that with real margin, or axios aborts
// a request the Overpass server would have finished successfully. Verified
// live: a genuinely well-tagged OSM street ("Defensa" in San Telmo, Buenos
// Aires) came back OSM_PROVIDER_FAILED in production because the old default
// here (20000ms) was actually *shorter* than the query's own 30s budget —
// axios gave up before overpass-api.de (a slow, shared public instance) could
// respond, even though the data was there and the query itself was fine.
const DEFAULT_TIMEOUT_MS = 40000;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
// Must comfortably exceed DEFAULT_TIMEOUT_MS so a first attempt is never
// truncated by the budget check before it can even use its own timeout, with
// enough left over for one genuine retry.
const DEFAULT_TOTAL_BUDGET_MS = 90000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

// Overpass's dispatcher can reject a query (e.g. a duplicate-query
// rejection -- the same query re-issued while an earlier instance of it
// is still recent) with HTTP 200 and an HTML error body instead of the
// requested [out:json] JSON. Live-verified: axios does not throw for
// this -- Content-Type is text/html, so `response.data` is left as a raw
// HTML string, not parsed JSON. `response.data?.elements || []` would
// otherwise silently treat this as "zero real results" rather than "the
// query never actually ran", which is exactly what happened in production
// (OSM_QUERY_EMPTY dominating entity-resolution losses whenever the same
// destination-scoped query got re-issued across a request's themes/
// candidates). A genuinely empty *parsed* response (`{}` or
// `{elements:[]}`) is unaffected -- this only rejects a non-object payload.
class OverpassMalformedResponseError extends Error {
  constructor() {
    super(
      'Overpass returned a non-JSON response body (likely a dispatcher-level rejection)',
    );
    this.name = 'OverpassMalformedResponseError';
  }
}

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
          if (typeof response.data !== 'object' || response.data === null) {
            throw new OverpassMalformedResponseError();
          }
          return response.data?.elements || [];
        } catch (error: any) {
          const status = error.response?.status;
          const retryable =
            RETRYABLE_STATUS_CODES.has(status) ||
            error instanceof OverpassMalformedResponseError;
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

  async queryPois(params: QueryStreetsParams): Promise<OverpassElement[]> {
    return this.execute(buildPoisQuery(params));
  }

  async queryFeaturesNear(
    params: QueryFeaturesNearParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildFeaturesNearQuery(params));
  }

  async queryHighwaysByName(
    params: QueryHighwaysByNameParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildHighwaysByNameQuery(params));
  }

  async queryContainingAdminBoundaries(
    params: QueryContainingBoundaryParams,
  ): Promise<OverpassElement[]> {
    return this.execute(buildContainingAdminBoundariesQuery(params));
  }
}
