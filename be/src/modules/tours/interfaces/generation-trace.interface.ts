import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import { TourCompletenessResult } from './tour-completeness.interface';
import { ExperienceCandidate } from './experience-discovery.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { PreferenceInterpretationTrace } from './preference-interpretation.interface';
import { GeoEntityHint } from './experience-discovery.interface';
import { ResolvedGeoEntity } from './experience-resolution.interface';
import { AcquisitionEvidenceRequirement } from './acquisition-evidence-requirement.interface';

export type TraceStage =
  | 'preference_interpretation'
  | 'tour_intent'
  | 'destination_resolution'
  | 'db_search'
  | 'coverage_analysis'
  | 'acquisition_strategy'
  | 'area_route_walk_acquisition'
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

/** Machine-readable forensic record for one preference-first acquisition pass. */
export interface TraceAcquisitionSource {
  provider: string;
  configuration: Record<string, string | string[] | undefined>;
  status: 'success' | 'failed' | 'skipped' | 'unknown';
  failureReason?: string;
  observationCount: number;
  observations: Array<{
    evidenceKey: string;
    provider: string;
    title: string;
    description?: string;
    sourceUrl?: string;
    evidenceType?: string;
    originationCapabilities: AcquisitionEvidenceRequirement[];
    externalId?: string;
    geo?: {
      latitude?: number;
      longitude?: number;
      geometry?: { present: boolean; type?: string };
    };
  }>;
  web?: {
    query: string;
    anchorNames?: string[];
    requestedThemes?: string[];
    requestedIntents?: string[];
    preferredTraits?: string[];
    semanticQuery?: string;
    groundedProvider?: string;
    groundedModel?: string;
    groundingStatus?: string;
    evidence: TraceEvidenceReference[];
    extractor?: {
      provider?: string;
      model?: string;
      inputEvidenceKeys: string[];
      validationErrors: string[];
      candidateCount: number;
    };
  };
}

export interface TraceEvidenceReference {
  evidenceKey: string;
  source: string;
  title?: string;
  url?: string;
  snippet?: string;
}

export interface TraceComponentHint {
  key: string;
  name: string;
  role: GeoEntityHint['role'];
  required: boolean;
  order?: number;
  evidenceKeys: string[];
}

export interface TraceAcquisitionCandidate {
  traceKey: string;
  name: string;
  origin: 'structured' | 'web' | 'mixed';
  providers: string[];
  themes: string[];
  intents: string[];
  evidenceKeys: string[];
  suggestedDurationMinutes?: number;
  orderedByEvidence?: boolean;
  componentHints: TraceComponentHint[];
}

export interface TraceEntityResolutionDecision {
  candidateTraceKey: string;
  candidateName: string;
  hints: Array<
    TraceComponentHint & {
      status: 'resolved' | 'unresolved' | 'ambiguous';
      resolvedGeoEntity?: Pick<
        ResolvedGeoEntity,
        | 'geoEntityId'
        | 'canonicalName'
        | 'provider'
        | 'externalId'
        | 'latitude'
        | 'longitude'
      > & { geometry?: { present: boolean; type?: string } };
      reason?: string;
    }
  >;
  accepted: boolean;
  rejectionReasons: string[];
}

export interface TraceGeographicValidationDecision {
  candidateTraceKey: string;
  candidateName: string;
  accepted: boolean;
  status: string;
  strategy?: string;
  scope?: { kind: string; anchorName?: string; geoEntityId?: string };
  groundedEvidenceKeys: string[];
  rejectionReasons: string[];
  components: Array<{
    hintName: string;
    hintKey?: string;
    role?: string;
    resolvedGeoEntityId?: string;
    relation?: 'accepted' | 'offending' | 'evaluated';
  }>;
}

export interface TraceAcquisitionAudit {
  passNumber: number;
  acquisitionContext?: TraceAcquisitionContext;
  deficits: Array<{
    origin?: string;
    dimension?: string;
    key?: string;
    reason: string;
  }>;
  sourcePlans: TraceAcquisitionSource[];
  evidence: TraceEvidenceReference[];
  candidates: TraceAcquisitionCandidate[];
  entityResolution?: TraceEntityResolutionDecision[];
  geographicValidation?: TraceGeographicValidationDecision[];
  materialization?: Array<{
    candidateTraceKey: string;
    candidateName: string;
    accepted: boolean;
    rejectionReasons: string[];
    experienceId?: string;
    canonicalName?: string;
    persistedComponentCount?: number;
  }>;
}

/** Identifies the orchestration strategy that produced a lifecycle step. */
export interface TraceAcquisitionContext {
  strategy: 'generic' | 'area_route_walk';
  passNumber: number;
  anchor?: {
    rawName: string;
    kind: 'venue' | 'area' | 'route' | 'unknown';
    priority: 'soft' | 'must';
  };
}

/** Bounded legacy payloads retained for V1/V2/V3 trace readers. */
export interface TraceResolvedGeoEntity {
  hintKey: string;
  hintName: string;
  provider: string;
  externalId?: string;
  geoEntityId?: string;
  canonicalName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: { present: boolean; type?: string };
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType?: string;
  status: 'resolved' | 'unresolved';
  reason?: string;
  adminContext?: {
    country?: string;
    region?: string;
    locality?: string;
    municipality?: string;
  };
}

export interface TraceResolvedExperienceCandidate {
  candidate: ExperienceCandidate;
  status: 'accepted' | 'rejected';
  resolvedEntities: TraceResolvedGeoEntity[];
  rejectionReasons: string[];
  destinationAssociationVerified?: boolean;
  experienceId?: string;
  dedupeDecision?: 'SAME' | 'NEW' | 'AMBIGUOUS';
  dedupeCandidates?: string[];
}

export interface TraceResolutionPayload {
  totalCandidates: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: TraceResolvedExperienceCandidate[];
  entityResolution?: {
    totalCandidates: number;
    acceptedCount: number;
    rejectedCount: number;
    resolved: TraceResolvedExperienceCandidate[];
  };
}

export interface TraceGeographicValidationResult {
  proposalName: string;
  kind: string;
  status: string;
  accepted: boolean;
  strategy?: string;
  canonicalEntity?: TraceResolvedGeoEntity;
  anchors: TraceResolvedGeoEntity[];
  coherence?: {
    centroid: { latitude: number; longitude: number };
    radiusMeters: number;
    maxPairwiseDistanceMeters: number;
  };
  groundedEvidenceKeys: string[];
  rejectionReasons: string[];
  decisionEntities?: Array<{
    geoEntityId?: string;
    hintKey?: string;
    relation: 'evaluated' | 'offending';
  }>;
  validatorVersion: number;
}

export interface TraceGeographicValidationPayload {
  results: TraceGeographicValidationResult[];
  acceptedCount: number;
  rejectedCount: number;
  resolved?: TraceResolvedExperienceCandidate[];
}

export interface TraceMaterializationPayload {
  resolved: TraceResolvedExperienceCandidate[];
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
  /** Native v4 acquisition audit; facts only, never a policy authority. */
  acquisition?: TraceAcquisitionAudit;
  acquisitionContext?: TraceAcquisitionContext;
  entityResolutionAudit?: TraceEntityResolutionDecision[];
  geographicValidationAudit?: TraceGeographicValidationDecision[];
  materializationAudit?: TraceAcquisitionAudit['materialization'];
  classificationAudit?: Array<{
    experienceId: string;
    state: 'classified' | 'degraded' | 'reused';
    provider?: string;
    model?: string;
    promptVersion?: number;
    themes: string[];
    intents: string[];
    traits: string[];
    reasoningEvidence: Array<{
      facet: string;
      evidenceKeys: string[];
      reason: string;
    }>;
  }>;

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
  grounding?: {
    status: 'applied' | 'unavailable' | 'failed' | 'no_usable_evidence';
    provider?: string;
    model?: string;
    evidenceCount?: number;
    reason?: string;
  };
  tourCompleteness?: TourCompletenessTraceResult;
  resolution?: TraceResolutionPayload;
  geographicValidation?: TraceGeographicValidationPayload;
  materialization?: TraceMaterializationPayload;
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
    residualCapacity?: Array<{
      dayNumber: number;
      availableMinutes: number;
      meaningful: boolean;
    }>;
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
  /** Version 1-3 traces remain readable; V4 is the native preference-first trace. */
  version?: 1 | 2 | 3 | 4;
  /** Non-secret build identity supplied by the deployment/run harness. */
  runtime?: {
    buildCommit?: string;
    buildTimestamp?: string;
  };
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
