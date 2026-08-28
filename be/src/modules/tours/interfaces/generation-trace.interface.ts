import { GenerationAuditResult } from '../utils/generation-audit.util';
import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import { CoverageReport } from './coverage-analysis.interface';
import { TourCompletenessResult } from './tour-completeness.interface';
import { TourFormatCoverageResult } from './tour-format-coverage.interface';
import { ProposalResolutionResponse } from './proposal-resolution.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { ExperienceFormat } from './tour-generation.interface';
import { ActivityKind } from '@prisma/client';

// Chronological pipeline steps a live tour generation actually went
// through — see docs/superpowers/specs/2026-08-20-generation-bitacora-design.md.
export type TraceStage =
  | 'tour_intent'
  | 'destination_resolution'
  | 'db_search'
  | 'coverage_analysis'
  | 'discovery'
  | 'entity_resolution'
  // PR 9: catalog + refill + newly discovery-resolved Activities merged
  // into one ranked, format-aware bounded window before llm_generation.
  | 'candidate_pool'
  // Kept so traces persisted before provider-neutral naming remain readable.
  | 'google_places_crawl'
  | 'places_crawl'
  | 'embeddings'
  | 'llm_generation'
  | 'verification'
  | 'tour_completeness'
  | 'tour_format_coverage';

// PR 7.2: does the verified, non-duplicated result actually make reasonable
// use of the requested day(s)? Independent of CoverageAnalyzer (which only
// judges the candidate pool) and of anti-hallucination verification (which
// only judges whether picks are real). `retryAttempted` records whether the
// one bounded corrective regeneration ran — see
// TourActivityGenerationService. `generationStatus` on the tour itself stays
// 'completed' even when `complete` is false here: that status means the
// generation process finished, not that every quality gate passed.
export type TourCompletenessTraceResult = TourCompletenessResult & {
  retryAttempted: boolean;
};

// PR 7.4: did the itinerary respect a requested experience format (walk,
// route, experience) when viable candidates for it existed, not just the
// requested themes? Shares the same bounded corrective retry as
// TourCompletenessTraceResult — see TourActivityGenerationService.
export type TourFormatCoverageTraceResult = TourFormatCoverageResult & {
  retryAttempted: boolean;
};

export interface TraceCandidate {
  source:
    | 'db'
    | 'google_places'
    | 'geoapify'
    | 'osm'
    | 'wikidata'
    | 'discovery';
  id: string;
  name: string;
  detail?: string;
  offered: boolean;
  chosen: boolean;
  /** PR 9 — what actually drove this candidate's rank into the offered window. */
  scoreBreakdown?: CandidateScoreBreakdown;
  /** PR 9 — which requested theme(s)/experience format this candidate contributes to, for auditing why a requested format did or didn't survive the window. */
  coverageContribution?: {
    themes: string[];
    experienceFormat?: ExperienceFormat;
  };
}

export interface GenerationTraceStep {
  stage: TraceStage;
  label: string;
  summary: string;
  candidates?: TraceCandidate[];
  placesProvenance?: PlacesCrawlProvenance;
  providerStatus?: 'success' | 'failed';
  degradedReason?: string;
  semanticRanking?: {
    status: 'not_requested' | 'applied' | 'unavailable';
    eligibleCandidateCount: number;
    indexedCandidateCount: number;
    offeredCandidateCount: number;
    provider?: string;
    model?: string;
    dimensions?: number;
    documentVersion?: number;
    reason?: string;
  };
  coverageReport?: CoverageReport;
  grounding?: {
    status: 'applied' | 'unavailable' | 'failed' | 'no_usable_evidence';
    provider?: string;
    model?: string;
    evidenceCount?: number;
    reason?: string;
  };
  tourCompleteness?: TourCompletenessTraceResult;
  tourFormatCoverage?: TourFormatCoverageTraceResult;
  resolution?: ProposalResolutionResponse;
  /** PR 9 — pre-LLM auditability: full pool -> offered window, by kind/source/requested-format. Paired with the existing tour_format_coverage step (post-LLM: window -> selected) to distinguish a window-construction bug from a selection bug from an acquisition/coverage problem, without duplicating selectedCount tracking in two places. */
  candidatePool?: {
    initialCatalogCount: number;
    postAcquisitionCatalogCount: number;
    eligibleCount: number;
    llmWindowCount: number;
    byKind: Partial<Record<ActivityKind, number>>;
    bySource: { catalog: number; refill: number; discovery: number };
    requestedFormatAvailability: Array<{
      format: ExperienceFormat;
      fullPoolCount: number;
      llmWindowCount: number;
    }>;
    droppedForFamilyCapCount: number;
  };
}

export interface GenerationTrace {
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: GenerationAuditResult;
  tourCompleteness?: TourCompletenessTraceResult;
  tourFormatCoverage?: TourFormatCoverageTraceResult;
}
