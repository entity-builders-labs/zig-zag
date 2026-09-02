import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
  ExperienceGroundingEvidence as GroundingEvidence,
} from '../interfaces/experience-grounding.interface';
type GroundedTextBlock = { text: string; evidenceKeys: string[] };

interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerpApiTextBlockItem {
  snippet?: string;
  snippet_links?: { link?: string }[];
}

interface SerpApiTextBlock {
  type: 'paragraph' | 'heading' | 'list';
  snippet?: string;
  list?: SerpApiTextBlockItem[];
}

interface SerpApiAiModeResponse {
  search_metadata?: { google_ai_mode_url?: string };
  text_blocks?: SerpApiTextBlock[];
}

/**
 * Real web search evidence via SerpApi (Google Search results), decoupled
 * from the extraction LLM's own token quota — this is a plain search API,
 * not an LLM, so it never competes with GroqDiscoveryProvider for tokens.
 *
 * Two paths: the legacy "general" path (engine=google, keyword-concat
 * query, used for pure theme gaps) and the "semantic" path
 * (engine=google_ai_mode, natural-language query built by
 * SemanticDiscoveryQueryBuilder for one missing ActivityKind, carried in
 * request.query) — see docs/architecture and the discovery-fix plan for why
 * google_ai_mode materially outperforms engine=google for smaller/
 * less-documented destinations.
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

    if (request.query && request.query.trim()) {
      return this.searchSemantic(request, apiKey);
    }
    return this.searchGeneral(request, apiKey);
  }

  // ── Semantic path (engine=google_ai_mode) ──────────────────────────

  private async searchSemantic(
    request: GroundedSearchRequest,
    apiKey: string,
  ): Promise<GroundedSearchResult> {
    const location = this.formatLocation(request);

    try {
      let resp = await this.fetchAiMode(request.query, apiKey, location);

      if (!resp.ok && resp.status === 400 && location) {
        const errBody = await resp.text();
        if (errBody.includes('location parameter')) {
          // SerpApi's `location` requires a canonical match against its own
          // database, not free text — live-confirmed to reject a "city"/
          // "town" suffix specifically. Query-text scoping ("stay strictly
          // inside {destination}") is already proven sufficient on its own,
          // so retry once without `location` rather than losing the call.
          this.logger.warn(
            `SerpApi rejected location "${location}" — retrying without it`,
          );
          resp = await this.fetchAiMode(request.query, apiKey, undefined);
        } else {
          this.logger.error(`SerpApi google_ai_mode error 400: ${errBody}`);
          return this.semanticFailure('serpapi_error_400', errBody);
        }
      }

      if (!resp.ok) {
        const errBody = await resp.text();
        this.logger.error(
          `SerpApi google_ai_mode error ${resp.status}: ${errBody}`,
        );
        return this.semanticFailure(`serpapi_error_${resp.status}`, errBody);
      }

      const rawText = await resp.text();
      let evidence: GroundingEvidence[];
      let textBlocks: GroundedTextBlock[] = [];
      try {
        const data: SerpApiAiModeResponse = JSON.parse(rawText);
        ({ evidence, textBlocks } = this.parseAiModeResponse(data));
      } catch (parseError: any) {
        // Live-confirmed: raw google_ai_mode responses aren't always strictly
        // valid JSON (a malformed backslash-escape inside a snippet field
        // breaks JSON.parse outright, intermittently). Salvage what we can
        // via regex rather than losing the whole call.
        this.logger.warn(
          `SerpApi google_ai_mode returned malformed JSON, attempting salvage: ${parseError.message}`,
        );
        evidence = this.salvageEvidenceFromRawText(rawText);
      }

      return {
        provider: 'serpapi',
        model: 'google-ai-mode',
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        textBlocks,
        rawOutput: rawText,
      };
    } catch (error: any) {
      this.logger.error(
        `SerpApi google_ai_mode search failed: ${error.message}`,
      );
      return this.semanticFailure(error.message);
    }
  }

  private fetchAiMode(
    query: string,
    apiKey: string,
    location: string | undefined,
  ): Promise<Response> {
    const params = new URLSearchParams({
      engine: 'google_ai_mode',
      q: query,
      hl: 'en',
      api_key: apiKey,
    });
    if (location) {
      params.set('location', location);
    }
    const url = `${this.apiUrl}?${params.toString()}`;
    return fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
  }

  private formatLocation(request: GroundedSearchRequest): string | undefined {
    return request.destinationName;
  }

  /**
   * Parses text_blocks into both GroundingEvidence[] (one entry per list
   * item — what NEIGHBORHOOD_WALK/EXPERIENCE/AREA extraction reads) and
   * GroundedTextBlock[] (the full running narrative — what ROUTE's
   * evidence-aware extraction reads, since a route name can appear anywhere
   * in prose rather than a predictable structured field).
   */
  private parseAiModeResponse(data: SerpApiAiModeResponse): {
    evidence: GroundingEvidence[];
    textBlocks: GroundedTextBlock[];
  } {
    const evidence: GroundingEvidence[] = [];
    const textBlocks: GroundedTextBlock[] = [];
    let currentHeading: string | undefined;
    let counter = 0;

    for (const block of data.text_blocks ?? []) {
      if (block.type === 'heading') {
        currentHeading = block.snippet?.trim();
        textBlocks.push({ text: block.snippet ?? '', evidenceKeys: [] });
        continue;
      }
      if (block.type === 'paragraph') {
        textBlocks.push({ text: block.snippet ?? '', evidenceKeys: [] });
        continue;
      }
      // type === 'list'
      const blockEvidenceKeys: string[] = [];
      const itemTexts: string[] = [];
      for (const item of block.list ?? []) {
        const snippet = item.snippet?.trim();
        if (!snippet) continue;
        counter += 1;
        const key = `ev-${counter}`;
        evidence.push({
          key,
          source: currentHeading || 'google_ai_mode',
          snippet,
          title: currentHeading,
          // Deliberately no fallback to search_metadata.google_ai_mode_url
          // here: that URL embeds the full url-encoded query (~1500-1800
          // chars) and isn't a real per-claim citation anyway (one URL
          // shared by the whole response) — live-confirmed that repeating
          // it across ~30 merged evidence items ballooned a real extraction
          // request from ~1-2k to 24k+ tokens, tripping Groq's 8000 TPM
          // limit. rawOutput still carries it once, for audit.
          url: item.snippet_links?.[0]?.link,
        });
        blockEvidenceKeys.push(key);
        itemTexts.push(snippet);
      }
      textBlocks.push({
        text: itemTexts.join(' '),
        evidenceKeys: blockEvidenceKeys,
      });
    }

    return { evidence, textBlocks };
  }

  private salvageEvidenceFromRawText(raw: string): GroundingEvidence[] {
    const snippetMatches = [
      ...raw.matchAll(/"snippet"\s*:\s*"((?:[^"\\]|\\.)*)"/g),
    ];
    return snippetMatches
      .map((match) =>
        match[1]
          .replace(/\\n/g, ' ')
          .replace(/\\"/g, '"')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter((snippet) => snippet.length > 0)
      .map((snippet, index) => ({
        key: `ev-${index + 1}`,
        source: 'google_ai_mode',
        snippet,
      }));
  }

  private semanticFailure(
    failureReason: string,
    rawOutput?: unknown,
  ): GroundedSearchResult {
    return {
      provider: 'serpapi',
      model: 'google-ai-mode',
      groundingStatus: 'failed',
      evidence: [],
      failureReason,
      rawOutput,
    };
  }

  // ── General path (engine=google, unchanged) ─────────────────────────

  private async searchGeneral(
    request: GroundedSearchRequest,
    apiKey: string,
  ): Promise<GroundedSearchResult> {
    const query = this.buildSearchQuery(request);
    const url = `${this.apiUrl}?${new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: apiKey,
      // SerpApi bills per search request, not per result — more results
      // means more real evidence for the extraction step to work with, at
      // no extra cost. Nothing downstream truncates evidence before it
      // reaches the model (GroqDiscoveryProvider.buildEvidenceMap includes
      // every entry); only MAX_PROPOSALS bounds how many proposals come out.
      num: '20',
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
    return request.query?.trim() || [request.destinationName, ...request.requestedThemes, 'real tourism experiences'].join(' ');
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
