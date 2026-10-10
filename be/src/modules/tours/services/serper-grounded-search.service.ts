import { Injectable, Logger } from '@nestjs/common';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';
import { SerperApiService } from '@integrations/serper/services/serper-api.service';
import {
  SerperApiError,
  SerperOrganicResult,
  SerperSearchRequest,
} from '@integrations/serper/interfaces/serper.interface';
import {
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundingEvidence as GroundingEvidence,
  GroundingNormalizationDecision,
} from '../interfaces/experience-grounding.interface';
import { groundingEvidenceDedupeKey } from '../utils/grounding-evidence-dedupe.util';

const PROVIDER = 'serper';
/**
 * Traditional Google web results (organic SERP). Deliberately NOT
 * "google-ai-mode": Serper has no equivalent of SerpApi's
 * engine=google_ai_mode, so this adapter never claims that capability.
 */
const MODEL = 'google-search';
/**
 * Same window as a default Google results page. Live-measured: a /search
 * call with num=10 reports `credits: 1` (Serper characterization spike,
 * 2026-09-25). Larger windows were not measured.
 */
const RESULTS_PER_SEARCH = 10;

/**
 * Grounded web search via Serper /search (Google organic results).
 *
 * A drop-in alternative to SerpApi's general `engine=google` path — NOT to
 * its `engine=google_ai_mode` semantic path, which returns a server-side
 * AI-synthesized narrative this adapter cannot and does not emulate. Only
 * organic results become evidence; answer boxes, knowledge graph and
 * people-also-ask entries are left in rawOutput, never converted.
 *
 * Selected only by an explicit GROUNDED_SEARCH_PROVIDER=serper. It never
 * falls back to (or from) SerpApi.
 */
@Injectable()
export class SerperGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(SerperGroundedSearchService.name);

  constructor(
    private readonly serper: SerperApiService,
    private readonly aiCache: AiCacheService,
  ) {}

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const providerRequest = this.buildProviderRequest(request);
    const cacheKey = this.cacheKey(request, providerRequest);
    const cacheOptions = { type: 'grounded-search', provider: PROVIDER };

    const cached = await this.aiCache.getCachedResponse(cacheKey, cacheOptions);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as GroundedSearchResult;
        if (
          parsed.provider === PROVIDER &&
          parsed.groundingStatus === 'applied' &&
          parsed.evidence.length > 0
        ) {
          return parsed;
        }
      } catch {
        this.logger.warn('Ignoring malformed cached Serper result');
      }
    }

    if (!this.serper.isConfigured()) {
      return {
        provider: PROVIDER,
        model: MODEL,
        groundingStatus: 'unavailable',
        evidence: [],
        failureReason: 'missing_serper_key',
      };
    }

    let result: GroundedSearchResult;
    try {
      const { data } = await this.serper.search(providerRequest);
      const { evidence, decisions } = this.normalizeOrganic(data.organic);
      result = {
        provider: PROVIDER,
        model: MODEL,
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        normalizationAudit: {
          mode: 'structured',
          rawItemCount: decisions.length,
          emittedEvidenceCount: evidence.length,
          decisions,
        },
        rawOutput: data,
        ...(providerRequest.gl
          ? { providerLocale: { gl: providerRequest.gl } }
          : {}),
      };
    } catch (error: unknown) {
      return this.failure(error);
    }

    if (result.groundingStatus === 'applied') {
      await this.aiCache.cacheResponse(
        cacheKey,
        JSON.stringify(result),
        cacheOptions,
      );
    }
    return result;
  }

  /**
   * Query and locale come only from facts already in the request: the
   * caller's query (or the same general fallback SerpApi's engine=google
   * path uses), and `gl` only from the resolved destination's ISO 3166-1
   * alpha-2 `destinationCountryCode` -- never from a free-text country
   * name. No `hl`/`location` are derived: a country is not a language
   * (there is no destination-language or user-locale fact here), and
   * Serper's `location` is ranking context, not a geographic boundary.
   */
  private buildProviderRequest(
    request: GroundedSearchRequest,
  ): SerperSearchRequest {
    const q =
      request.query?.trim() ||
      [
        request.destinationName,
        ...request.requestedThemes,
        'real tourism experiences',
      ].join(' ');
    const countryCode = request.destinationCountryCode?.trim();
    return {
      q,
      gl:
        countryCode && /^[a-z]{2}$/i.test(countryCode)
          ? countryCode.toLowerCase()
          : undefined,
      num: RESULTS_PER_SEARCH,
    };
  }

  /**
   * Keyed on exactly what Serper receives (plus the destination), under a
   * Serper-only namespace so a SerpApi cache entry for the same query can
   * never be served as Serper evidence, or vice versa.
   */
  private cacheKey(
    request: GroundedSearchRequest,
    providerRequest: SerperSearchRequest,
  ): string {
    return `serper-grounded-search:v1:${JSON.stringify({
      destinationName: request.destinationName,
      q: providerRequest.q,
      gl: providerRequest.gl ?? null,
      hl: providerRequest.hl ?? null,
      location: providerRequest.location ?? null,
      num: providerRequest.num ?? null,
    })}`;
  }

  private normalizeOrganic(results: SerperOrganicResult[] | undefined): {
    evidence: GroundingEvidence[];
    decisions: GroundingNormalizationDecision[];
  } {
    const evidence: GroundingEvidence[] = [];
    const decisions: GroundingNormalizationDecision[] = [];
    const seen = new Set<string>();

    for (const [index, result] of (Array.isArray(results)
      ? results
      : []
    ).entries()) {
      const sourceLocator = `organic[${index}]`;
      const snippet = result.snippet?.trim();
      if (!snippet) {
        decisions.push({
          sourceLocator,
          sourceKind: 'organic_result',
          action: 'SKIPPED',
          reason: 'EMPTY_SNIPPET',
          preview: result.title?.slice(0, 160),
        });
        continue;
      }
      const url = result.link?.trim() || undefined;
      const dedupeKey = groundingEvidenceDedupeKey(snippet, url);
      if (seen.has(dedupeKey)) {
        decisions.push({
          sourceLocator,
          sourceKind: 'organic_result',
          action: 'SKIPPED',
          reason: 'DUPLICATE_EVIDENCE',
          preview: snippet.slice(0, 160),
        });
        continue;
      }
      seen.add(dedupeKey);
      const key = `ev-${evidence.length + 1}`;
      const title = result.title?.trim() || undefined;
      evidence.push({
        key,
        source: title || url || 'google-search',
        snippet,
        title,
        url,
        kind: 'organic_result',
        order: evidence.length + 1,
      });
      decisions.push({
        sourceLocator,
        sourceKind: 'organic_result',
        action: 'EMITTED_EVIDENCE',
        evidenceKey: key,
        reason: 'ORGANIC_RESULT_EMITTED',
        preview: snippet.slice(0, 160),
      });
    }
    return { evidence, decisions };
  }

  private failure(error: unknown): GroundedSearchResult {
    if (error instanceof SerperApiError) {
      this.logger.error(`Serper grounded search failed: ${error.message}`);
      return {
        provider: PROVIDER,
        model: MODEL,
        // A key that disappears between isConfigured() and the call is
        // still "not configured", not a provider failure.
        groundingStatus:
          error.code === 'missing_api_key' ? 'unavailable' : 'failed',
        evidence: [],
        failureReason:
          error.code === 'http_error'
            ? `serper_error_${error.httpStatus}`
            : error.code === 'missing_api_key'
              ? 'missing_serper_key'
              : `serper_${error.code}`,
        rawOutput: error.responseBody,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Serper grounded search failed: ${message}`);
    return {
      provider: PROVIDER,
      model: MODEL,
      groundingStatus: 'failed',
      evidence: [],
      failureReason: message,
    };
  }
}
