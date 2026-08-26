import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GroundedSearchRequest,
  GroundedSearchResult,
  GroundedSearchProvider,
  GroundingEvidence,
} from '../interfaces/activity-discovery.interface';

interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

/**
 * Real web search evidence via SerpApi (Google Search results), decoupled
 * from the extraction LLM's own token quota — this is a plain search API,
 * not an LLM, so it never competes with GroqDiscoveryProvider for tokens.
 */
@Injectable()
export class SerpApiGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(SerpApiGroundedSearchService.name);
  private readonly apiUrl = 'https://serpapi.com/search.json';
  private readonly timeoutMs = 15000;

  constructor(private readonly config: ConfigService) {}

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const apiKey =
      this.config.get<string>('ai.serpApiKey') || process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      return {
        provider: 'serpapi',
        model: 'google-search',
        groundingStatus: 'unavailable',
        evidence: [],
        failureReason: 'missing_serpapi_key',
      };
    }

    const query = this.buildSearchQuery(request);
    const url = `${this.apiUrl}?${new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: apiKey,
      num: '10',
    }).toString()}`;

    try {
      this.logger.debug(`SerpApi search for: ${request.destinationName}`);
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        this.logger.error(`SerpApi error ${resp.status}: ${errBody}`);
        return {
          provider: 'serpapi',
          model: 'google-search',
          groundingStatus: 'failed',
          evidence: [],
          failureReason: `serpapi_error_${resp.status}`,
          rawOutput: errBody,
        };
      }

      const data = await resp.json();
      const evidence = this.extractEvidence(data.organic_results);

      return {
        provider: 'serpapi',
        model: 'google-search',
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        rawOutput: data,
      };
    } catch (error: any) {
      this.logger.error(`SerpApi search failed: ${error.message}`);
      return {
        provider: 'serpapi',
        model: 'google-search',
        groundingStatus: 'failed',
        evidence: [],
        failureReason: error.message,
      };
    }
  }

  private buildSearchQuery(request: GroundedSearchRequest): string {
    const parts: string[] = [
      request.destinationName,
      ...(request.destinationCountry ? [request.destinationCountry] : []),
      ...request.requestedThemes,
      'must-see attractions travel guide',
    ];
    if (request.requestedExperienceFormats?.length) {
      parts.push(...request.requestedExperienceFormats);
    }
    return parts.join(' ');
  }

  private extractEvidence(
    results: SerpApiOrganicResult[] | undefined,
  ): GroundingEvidence[] {
    if (!Array.isArray(results)) return [];
    const evidence: GroundingEvidence[] = [];
    let i = 0;
    for (const result of results) {
      if (!result.snippet || !result.snippet.trim()) continue;
      i += 1;
      evidence.push({
        key: `ev-${i}`,
        source: result.title || result.link || 'google-search',
        snippet: result.snippet.trim(),
        url: result.link,
      });
    }
    return evidence;
  }
}
