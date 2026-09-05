import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundingEvidence as GroundingEvidence,
} from '../interfaces/experience-grounding.interface';

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilySearchResponse {
  query?: string;
  results?: TavilySearchResult[];
  response_time?: number;
}

@Injectable()
export class TavilyGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(TavilyGroundedSearchService.name);
  private readonly apiUrl = 'https://api.tavily.com/search';
  private readonly timeoutMs = 15000;
  private readonly model = 'tavily-search-basic';

  constructor(private readonly config: ConfigService) {}

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const apiKey =
      this.config.get<string>('ai.tavilyApiKey') || process.env.TAVILY_API_KEY;

    if (!apiKey) {
      return {
        provider: 'tavily',
        model: this.model,
        groundingStatus: 'unavailable',
        evidence: [],
        failureReason: 'missing_tavily_api_key',
      };
    }

    const query = this.buildSearchQuery(request);

    try {
      this.logger.debug(`Tavily search for: ${query}`);
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          // Tavily bills per request, not per result (up to its own cap of
          // 20) — raising this costs nothing extra and buys real diversity.
          // Verified live: a page enumerating three distinct themes beyond
          // the single dominant one only entered the top 10 once results
          // were raised to 20, in the exact same single call — cheaper and
          // simpler than a second discovery round for the same gap.
          max_results: 20,
          include_answer: false,
          include_raw_content: false,
          // Deliberately never passed to Tavily's own `country` boost, even
          // though destinationCountry is available: repeating the identical
          // query live showed 0-to-20 result-count variance on its own, and
          // pairing that noise with `country` occasionally returned zero
          // results outright — a worse failure than the milder, already
          // mitigated risk of some wrong-country evidence slipping through.
          // CompositeGeographicValidationService's destination_mismatch
          // check already rejects a wrong-country candidate downstream,
          // before it can ever be persisted — so the generic, unfiltered
          // search plus that existing downstream filter is more robust than
          // trying to get Tavily's own opaque relevance/boost logic to do
          // the filtering upstream.
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errBody = await response.text();
        this.logger.error(`Tavily search error ${response.status}: ${errBody}`);
        return {
          provider: 'tavily',
          model: this.model,
          groundingStatus: 'failed',
          evidence: [],
          failureReason:
            response.status === 429
              ? 'tavily_rate_limited'
              : `tavily_error_${response.status}`,
          rawOutput: errBody,
        };
      }

      const data = (await response.json()) as TavilySearchResponse;
      const evidence = this.extractEvidence(data.results);

      return {
        provider: 'tavily',
        model: this.model,
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        rawOutput: data,
      };
    } catch (error: any) {
      this.logger.error(`Tavily search failed: ${error.message}`);
      return {
        provider: 'tavily',
        model: this.model,
        groundingStatus: 'failed',
        evidence: [],
        failureReason: error.message,
      };
    }
  }

  private buildSearchQuery(request: GroundedSearchRequest): string {
    // Trust the caller's already-built query whenever one exists — same
    // contract as SerpApiGroundedSearchService/GroqGroundedSearchService, so
    // swapping providers is actually transparent. The previous 200-char/
    // no-newline cutoff had no basis in Tavily's own API (their guidance
    // tops out around 400 chars) and silently discarded a real, working
    // query, replacing it with a cruder fallback — verified live: it
    // returned generic government tourism-portal noise contaminated with
    // unrelated countries, worse than the query it was "protecting" against.
    const raw = request.query?.trim();
    if (raw && !raw.includes('\n')) {
      return raw;
    }
    return this.buildFallbackQuery(request);
  }

  private buildFallbackQuery(request: GroundedSearchRequest): string {
    const destination = request.destinationName;
    const themes = request.requestedThemes.slice(0, 4).join(' ');
    const prefs = request.additionalPreferences
      ? request.additionalPreferences
          .replace(/[^\w\s\u00C0-\u017F]/g, ' ')
          .slice(0, 100)
      : '';
    return `${destination} ${themes} ${prefs} turismo atractivos experiencias lugares`
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractEvidence(
    results: TavilySearchResult[] | undefined,
  ): GroundingEvidence[] {
    if (!Array.isArray(results)) return [];

    return results
      .filter((result) => Boolean(result.content?.trim()))
      .map((result, index) => ({
        key: `ev-${index + 1}`,
        source: result.title || result.url || 'tavily-search',
        snippet: result.content!.trim(),
        title: result.title,
        url: result.url,
      }));
  }
}
