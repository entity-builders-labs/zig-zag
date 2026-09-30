/** Search evidence contract used by Experience Domain V2. */
export interface ExperienceGroundedSearchRequest {
  destinationName: string;
  /** Human-readable country name; never a provider locale parameter. */
  destinationCountry?: string;
  /**
   * ISO 3166-1 alpha-2 code of the resolved destination's country, exactly
   * as `DestinationResolutionService` produced it (e.g. "AR") -- never
   * re-inferred downstream. Providers may map it to their own country
   * parameter (Serper `gl`); it says nothing about language.
   */
  destinationCountryCode?: string;
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
  kind?: ExperienceGroundingEvidenceKind;
  order?: number;
  contextHeading?: string;
  evidenceQuality?: 'original_content' | 'reduced';
}

/**
 * Canonical evidence snapshot captured at grounded-search completion and
 * preserved in runtime trace artifacts for exact forensic reconstruction.
 * Guarantees rank order and exact snippet text received before extraction.
 */
export interface GroundedSearchEvidenceRecord {
  key: string;
  order: number;
  snippet: string;
  source: string;
  title?: string;
  url?: string;
  kind?: ExperienceGroundingEvidenceKind;
  contextHeading?: string;
  evidenceQuality?: 'original_content' | 'reduced';
}

export type ExperienceGroundingEvidenceKind =
  | 'narrative_paragraph'
  | 'list_item'
  | 'reference'
  | 'organic_result';

export type GroundingNormalizationAction =
  | 'EMITTED_EVIDENCE'
  | 'CONTEXT_ONLY'
  | 'SKIPPED';

export interface GroundingNormalizationDecision {
  sourceLocator: string;
  sourceKind:
    | 'heading'
    | 'paragraph'
    | 'list_item'
    | 'reference'
    | 'organic_result';
  action: GroundingNormalizationAction;
  evidenceKey?: string;
  reason:
    | 'PARAGRAPH_EMITTED'
    | 'LIST_ITEM_EMITTED'
    | 'REFERENCE_EMITTED'
    | 'ORGANIC_RESULT_EMITTED'
    | 'HEADING_CONTEXT_ONLY'
    | 'EMPTY_SNIPPET'
    | 'DUPLICATE_EVIDENCE'
    | 'UNSUPPORTED_SOURCE_ITEM';
  preview?: string;
}

export interface GroundingNormalizationAudit {
  mode: 'structured' | 'salvage';
  rawItemCount: number;
  emittedEvidenceCount: number;
  decisions: GroundingNormalizationDecision[];
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
 * Nested under discovery / acquisition search facts in the
 * generation trace — see experience-generation-trace.util.ts.
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
  normalizationAudit?: GroundingNormalizationAudit;
  evidenceProvenance?: ExperienceEvidenceProvenance[];
  rawOutput?: unknown;
  failureReason?: string;
  /**
   * The locale parameters the provider actually sent, echoed for provenance
   * (e.g. Serper `{ gl: 'ar' }`). Absent when none were sent.
   */
  providerLocale?: { gl?: string; hl?: string };
}

export interface ExperienceGroundedSearchProvider {
  search(
    request: ExperienceGroundedSearchRequest,
  ): Promise<ExperienceGroundedSearchResult>;
}

export const EXPERIENCE_GROUNDED_SEARCH_PROVIDER =
  'EXPERIENCE_GROUNDED_SEARCH_PROVIDER';
