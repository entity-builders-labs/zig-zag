import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import aiConfig from '@shared/ai/ai.config';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';
import {
  DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
  WebSourceContentFailureReason,
  WebSourceContentProvider,
  WebSourceContentRequest,
  WebSourceContentResult,
  WebSourceContentResultItem,
} from '../interfaces/web-source-content.interface';

interface CloudflareBrowserRunResponse {
  success: boolean;
  result?: string;
  errors?: Array<{ code: number; message: string }>;
  messages?: string[];
}

/**
 * Web source content retrieval provider backed by Cloudflare Browser Run's
 * `/browser-rendering/markdown` endpoint. Implements the provider-neutral
 * `WebSourceContentProvider` contract: given known URLs, returns bounded
 * markdown without searching, ranking, or filtering.
 *
 * Enforces:
 * - Credentials validation (accountId + apiToken) with explicit failure.
 * - Per-URL caching in `AiCacheService` (`cloudflare-browser-run:${url}`).
 * - Request rate spacing: Browser Run quick-actions have strict account-level
 *   rate limits (verified live: 1 request / 10s on basic tiers). Requests are
 *   spaced by `minRequestIntervalMs` to prevent avoidable 429s.
 * - Transport error mapping to typed `WebSourceContentFailureReason`.
 * - Bounded content truncation up to `maxContentChars` (default 6000).
 */
@Injectable()
export class CloudflareWebSourceContentProvider
  implements WebSourceContentProvider
{
  readonly providerName = 'cloudflare' as const;

  private static readonly API_BASE_URL =
    'https://api.cloudflare.com/client/v4/accounts';

  private readonly logger = new Logger(CloudflareWebSourceContentProvider.name);
  private lastRequestTimestamp = 0;
  private readonly maxUrlsPerCall = 10;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
    private readonly aiCache: AiCacheService,
  ) {}

  private get cloudflare() {
    return this.config?.webSourceContent?.cloudflare;
  }

  async retrieve(
    request: WebSourceContentRequest,
  ): Promise<WebSourceContentResult> {
    const startTime = Date.now();
    const maxChars =
      request.maxContentChars ?? DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS;
    const requestedUrls = Array.from(
      new Set((request.urls || []).filter(Boolean)),
    ).slice(0, this.maxUrlsPerCall);

    if (requestedUrls.length === 0) {
      return {
        provider: this.providerName,
        requestedCount: 0,
        retrievedCount: 0,
        items: [],
        totalDurationMs: 0,
      };
    }

    const items: WebSourceContentResultItem[] = [];
    const toFetch: string[] = [];

    // 1. Check cache for each URL
    for (const url of requestedUrls) {
      const cached = await this.aiCache.getCachedResponse(
        `cloudflare-browser-run:${url}`,
      );
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            status: string;
            content: string;
          };
          if (
            parsed.status === 'success' &&
            typeof parsed.content === 'string'
          ) {
            const rawContent = parsed.content;
            if (rawContent.trim().length === 0) {
              items.push({
                requestedUrl: url,
                status: 'failed',
                provider: this.providerName,
                failureReason: 'empty_content',
                failureDetail: 'Cached content was empty',
                durationMs: 0,
              });
            } else {
              const truncated = rawContent.length > maxChars;
              const content = truncated
                ? rawContent.slice(0, maxChars)
                : rawContent;
              items.push({
                requestedUrl: url,
                status: 'retrieved',
                content,
                contentType: 'markdown',
                contentChars: rawContent.length,
                truncated,
                provider: this.providerName,
                durationMs: 0,
              });
            }
            continue;
          }
        } catch {
          // Corrupt cache entry — refetch
        }
      }
      toFetch.push(url);
    }

    if (toFetch.length === 0) {
      return {
        provider: this.providerName,
        requestedCount: requestedUrls.length,
        retrievedCount: items.filter((i) => i.status === 'retrieved').length,
        items,
        totalDurationMs: Date.now() - startTime,
      };
    }

    const accountId = this.cloudflare?.accountId;
    const apiToken = this.cloudflare?.apiToken;
    const timeoutMs = this.cloudflare?.timeoutMs ?? 20000;
    const minRequestIntervalMs = this.cloudflare?.minRequestIntervalMs ?? 10000;

    if (!accountId || !apiToken) {
      for (const url of toFetch) {
        items.push({
          requestedUrl: url,
          status: 'failed',
          provider: this.providerName,
          failureReason: 'missing_credentials',
          failureDetail: 'Missing Cloudflare accountId or apiToken',
          durationMs: Date.now() - startTime,
        });
      }
      return {
        provider: this.providerName,
        requestedCount: requestedUrls.length,
        retrievedCount: items.filter((i) => i.status === 'retrieved').length,
        items,
        totalDurationMs: Date.now() - startTime,
      };
    }

    const endpoint = `${CloudflareWebSourceContentProvider.API_BASE_URL}/${accountId}/browser-rendering/markdown`;

    for (const url of toFetch) {
      const itemStart = Date.now();
      try {
        // Enforce rate spacing between consecutive outgoing network requests
        if (minRequestIntervalMs > 0 && this.lastRequestTimestamp > 0) {
          const elapsed = Date.now() - this.lastRequestTimestamp;
          if (elapsed < minRequestIntervalMs) {
            const waitMs = minRequestIntervalMs - elapsed;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
        }

        this.lastRequestTimestamp = Date.now();

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        const durationMs = Date.now() - itemStart;

        if (!response.ok) {
          const errBody = await response.text();
          this.logger.warn(
            `Cloudflare Browser Run error ${response.status} for ${url}: ${errBody}`,
          );
          const failureReason: WebSourceContentFailureReason =
            response.status === 429
              ? 'rate_limited'
              : response.status === 401 || response.status === 403
                ? 'missing_credentials'
                : 'http_error';

          items.push({
            requestedUrl: url,
            status: 'failed',
            provider: this.providerName,
            failureReason,
            failureDetail: `HTTP ${response.status}: ${errBody}`,
            durationMs,
          });
          continue;
        }

        const data = (await response.json()) as CloudflareBrowserRunResponse;

        if (!data.success) {
          const firstError = data.errors?.[0];
          const isRateLimit =
            firstError?.code === 2001 ||
            /rate limit/i.test(firstError?.message ?? '');
          const failureReason: WebSourceContentFailureReason = isRateLimit
            ? 'rate_limited'
            : 'provider_error';

          items.push({
            requestedUrl: url,
            status: 'failed',
            provider: this.providerName,
            failureReason,
            failureDetail:
              firstError?.message ?? 'Cloudflare Browser Run reported failure',
            durationMs,
          });
          continue;
        }

        const rawContent = data.result ?? '';
        if (rawContent.trim().length === 0) {
          items.push({
            requestedUrl: url,
            status: 'failed',
            provider: this.providerName,
            failureReason: 'empty_content',
            failureDetail: 'Cloudflare returned empty markdown content',
            durationMs,
          });
          continue;
        }

        const truncated = rawContent.length > maxChars;
        const content = truncated ? rawContent.slice(0, maxChars) : rawContent;

        items.push({
          requestedUrl: url,
          status: 'retrieved',
          content,
          contentType: 'markdown',
          contentChars: rawContent.length,
          truncated,
          provider: this.providerName,
          durationMs,
        });

        await this.aiCache.cacheResponse(
          `cloudflare-browser-run:${url}`,
          JSON.stringify({ status: 'success', content: rawContent }),
        );
      } catch (error: any) {
        const durationMs = Date.now() - itemStart;
        this.logger.warn(
          `Cloudflare Browser Run failed for ${url}: ${error.message}`,
        );
        const isTimeout =
          error.name === 'AbortError' ||
          error.name === 'TimeoutError' ||
          /timeout/i.test(error.message);
        const failureReason: WebSourceContentFailureReason = isTimeout
          ? 'timeout'
          : 'provider_error';

        items.push({
          requestedUrl: url,
          status: 'failed',
          provider: this.providerName,
          failureReason,
          failureDetail: error.message,
          durationMs,
        });
      }
    }

    return {
      provider: this.providerName,
      requestedCount: requestedUrls.length,
      retrievedCount: items.filter((i) => i.status === 'retrieved').length,
      items,
      totalDurationMs: Date.now() - startTime,
    };
  }
}
