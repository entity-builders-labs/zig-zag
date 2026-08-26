import { GenerationAuditResult } from '../utils/generation-audit.util';
import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import { CoverageReport } from './coverage-analysis.interface';
import { TourCompletenessResult } from './tour-completeness.interface';
import { TourFormatCoverageResult } from './tour-format-coverage.interface';
import { ProposalResolutionResponse } from './proposal-resolution.interface';

// Chronological pipeline steps a live tour generation actually went
// through — see docs/superpowers/specs/2026-08-20-generation-bitacora-design.md.
export type TraceStage =
  | 'tour_intent'
  | 'destination_resolution'
  | 'db_search'
  | 'coverage_analysis'
  | 'discovery'
  | 'entity_resolution'
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
