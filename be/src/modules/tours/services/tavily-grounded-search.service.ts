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
          max_results: 10,
          include_answer: false,
          include_raw_content: false,
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
    const raw = request.query?.trim();
    if (raw && raw.length < 200 && !raw.includes('\n')) {
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
