import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';
import {
  WebSourceContentFailureReason,
  WebSourceContentProvider,
  WebSourceContentRequest,
  WebSourceContentResult,
  WebSourceContentResultItem,
} from '../interfaces/web-source-content.interface';

export interface TavilyExtractResult {
  status: 'success' | 'failed';
  content?: string;
  error?: string;
}

interface TavilyExtractApiResponse {
  results?: Array<{ url: string; raw_content?: string }>;
  failed_results?: Array<{ url: string; error?: string }>;
}

/**
 * Web source content retrieval provider backed by Tavily's licensed /extract
 * endpoint. Implements the provider-neutral `WebSourceContentProvider` contract:
 * given known URLs, returns their complete markdown/text without searching,
 * ranking, filtering, or bounding it (see `WebSourceContentResultItem.content`).
 *
 * Also preserves the legacy `extract(urls)` method and `TavilyExtractService`
 * alias so callers (such as Gemini grounded search) and existing unit tests
 * continue to function without disruption.
 */
@Injectable()
export class TavilyWebSourceContentProvider
  implements WebSourceContentProvider
{
  readonly providerName = 'tavily' as const;

  private readonly logger = new Logger(TavilyWebSourceContentProvider.name);
  private readonly apiUrl = 'https://api.tavily.com/extract';
  private readonly timeoutMs = 15000;
  // Bounds a single discovery query's worth of cited URLs — Tavily bills
  // extract by URL count, and grounded search evidence rarely cites more
  // than a handful of genuinely distinct sources per query.
  private readonly maxUrlsPerCall = 20;

  constructor(
    private readonly config: ConfigService,
    private readonly aiCache: AiCacheService,
  ) {}

  async retrieve(
    request: WebSourceContentRequest,
  ): Promise<WebSourceContentResult> {
    const startTime = Date.now();
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
      const cached = await this.aiCache.getCachedResponse(`extract:${url}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as TavilyExtractResult;
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
              items.push({
                requestedUrl: url,
                status: 'retrieved',
                content: rawContent,
                contentType: 'markdown',
                contentChars: rawContent.length,
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

    const apiKey =
      this.config.get<string>('ai.tavilyApiKey') || process.env.TAVILY_API_KEY;

    if (!apiKey) {
      for (const url of toFetch) {
        items.push({
          requestedUrl: url,
          status: 'failed',
          provider: this.providerName,
          failureReason: 'missing_credentials',
          failureDetail: 'Missing Tavily API key',
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

    const callStart = Date.now();
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ urls: toFetch }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const callDuration = Date.now() - callStart;

      if (!response.ok) {
        const errBody = await response.text();
        this.logger.warn(`Tavily extract error ${response.status}: ${errBody}`);
        const failureReason: WebSourceContentFailureReason =
          response.status === 429
            ? 'rate_limited'
            : response.status === 401 || response.status === 403
              ? 'missing_credentials'
              : 'http_error';

        for (const url of toFetch) {
          items.push({
            requestedUrl: url,
            status: 'failed',
            provider: this.providerName,
            failureReason,
            failureDetail: `HTTP ${response.status}: ${errBody}`,
            durationMs: callDuration,
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

      const data = (await response.json()) as TavilyExtractApiResponse;
      const seenUrls = new Set<string>();

      for (const item of data.results ?? []) {
        seenUrls.add(item.url);
        const rawContent = item.raw_content ?? '';
        if (rawContent.trim().length === 0) {
          items.push({
            requestedUrl: item.url,
            status: 'failed',
            provider: this.providerName,
            failureReason: 'empty_content',
            failureDetail: 'Tavily returned empty content',
            durationMs: callDuration,
          });
        } else {
          items.push({
            requestedUrl: item.url,
            status: 'retrieved',
            content: rawContent,
            contentType: 'markdown',
            contentChars: rawContent.length,
            provider: this.providerName,
            durationMs: callDuration,
          });
          await this.aiCache.cacheResponse(
            `extract:${item.url}`,
            JSON.stringify({ status: 'success', content: rawContent }),
          );
        }
      }

      for (const item of data.failed_results ?? []) {
        seenUrls.add(item.url);
        items.push({
          requestedUrl: item.url,
          status: 'failed',
          provider: this.providerName,
          failureReason: 'provider_error',
          failureDetail: item.error ?? 'tavily_extract_failed',
          durationMs: callDuration,
        });
      }

      for (const url of toFetch) {
        if (!seenUrls.has(url)) {
          items.push({
            requestedUrl: url,
            status: 'failed',
            provider: this.providerName,
            failureReason: 'provider_error',
            failureDetail: 'tavily_extract_no_response',
            durationMs: callDuration,
          });
        }
      }
    } catch (error: any) {
      const callDuration = Date.now() - callStart;
      this.logger.warn(`Tavily extract request failed: ${error.message}`);
      const isTimeout =
        error.name === 'AbortError' ||
        error.name === 'TimeoutError' ||
        /timeout/i.test(error.message);
      const failureReason: WebSourceContentFailureReason = isTimeout
        ? 'timeout'
        : 'provider_error';

      for (const url of toFetch) {
        items.push({
          requestedUrl: url,
          status: 'failed',
          provider: this.providerName,
          failureReason,
          failureDetail: error.message,
          durationMs: callDuration,
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

  /**
   * Compatibility adapter for legacy callers (e.g. GeminiGroundedSearchService).
   */
  async extract(urls: string[]): Promise<Map<string, TavilyExtractResult>> {
    const result = await this.retrieve({ urls });

    const map = new Map<string, TavilyExtractResult>();
    for (const item of result.items) {
      if (item.status === 'retrieved') {
        map.set(item.requestedUrl, {
          status: 'success',
          content: item.content ?? '',
        });
      } else {
        const legacyError =
          item.failureReason === 'missing_credentials'
            ? 'missing_tavily_api_key'
            : item.failureReason === 'rate_limited'
              ? 'tavily_extract_rate_limited'
              : (item.failureDetail ?? item.failureReason ?? 'extract_failed');
        map.set(item.requestedUrl, {
          status: 'failed',
          error: legacyError,
        });
      }
    }
    return map;
  }
}

/**
 * Backward compatibility alias for TavilyWebSourceContentProvider.
 */
export { TavilyWebSourceContentProvider as TavilyExtractService };
