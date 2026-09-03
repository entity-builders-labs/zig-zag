import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import { CoverageReport } from './coverage-analysis.interface';
import { TourCompletenessResult } from './tour-completeness.interface';
import { ExperienceResolutionResponse } from './experience-resolution.interface';
import { GeographicValidationBatchResult } from './geographic-validation.interface';
import { ExperienceGeographicValidationBatchResult } from './experience-resolution.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
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
  | 'tour_experience_materialization'
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
 * GenerationTrace is an audit contract, not UI copy. The backend records
 * facts and decisions made by the engine; the frontend renders them without
 * inventing motivations or reverse-engineering domain rules.
 *
 * V3 adds the canonical redacted request, structured execution summary,
 * routing evidence and TourExperience materialization snapshots. V1/V2 remain
 * readable because traces are persisted historical data.
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

export interface TraceCandidate {
  source: string;
  id?: string;
  name: string;
  detail?: string;
  offered?: boolean;
  chosen?: boolean;
  scoreBreakdown?: CandidateScoreBreakdown;
  coverageContribution?: Record<string, unknown>;
}

export interface TraceCandidateDecision {
  id: string;
  name: string;
  source?: string;
  status: TraceCandidateStatus;
  reason: string;
  reasonCodes: string[];
  scoreBreakdown?: CandidateScoreBreakdown;
  dayNumber?: number;
  order?: number;
}

export interface GenerationExecutionStageSummary {
  ordinal: number;
  stage: TraceStage;
  status: TraceDecisionStatus | TraceRuleResult;
  component?: string;
  outcome?: string;
  summary: string;
  counts?: Record<string, number>;
}

export interface GenerationTraceExecutionSummary {
  status: 'completed' | 'failed';
  orderedStages: GenerationExecutionStageSummary[];
  steps: string[];
  narrative: string;
  acceptedExperiences?: number;
  rejectedProposals?: number;
  selectedExperiences?: number;
  failure?: string;
}

export interface MaterializedTourExperienceTrace {
  experienceId: string;
  dayNumber?: number;
  order: number;
  startTime?: string;
  durationHours?: number;
  componentCount: number;
}

export interface GenerationTraceStep {
  stage: TraceStage;
  label: string;
  summary: string;
  component?: string;
  status?: TraceDecisionStatus | TraceRuleResult;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  rules?: TraceRuleEvaluation[];
  decision?: TraceDecision;
  candidates?: TraceCandidate[];
  candidateDecisions?: TraceCandidateDecision[];
  timing?: TraceTiming;
  providerStatus?: 'success' | 'degraded' | 'failed';
  degradedReason?: string;
  coverageReport?: CoverageReport;
  resolution?: ExperienceResolutionResponse;
  geographicValidation?:
    | GeographicValidationBatchResult
    | ExperienceGeographicValidationBatchResult;
  preferenceInterpretation?: PreferenceInterpretationTrace;
  candidatePool?: {
    initialCatalogCount: number;
    postAcquisitionCatalogCount: number;
    eligibleCount: number;
    llmWindowCount: number;
    bySource: Record<string, number>;
  };
  dailyPlanning?: {
    solver: string;
    dayCount: number;
    selectedCount: number;
    unselectedCount: number;
    approximateTravel: boolean;
    iterations?: number;
    score: number;
    routing?: {
      externalEstimateCount: number;
      internalEstimateCount: number;
      approximateEstimateCount: number;
      fallbackCount: number;
      providerCounts: Record<string, number>;
    };
    days: Array<{
      dayNumber: number;
      experienceCount: number;
      totalExperienceMinutes: number;
      totalTravelMinutes: number;
      totalWalkingMinutes: number;
      utilizationMinutes: number;
    }>;
  };
  placesCrawl?: PlacesCrawlProvenance;
  materialization?: unknown;
  discovery?: unknown;
  embedding?: unknown;
  verification?: unknown;
  legacy?: Record<string, unknown>;
}

export interface GenerationTrace {
  version?: 1 | 2 | 3;
  canonicalRequest?: unknown;
  steps: GenerationTraceStep[];
  tourCompleteness?: TourCompletenessResult & { retryAttempted?: boolean };
  hallucinatedCount?: number;
  duplicateCount?: number;
  materializedTourExperiences?: MaterializedTourExperienceTrace[];
  executionSummary?: GenerationTraceExecutionSummary;
}
