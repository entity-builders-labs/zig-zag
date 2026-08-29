import { ActivityKind } from '@prisma/client';
import { CoverageDeficit } from './coverage-analysis.interface';

// ── Proposal kinds ──────────────────────────────────────────────────

export type ProposalKind =
  | 'POI'
  | 'ROUTE'
  | 'AREA'
  | 'NEIGHBORHOOD_WALK'
  | 'EXPERIENCE';

// ── Entity hints ───────────────────────────────────────────────────

export interface EntityHint {
  key: string;
  name: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType: string;
  /** Whether this hint must be resolvable for the proposal to be accepted. */
  required: boolean;
  /**
   * Keys into the provider-owned GroundingEvidence map that support this
   * specific entity (or its relationship to the proposed activity/area) —
   * distinct from ActivityProposal.evidenceKeys, which only supports the
   * overall concept. Never fabricated by the LLM.
   */
  evidenceKeys: string[];
}

// ── Grounding evidence (provider-owned) ────────────────────────────

export interface GroundingEvidence {
  key: string;
  source: string;
  snippet: string;
  /** Item's own title/heading, when the provider supplies one — scanned
   * alongside snippet by ROUTE evidence extraction (route names often
   * appear in a heading before the descriptive snippet). */
  title?: string;
  url?: string;
}

/**
 * A provider's own running narrative text (e.g. SerpApi google_ai_mode's
 * text_blocks), distinct from the structured GroundingEvidence[] list used
 * for NEIGHBORHOOD_WALK/EXPERIENCE/AREA extraction. Only ROUTE's
 * evidence-aware extraction reads this — a route name can appear anywhere
 * in prose rather than in a predictable structured field.
 */
export interface GroundedTextBlock {
  text: string;
  evidenceKeys: string[];
}

// ── Activity proposal ──────────────────────────────────────────────

export interface ActivityProposal {
  name: string;
  kind: ProposalKind;
  themes: string[];
  entityHints: EntityHint[];
  suggestedDurationMinutes: number;
  shortReason: string;
  /** Keys into the provider-owned GroundingEvidence map. Never fabricated by the LLM. */
  evidenceKeys: string[];
}

// ── Discovery mode ─────────────────────────────────────────────────

export type DiscoveryMode =
  | { type: 'bootstrap'; reason: 'new_destination' }
  | { type: 'stale_refresh'; reason: 'profile_stale' }
  | { type: 'gap_fill'; deficits: CoverageDeficit[] };

// ── Grounded search contracts ──────────────────────────────────────

export interface GroundedSearchRequest {
  destinationName: string;
  destinationCountry?: string;
  requestedThemes: string[];
  requestedExperienceFormats?: string[];
  explorationStyle?: string;
  additionalPreferences?: string;
  /**
   * A deterministic semantic query built by SemanticDiscoveryQueryBuilder
   * for one missing ActivityKind. When present, SerpApiGroundedSearchService
   * uses it verbatim on the semantic path (engine=google_ai_mode) instead of
   * building its own keyword-concat query. Empty/unset falls back to the
   * legacy general path (engine=google).
   */
  query: string;
  /** Which ActivityKind this search call targets, when issued from the
   * semantic path — used for evidence tagging/traceability and to decide
   * whether ROUTE evidence extraction should run over this call's result. */
  targetKind?: ActivityKind;
}

export type GroundingStatus =
  | 'applied'
  | 'unavailable'
  | 'failed'
  | 'no_usable_evidence';

export interface GroundedSearchResult {
  provider: string;
  model: string;
  groundingStatus: GroundingStatus;
  evidence: GroundingEvidence[];
  /** Populated on the semantic (google_ai_mode) path only — the provider's
   * own running narrative text, read by ROUTE evidence extraction. */
  textBlocks?: GroundedTextBlock[];
  rawOutput?: unknown;
  failureReason?: string;
}

export interface GroundedSearchProvider {
  search(request: GroundedSearchRequest): Promise<GroundedSearchResult>;
}

// ── Discovery request ──────────────────────────────────────────────

export interface DiscoveryRequest {
  destinationName: string;
  destinationCountry?: string;
  requestedThemes: string[];
  /** Experience formats explicitly requested by the user (neighborhood_walk, route, etc.). */
  requestedExperienceFormats?: string[];
  /** e.g. "balanced", "deep_dive", "quick_highlights". */
  explorationStyle?: string;
  /** Free-text additional preferences from the user. */
  additionalPreferences?: string;
  mode: DiscoveryMode;
  maxProposals: number;
}

// ── Discovery response ─────────────────────────────────────────────

export interface DiscoveryResponse {
  proposals: ActivityProposal[];
  provider: string;
  model: string;
  /** Grounding provenance: was real search executed? */
  groundingStatus: GroundingStatus;
  /** Provider that executed the search (may differ from structural extraction provider). */
  groundingProvider?: string;
  groundingModel?: string;
  /** Provider-owned evidence referenced by proposal.evidenceKeys. */
  groundingEvidence?: GroundingEvidence[];
  rawOutput?: string;
  validationErrors?: string[];
}

// ── Provider-neutral interfaces ────────────────────────────────────

export const DISCOVERY_PROVIDER = 'DISCOVERY_PROVIDER';
export const GROUNDED_SEARCH_PROVIDER = 'GROUNDED_SEARCH_PROVIDER';

export interface SearchGroundedDiscoveryProvider {
  discover(
    request: DiscoveryRequest,
    searchResult?: GroundedSearchResult,
  ): Promise<DiscoveryResponse>;
}
