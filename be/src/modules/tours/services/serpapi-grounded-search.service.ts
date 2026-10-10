import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';
import {
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
  ExperienceGroundingEvidence as GroundingEvidence,
  GroundingNormalizationAudit,
  GroundingNormalizationDecision,
} from '../interfaces/experience-grounding.interface';
import { groundingEvidenceDedupeKey } from '../utils/grounding-evidence-dedupe.util';
type GroundedTextBlock = { text: string; evidenceKeys: string[] };

interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerpApiTextBlockItem {
  text?: string;
  snippet?: string;
  snippet_links?: SerpApiSnippetLink[];
}

interface SerpApiSnippetLink {
  text?: string;
  link?: string;
}

interface SerpApiTextBlock {
  type: 'paragraph' | 'heading' | 'list';
  snippet?: string;
  snippet_links?: SerpApiSnippetLink[];
  list?: SerpApiTextBlockItem[];
}

interface SerpApiAiModeResponse {
  text_blocks?: SerpApiTextBlock[];
  references?: SerpApiReference[];
}

interface SerpApiReference {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string;
}

/**
 * Real web search evidence via SerpApi (Google Search results), decoupled
 * from the extraction LLM's own token quota — this is a plain search API,
 * not an LLM, so it never competes with GroqDiscoveryProvider for tokens.
 *
 * Two paths: the legacy "general" path (engine=google, keyword-concat
 * query, used for pure theme gaps) and the "semantic" path
 * (engine=google_ai_mode, natural-language query built by
 * SemanticDiscoveryQueryBuilder for one missing experience trait, carried in
 * request.query) — see docs/architecture and the discovery-fix plan for why
 * google_ai_mode materially outperforms engine=google for smaller/
 * less-documented destinations.
 */
@Injectable()
export class SerpApiGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(SerpApiGroundedSearchService.name);
  private readonly apiUrl = 'https://serpapi.com/search.json';
  /**
   * Live-confirmed against the real SerpApi endpoint (2026-09-17): a fresh,
   * never-cached `engine=google_ai_mode` query took 50.88s
   * (`search_metadata.total_time_taken`) — this engine genuinely runs an
   * AI-generation pass server-side, unlike the plain `engine=google` path.
   * The previous 15000ms timeout was BELOW that real latency, so most
   * uncached semantic-path queries were being aborted client-side right
   * before SerpApi would have returned real evidence — not a SerpApi
   * outage, a client timeout misconfiguration. 65000ms keeps real margin
   * above the measured worst case, the same way the local Overpass/
   * Nominatim services size their own timeouts against real observed
   * provider latency rather than a guess.
   */
  private readonly timeoutMs = 65000;

  constructor(
    private readonly config: ConfigService,
    private readonly aiCache: AiCacheService,
  ) {}

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const cacheKey = this.cacheKey(request);
    const cached = await this.aiCache.getCachedResponse(cacheKey, {
      type: 'grounded-search',
      provider: 'serpapi',
    });
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as GroundedSearchResult;
        if (
          parsed.groundingStatus === 'applied' &&
          parsed.evidence.length > 0
        ) {
          return parsed;
        }
      } catch {
        this.logger.warn('Ignoring malformed cached SerpAPI result');
      }
    }

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

    const result =
      request.query && request.query.trim()
        ? await this.searchSemantic(request, apiKey)
        : await this.searchGeneral(request, apiKey);
    if (result.groundingStatus === 'applied' && result.evidence.length > 0) {
      await this.aiCache.cacheResponse(cacheKey, JSON.stringify(result), {
        type: 'grounded-search',
        provider: 'serpapi',
      });
    }
    return result;
  }

  private cacheKey(request: GroundedSearchRequest): string {
    return `serpapi-grounded-search:v2:${JSON.stringify({
      destinationName: request.destinationName,
      requestedThemes: [...request.requestedThemes].sort(),
      query: request.query?.trim() || '',
    })}`;
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
      let normalizationAudit: GroundingNormalizationAudit;
      try {
        const data: SerpApiAiModeResponse = JSON.parse(rawText);
        ({ evidence, textBlocks, normalizationAudit } =
          this.parseAiModeResponse(data));
      } catch (parseError: any) {
        // Live-confirmed: raw google_ai_mode responses aren't always strictly
        // valid JSON (a malformed backslash-escape inside a snippet field
        // breaks JSON.parse outright, intermittently). Salvage what we can
        // via regex rather than losing the whole call.
        this.logger.warn(
          `SerpApi google_ai_mode returned malformed JSON, attempting salvage: ${parseError.message}`,
        );
        ({ evidence, normalizationAudit } =
          this.salvageEvidenceFromRawText(rawText));
      }

      return {
        provider: 'serpapi',
        model: 'google-ai-mode',
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        textBlocks,
        normalizationAudit,
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
    normalizationAudit: GroundingNormalizationAudit;
  } {
    const evidence: GroundingEvidence[] = [];
    const textBlocks: GroundedTextBlock[] = [];
    const decisions: GroundingNormalizationDecision[] = [];
    let currentHeading: string | undefined;
    let counter = 0;
    let order = 0;
    const seen = new Set<string>();
    const emit = (input: {
      sourceLocator: string;
      sourceKind: GroundingNormalizationDecision['sourceKind'];
      snippet?: string;
      source: string;
      title?: string;
      url?: string;
      kind: GroundingEvidence['kind'];
      contextHeading?: string;
      reason: GroundingNormalizationDecision['reason'];
    }): string | undefined => {
      const snippet = input.snippet?.trim();
      if (!snippet) {
        decisions.push({
          sourceLocator: input.sourceLocator,
          sourceKind: input.sourceKind,
          action: 'SKIPPED',
          reason: 'EMPTY_SNIPPET',
        });
        return undefined;
      }
      const dedupeKey = groundingEvidenceDedupeKey(snippet, input.url);
      if (seen.has(dedupeKey)) {
        decisions.push({
          sourceLocator: input.sourceLocator,
          sourceKind: input.sourceKind,
          action: 'SKIPPED',
          reason: 'DUPLICATE_EVIDENCE',
          preview: snippet.slice(0, 160),
        });
        return undefined;
      }
      seen.add(dedupeKey);
      const key = `ev-${++counter}`;
      evidence.push({
        key,
        source: input.source,
        snippet,
        title: input.title,
        url: input.url,
        kind: input.kind,
        order: ++order,
        contextHeading: input.contextHeading,
      });
      decisions.push({
        sourceLocator: input.sourceLocator,
        sourceKind: input.sourceKind,
        action: 'EMITTED_EVIDENCE',
        evidenceKey: key,
        reason: input.reason,
        preview: snippet.slice(0, 160),
      });
      return key;
    };

    for (const [blockIndex, block] of (data.text_blocks ?? []).entries()) {
      if (block.type === 'heading') {
        currentHeading = block.snippet?.trim();
        textBlocks.push({ text: block.snippet ?? '', evidenceKeys: [] });
        decisions.push({
          sourceLocator: `text_blocks[${blockIndex}]`,
          sourceKind: 'heading',
          action: 'CONTEXT_ONLY',
          reason: 'HEADING_CONTEXT_ONLY',
          preview: currentHeading?.slice(0, 160),
        });
        continue;
      }
      if (block.type === 'paragraph') {
        const key = emit({
          sourceLocator: `text_blocks[${blockIndex}]`,
          sourceKind: 'paragraph',
          snippet: block.snippet,
          source: currentHeading ?? 'google_ai_mode',
          title: currentHeading,
          url: this.preferredRealSourceLink(block.snippet_links),
          kind: 'narrative_paragraph',
          contextHeading: currentHeading,
          reason: 'PARAGRAPH_EMITTED',
        });
        textBlocks.push({
          text: block.snippet ?? '',
          evidenceKeys: key ? [key] : [],
        });
        continue;
      }
      // type === 'list'
      const blockEvidenceKeys: string[] = [];
      const itemTexts: string[] = [];
      for (const [itemIndex, item] of (block.list ?? []).entries()) {
        const key = emit({
          sourceLocator: `text_blocks[${blockIndex}].list[${itemIndex}]`,
          sourceKind: 'list_item',
          snippet: item.snippet,
          source: currentHeading || 'google_ai_mode',
          title: currentHeading,
          url: this.preferredRealSourceLink(item.snippet_links),
          kind: 'list_item',
          contextHeading: currentHeading,
          reason: 'LIST_ITEM_EMITTED',
        });
        if (key) {
          blockEvidenceKeys.push(key);
          itemTexts.push(item.snippet!.trim());
        }
      }
      textBlocks.push({
        text: itemTexts.join(' '),
        evidenceKeys: blockEvidenceKeys,
      });
    }

    for (const [referenceIndex, reference] of (
      data.references ?? []
    ).entries()) {
      emit({
        sourceLocator: `references[${referenceIndex}]`,
        sourceKind: 'reference',
        snippet: reference.snippet,
        source:
          reference.source ??
          reference.title ??
          reference.link ??
          'google_ai_mode',
        title: reference.title,
        url: reference.link,
        kind: 'reference',
        reason: 'REFERENCE_EMITTED',
      });
    }
    return {
      evidence,
      textBlocks,
      normalizationAudit: {
        mode: 'structured',
        rawItemCount: decisions.length,
        emittedEvidenceCount: evidence.length,
        decisions,
      },
    };
  }

  private salvageEvidenceFromRawText(raw: string): {
    evidence: GroundingEvidence[];
    normalizationAudit: GroundingNormalizationAudit;
  } {
    const snippetMatches = [
      ...raw.matchAll(/"snippet"\s*:\s*"((?:[^"\\]|\\.)*)"/g),
    ];
    const decisions: GroundingNormalizationDecision[] = [];
    const evidence = snippetMatches
      .map((match) =>
        match[1]
          .replace(/\\n/g, ' ')
          .replace(/\\"/g, '"')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter((snippet) => snippet.length > 0)
      .map((snippet, index) => {
        const key = `ev-${index + 1}`;
        decisions.push({
          sourceLocator: `salvage.snippet[${index}]`,
          sourceKind: 'paragraph',
          action: 'EMITTED_EVIDENCE',
          evidenceKey: key,
          reason: 'PARAGRAPH_EMITTED',
          preview: snippet.slice(0, 160),
        });
        return { key, source: 'google_ai_mode', snippet };
      });
    return {
      evidence,
      normalizationAudit: {
        mode: 'salvage',
        rawItemCount: snippetMatches.length,
        emittedEvidenceCount: evidence.length,
        decisions,
      },
    };
  }

  private preferredRealSourceLink(
    links?: SerpApiSnippetLink[],
  ): string | undefined {
    const usable = (links ?? [])
      .map((link) => link.link?.trim())
      .filter((link): link is string => !!link && /^https?:\/\//i.test(link));
    const real = usable.find((link) => {
      try {
        const url = new URL(link);
        return (
          !/(^|\.)google\./i.test(url.hostname) &&
          !/\/maps\/dir|directions/i.test(url.pathname + url.search)
        );
      } catch {
        return false;
      }
    });
    return real ?? usable[0];
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
    return (
      request.query?.trim() ||
      [
        request.destinationName,
        ...request.requestedThemes,
        'real tourism experiences',
      ].join(' ')
    );
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
