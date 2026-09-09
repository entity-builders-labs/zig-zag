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

  /** Stage-specific evidence retained for audit and UI rendering. */
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
  geographicValidation?:
    | GeographicValidationBatchResult
    | ExperienceGeographicValidationBatchResult;
  materialization?: unknown;
  candidatePool?: {
    initialCatalogCount: number;
    postAcquisitionCatalogCount: number;
    eligibleCount: number;
    llmWindowCount: number;
    bySource: { catalog: number; refill: number; discovery: number };
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
}

export interface GenerationExecutionStageSummary {
  ordinal: number;
  stage: TraceStage | 'tour_experience_materialization';
  status: TraceDecisionStatus;
  component?: string;
  outcome?: string;
  summary: string;
  counts?: Record<string, number>;
}

export interface GenerationTraceAcquisitionSummary {
  /** Bounded multi-source acquisition passes that actually ran (0 = catalog-first). */
  passes: number;
  providersAttempted: string[];
  providersFailed: string[];
  observationCount: number;
  structuredCandidateCount: number;
  webCandidateCount: number;
  /** True when the planned itinerary used at least one approximate travel leg. */
  approximateRouting?: boolean;
}

export interface GenerationTraceExecutionSummary {
  status: 'completed' | 'failed';
  /** Ordered machine-readable reconstruction of the complete run. */
  orderedStages: GenerationExecutionStageSummary[];
  /** Compatibility text retained for existing Bitácora UI versions. */
  steps: string[];
  narrative?: string;
  acceptedExperiences?: number;
  rejectedProposals?: number;
  selectedExperiences?: number;
  /**
   * Roll-up of the canonical multi-source acquisition loop — answers "which
   * sources ran, how many passes, how much did they produce" without walking
   * every stage. Absent when acquisition never ran (catalog-first).
   */
  acquisition?: GenerationTraceAcquisitionSummary;
  failure?: string;
}

export interface MaterializedTourExperienceTrace {
  experienceId: string;
  dayNumber: number;
  order: number;
  startTime?: string;
  durationHours: number;
  componentCount: number;
}

export interface GenerationTrace {
  /** Version 1 traces omitted this field; V3 is the canonical V2-domain trace. */
  version?: 1 | 2 | 3;
  /** Redacted canonical request exactly as consumed by deterministic generation. */
  canonicalRequest?: Record<string, unknown>;
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  tourCompleteness?: TourCompletenessTraceResult;
  /** Final persisted TourExperience snapshots, not planner proposals. */
  materializedTourExperiences?: MaterializedTourExperienceTrace[];
  executionSummary?: GenerationTraceExecutionSummary;
}
