import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';

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
 * Fetches original page content for a bounded set of URLs, via Tavily's own
 * licensed /extract endpoint — never a bespoke scraper of our own. Built for
 * the Gemini grounded-search provider: Gemini's google_search grounding
 * discovers real, cited URLs, but its own model_output is a synthesis of
 * those sources, not their literal text (see GeminiGroundedSearchService's
 * own doc comment). Recovering the original content here keeps the
 * downstream extractor working from raw source text in both the Tavily-
 * search and Gemini-search flows, instead of a second LLM's paraphrase of a
 * first LLM's paraphrase.
 *
 * NOT live-verified this session — Tavily's /search endpoint was exercised
 * live repeatedly, but /extract's exact response shape here is implemented
 * against Tavily's documented API contract, not a live call. Spot-check
 * before relying on this in production.
 */
@Injectable()
export class TavilyExtractService {
  private readonly logger = new Logger(TavilyExtractService.name);
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

  async extract(urls: string[]): Promise<Map<string, TavilyExtractResult>> {
    const results = new Map<string, TavilyExtractResult>();
    // Rule: dedup URLs before calling /extract — the same source can back
    // multiple groundingSupports/citations.
    const uniqueUrls = Array.from(new Set(urls.filter(Boolean))).slice(
      0,
      this.maxUrlsPerCall,
    );
    if (uniqueUrls.length === 0) return results;

    const toFetch: string[] = [];
    for (const url of uniqueUrls) {
      // Rule: cache results per URL, reusing the existing generic AiCacheService
      // rather than a bespoke cache file — keyed distinctly from LLM prompt
      // caching via the 'extract:' prefix.
      const cached = await this.aiCache.getCachedResponse(`extract:${url}`);
      if (cached) {
        try {
          results.set(url, JSON.parse(cached));
          continue;
        } catch {
          // Corrupt/legacy cache entry — refetch rather than fail.
        }
      }
      toFetch.push(url);
    }
    if (toFetch.length === 0) return results;

    const apiKey =
      this.config.get<string>('ai.tavilyApiKey') || process.env.TAVILY_API_KEY;
    if (!apiKey) {
      // Rule: a failure is never silent — every requested URL gets an
      // explicit failed entry the caller must react to (mark
      // evidenceQuality: 'reduced'), never a quiet drop.
      for (const url of toFetch) {
        results.set(url, {
          status: 'failed',
          error: 'missing_tavily_api_key',
        });
      }
      return results;
    }

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

      if (!response.ok) {
        const errBody = await response.text();
        this.logger.warn(`Tavily extract error ${response.status}: ${errBody}`);
        for (const url of toFetch) {
          results.set(url, {
            status: 'failed',
            error:
              response.status === 429
                ? 'tavily_extract_rate_limited'
                : `tavily_extract_error_${response.status}`,
          });
        }
        return results;
      }

      const data = (await response.json()) as TavilyExtractApiResponse;
      for (const item of data.results ?? []) {
        const parsed: TavilyExtractResult = {
          status: 'success',
          content: item.raw_content ?? '',
        };
        results.set(item.url, parsed);
        await this.aiCache.cacheResponse(
          `extract:${item.url}`,
          JSON.stringify(parsed),
        );
      }
      for (const item of data.failed_results ?? []) {
        results.set(item.url, {
          status: 'failed',
          error: item.error ?? 'tavily_extract_failed',
        });
      }
      // Rule: no silent condition — a URL Tavily's response never mentioned
      // at all (neither succeeded nor explicitly failed) still gets an
      // explicit failed entry.
      for (const url of toFetch) {
        if (!results.has(url)) {
          results.set(url, {
            status: 'failed',
            error: 'tavily_extract_no_response',
          });
        }
      }
    } catch (error: any) {
      this.logger.warn(`Tavily extract request failed: ${error.message}`);
      for (const url of toFetch) {
        results.set(url, { status: 'failed', error: error.message });
      }
    }

    return results;
  }
}
