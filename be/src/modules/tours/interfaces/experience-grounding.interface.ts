/** Search evidence contract used by Experience Domain V2. */
export interface ExperienceGroundedSearchRequest {
  destinationName: string;
  destinationCountry?: string;
  requestedThemes: string[];
  additionalPreferences?: string;
  query: string;
  /**
   * Soft Experience facets (walk, route_like, day_trip, visit, food — see
   * TourIntentDto.intents), structured rather than folded into `query`'s
   * flat keyword join. Providers that need to react to a specific facet
   * (e.g. TavilyGroundedSearchService phrasing a walk/route request
   * differently — verified live: "caminatas" alone reads as
   * hiking/trekking in Spanish, "icónicas" disambiguates to urban walking
   * routes) should read this instead of string-sniffing `query`. Optional
   * and currently read only by Tavily — every other provider's behavior is
   * unchanged by its presence.
   */
  requestedIntents?: string[];
  /**
   * Task B5 — every relevant area/route anchor name for a walk/route_like
   * request (e.g. ["San Telmo"] or ["San Telmo", "La Boca"]), threaded
   * through from WebSourcePlanPayload.anchorNames. Read only by Tavily's
   * walk-query phrasing; every other provider's behavior is unchanged.
   */
  anchorNames?: string[];
}

export interface ExperienceGroundingEvidence {
  key: string;
  source: string;
  snippet: string;
  title?: string;
  url?: string;
}

export type ExperienceGroundingStatus =
  | 'applied'
  | 'unavailable'
  | 'failed'
  | 'no_usable_evidence';

/**
 * Per-evidence forensic detail beyond what ExperienceGroundingEvidence itself
 * carries. Populated by two providers, for two different reasons:
 * GeminiGroundedSearchService, whose evidence text can come from two
 * genuinely different places (see its own doc comment) — Tavily's /extract
 * recovering the real source page (evidenceQuality: 'original_content'), or a
 * segment of Gemini's own model_output when extraction wasn't possible
 * (evidenceQuality: 'reduced'); and TavilyGroundedSearchService, which
 * replaces its own short relevance snippet with the full article (also
 * 'original_content') for the top-scored handful of results only — a plain
 * snippet rarely contains a walking route's actual stop-by-stop detail.
 * Nested under the discovery step's per-query searchTrace entry in the
 * generation trace (GenerationTraceStep.inputs.searchTrace[i]), not a
 * separate TraceStage — see generation-trace-builder.util.ts's
 * buildDiscoveryStep().
 */
export interface ExperienceEvidenceProvenance {
  provider: string;
  searchQueries: string[];
  url?: string;
  title?: string;
  extractionProvider: 'tavily' | 'gemini-model-output';
  extractionStatus: 'success' | 'fallback';
  evidenceQuality: 'original_content' | 'reduced';
  evidenceKeys: string[];
  groundingSupportIndices?: number[];
}

export interface ExperienceGroundedSearchResult {
  provider: string;
  model: string;
  groundingStatus: ExperienceGroundingStatus;
  evidence: ExperienceGroundingEvidence[];
  textBlocks?: Array<{ text: string; evidenceKeys: string[] }>;
  evidenceProvenance?: ExperienceEvidenceProvenance[];
  rawOutput?: unknown;
  failureReason?: string;
}

export interface ExperienceGroundedSearchProvider {
  search(
    request: ExperienceGroundedSearchRequest,
  ): Promise<ExperienceGroundedSearchResult>;
}

export const EXPERIENCE_GROUNDED_SEARCH_PROVIDER =
  'EXPERIENCE_GROUNDED_SEARCH_PROVIDER';
