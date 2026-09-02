import { GenerationAuditResult } from '../utils/generation-audit.util';
import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import { CoverageReport } from './coverage-analysis.interface';
import { TourCompletenessResult } from './tour-completeness.interface';
import { ExperienceResolutionResponse } from './experience-resolution.interface';
import { GeographicValidationBatchResult } from './geographic-validation.interface';
import { ExperienceGeographicValidationBatchResult } from './experience-resolution.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { ActivityKind } from '@prisma/client';
import { PreferenceInterpretationTrace } from './preference-interpretation.interface';

export type TraceStage =
  | 'preference_interpretation'
  | 'tour_intent'
  | 'destination_resolution'
  | 'db_search'
  | 'coverage_analysis'
  | 'discovery'
  | 'entity_resolution'
  | 'geographic_validation'
  | 'catalog_materialization'
  | 'candidate_pool'
  | 'daily_planning'
  | 'google_places_crawl'
  | 'places_crawl'
  | 'embeddings'
  | 'llm_generation'
  | 'verification'
  | 'tour_completeness'
  | 'tour_format_coverage';

export type TraceRuleResult = 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED';
export type TraceDecisionStatus = 'PASS' | 'FAIL' | 'WARN' | 'INFO';
export type TraceCandidateStatus =
  | 'ELIGIBLE'
  | 'REJECTED'
  | 'RANKED'
  | 'SELECTED'
  | 'UNSELECTED';

/**
 * GenerationTrace V2 is an audit contract, not UI copy. The backend records
 * facts and decisions made by the engine; the frontend renders them without
 * inventing motivations or reverse-engineering domain rules.
 */
export interface TraceRuleEvaluation {
  ruleId: string;
  rule: string;
  result: TraceRuleResult;
  reason: string;
  inputs?: Record<string, unknown>;
  expected?: unknown;
  actual?: unknown;
}

export interface TraceDecision {
  status: TraceDecisionStatus;
  outcome: string;
  reason: string;
  reasonCodes?: string[];
  triggeredActions?: string[];
}

export interface TraceTiming {
  startedAt?: string;
  durationMs?: number;
}

export interface TraceCandidateDecision {
  id: string;
  name: string;
  source?: string;
  status: TraceCandidateStatus;
  reason?: string;
  reasonCodes?: string[];
  scoreBreakdown?: CandidateScoreBreakdown;
  rules?: TraceRuleEvaluation[];
  dayNumber?: number;
  order?: number;
}

export type TourCompletenessTraceResult = TourCompletenessResult & {
  retryAttempted: boolean;
};


/** Legacy candidate shape kept so old persisted traces remain readable. */
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
  scoreBreakdown?: CandidateScoreBreakdown;
  coverageContribution?: {
    themes: string[];
    experienceFormat?: string;
  };
}

export interface GenerationTraceStep {
  stage: TraceStage;
  label: string;
  summary: string;

  /** V2 auditable fields. */
  component?: string;
  status?: TraceDecisionStatus;
  inputs?: Record<string, unknown>;
  rules?: TraceRuleEvaluation[];
  decision?: TraceDecision;
  outputs?: Record<string, unknown>;
  candidateDecisions?: TraceCandidateDecision[];
  timing?: TraceTiming;
  /** Full redacted LLM audit for preference interpretation. */
  preferenceInterpretation?: PreferenceInterpretationTrace;

  /** Legacy/rich stage-specific data retained for compatibility and raw view. */
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
  resolution?: ExperienceResolutionResponse;
  geographicValidation?: GeographicValidationBatchResult | ExperienceGeographicValidationBatchResult;
  materialization?: unknown;
  candidatePool?: {
    initialCatalogCount: number;
    postAcquisitionCatalogCount: number;
    eligibleCount: number;
    llmWindowCount: number;
    byKind: Partial<Record<ActivityKind, number>>;
    bySource: { catalog: number; refill: number; discovery: number };
    requestedFormatAvailability: Array<{
      format: string;
      fullPoolCount: number;
      llmWindowCount: number;
    }>;
    droppedForFamilyCapCount: number;
  };
  dailyPlanning?: {
    solver: string;
    dayCount: number;
    selectedCount: number;
    unselectedCount: number;
    approximateTravel: boolean;
    iterations?: number;
    score: number;
    days: Array<{
      dayNumber: number;
      activityCount: number;
      totalActivityMinutes: number;
      totalTravelMinutes: number;
      totalWalkingMinutes: number;
      utilizationMinutes: number;
    }>;
  };
}

export interface GenerationTrace {
  /** Version 1 traces omitted this field. */
  version?: 1 | 2;
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: GenerationAuditResult;
  tourCompleteness?: TourCompletenessTraceResult;
  /** Human-readable, persisted decision narrative for the Bitácora UI. */
  executionSummary?: {
    status: 'completed' | 'failed';
    steps: string[];
    acceptedExperiences?: number;
    rejectedProposals?: number;
    selectedExperiences?: number;
    failure?: string;
  };
}
