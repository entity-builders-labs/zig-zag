import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SerperApiError,
  SerperCallResult,
  SerperEndpoint,
  SerperMapsRequest,
  SerperMapsResponse,
  SerperPlacesRequest,
  SerperPlacesResponse,
  SerperSearchRequest,
  SerperSearchResponse,
} from '../interfaces/serper.interface';

const DEFAULT_SERPER_API_URL = 'https://google.serper.dev';
const DEFAULT_SERPER_TIMEOUT_MS = 15000;
const MAX_ERROR_BODY_LENGTH = 500;

/**
 * Low-level Serper HTTP client: auth, timeout, JSON parsing and error
 * mapping for the three Serper endpoints Zig-Zag uses. It returns Serper's
 * raw response shape; grounded-evidence normalization, PLACE identity and
 * tour semantics live in the callers.
 *
 * Every endpoint is `POST <base>/<endpoint>` with a JSON body and the key in
 * the `X-API-KEY` header (never in the URL, so it can't leak into logs).
 */
@Injectable()
export class SerperApiService {
  private readonly logger = new Logger(SerperApiService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  search(
    request: SerperSearchRequest,
  ): Promise<SerperCallResult<SerperSearchResponse>> {
    return this.post<SerperSearchResponse>('search', request);
  }

  searchMaps(
    request: SerperMapsRequest,
  ): Promise<SerperCallResult<SerperMapsResponse>> {
    return this.post<SerperMapsResponse>('maps', request);
  }

  searchPlaces(
    request: SerperPlacesRequest,
  ): Promise<SerperCallResult<SerperPlacesResponse>> {
    return this.post<SerperPlacesResponse>('places', request);
  }

  private get apiKey(): string | undefined {
    return this.configService.get<string>('SERPER_API_KEY') || undefined;
  }

  private get apiUrl(): string {
    return (
      this.configService.get<string>('SERPER_API_URL') || DEFAULT_SERPER_API_URL
    ).replace(/\/+$/, '');
  }

  private get timeoutMs(): number {
    const configured = Number(this.configService.get('SERPER_TIMEOUT_MS'));
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_SERPER_TIMEOUT_MS;
  }

  private async post<T>(
    endpoint: SerperEndpoint,
    body: object,
  ): Promise<SerperCallResult<T>> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new SerperApiError(
        'SERPER_API_KEY is not configured',
        'missing_api_key',
        endpoint,
      );
    }

    const startedAt = Date.now();
    let resp: Response;
    try {
      resp = await fetch(`${this.apiUrl}/${endpoint}`, {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(withoutUndefined(body)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: any) {
      const durationMs = Date.now() - startedAt;
      const timedOut =
        error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new SerperApiError(
        timedOut
          ? `Serper /${endpoint} timed out after ${this.timeoutMs}ms`
          : `Serper /${endpoint} request failed: ${error?.message ?? error}`,
        timedOut ? 'timeout' : 'network_error',
        endpoint,
        undefined,
        undefined,
        durationMs,
      );
    }

    const durationMs = Date.now() - startedAt;
    const text = await resp.text();
    if (!resp.ok) {
      const responseBody = text.slice(0, MAX_ERROR_BODY_LENGTH);
      this.logger.warn(
        `Serper /${endpoint} HTTP ${resp.status}: ${responseBody}`,
      );
      throw new SerperApiError(
        `Serper /${endpoint} returned HTTP ${resp.status}`,
        'http_error',
        endpoint,
        resp.status,
        responseBody,
        durationMs,
      );
    }

    try {
      const data = JSON.parse(text) as T;
      if (!data || typeof data !== 'object') {
        throw new Error('response body is not a JSON object');
      }
      return {
        data,
        meta: { endpoint, httpStatus: resp.status, durationMs },
      };
    } catch (error: any) {
      throw new SerperApiError(
        `Serper /${endpoint} returned an unparseable body: ${error.message}`,
        'invalid_response',
        endpoint,
        resp.status,
        text.slice(0, MAX_ERROR_BODY_LENGTH),
        durationMs,
      );
    }
  }
}

function withoutUndefined(body: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  );
}
