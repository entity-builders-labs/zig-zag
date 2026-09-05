/** Search evidence contract used by Experience Domain V2. */
export interface ExperienceGroundedSearchRequest {
  destinationName: string;
  destinationCountry?: string;
  requestedThemes: string[];
  additionalPreferences?: string;
  query: string;
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
 * carries — currently only populated by GeminiGroundedSearchService, whose
 * evidence text can come from two genuinely different places (see its own
 * doc comment): Tavily's /extract recovering the real source page (
 * evidenceQuality: 'original_content'), or a segment of Gemini's own
 * model_output when extraction wasn't possible (evidenceQuality: 'reduced').
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
