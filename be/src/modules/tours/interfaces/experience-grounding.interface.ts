/** Search evidence contract used by Experience Domain V2. */
export interface ExperienceGroundedSearchRequest {
  destinationName: string;
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

export interface ExperienceGroundedSearchResult {
  provider: string;
  model: string;
  groundingStatus: ExperienceGroundingStatus;
  evidence: ExperienceGroundingEvidence[];
  textBlocks?: Array<{ text: string; evidenceKeys: string[] }>;
  rawOutput?: unknown;
  failureReason?: string;
}

export interface ExperienceGroundedSearchProvider {
  search(request: ExperienceGroundedSearchRequest): Promise<ExperienceGroundedSearchResult>;
}

export const EXPERIENCE_GROUNDED_SEARCH_PROVIDER = 'EXPERIENCE_GROUNDED_SEARCH_PROVIDER';
