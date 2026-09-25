import { TourCompletenessResult } from './tour-completeness.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { PreferenceInterpretationTrace } from './preference-interpretation.interface';
import { GeoEntityHint } from './experience-discovery.interface';
import {
  ResolvedGeoEntity,
  IdentityEvidence,
  ResolutionStrategy,
  VerificationDecision,
} from './experience-resolution.interface';
import { AcquisitionEvidenceRequirement } from './acquisition-evidence-requirement.interface';
import { AreaScopeMembershipAudit } from './area-scope-membership.interface';
import { GeographicDecisionReason } from './geographic-validation.interface';
import { CandidateSourceSupportAudit } from '../utils/experience-candidate-extraction.util';

export type TraceStage =
  | 'preference_interpretation'
  | 'anchor_geo_resolution'
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
  /**
   * Logical source-plan/capability discriminator the planner routed this
   * deficit to (e.g. `google_places` names the Places CAPABILITY route, not
   * necessarily the Google backend). Never treat this as proof of which real
   * `IPlacesApiService` backend answered the request — see `runtimeProviders`.
   */
  provider: string;
  configuration: Record<string, string | string[] | undefined>;
  status: 'success' | 'failed' | 'skipped' | 'unknown';
  failureReason?: string;
  observationCount: number;
  /**
   * The real runtime provider(s) that actually produced this source's
   * observations, taken from each `SourceObservation.provider` (itself
   * sourced from `result.provenance.provider` at the adapter boundary) —
   * never inferred from the logical `provider` discriminator above. For a
   * Places capability this distinguishes an actual Google response from an
   * actual Geoapify response, which `provider` alone cannot.
   */
  runtimeProviders: string[];
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
    /** Resolved destination country the grounded request carried. */
    destinationCountryCode?: string;
    /** Locale parameters the grounded provider actually sent (e.g. gl). */
    groundedProviderLocale?: { gl?: string; hl?: string };
    evidence: TraceEvidenceReference[];
    extractor?: {
      provider?: string;
      model?: string;
      inputEvidenceKeys: string[];
      validationErrors: string[];
      extractedCandidateCount: number;
      admittedCandidateCount: number;
      rejectedCandidateCount: number;
      candidateDecisions: TraceWebCandidateAdmissionDecision[];
      /**
       * Source-composition-authority audit per raw extracted candidate (see
       * `CandidateSourceSupportAudit`). A SOURCE_CONTRACT_VIOLATION entry
       * here never reached `candidateDecisions` -- it is not an identity
       * rejection (never `NO_OSM_MATCH`/`KNOWLEDGE_DEFICIT`, since it never
       * reached identity acquisition at all).
       */
      sourceSupportAudits: CandidateSourceSupportAudit[];
    };
  };
}

export interface TraceWebCandidateAdmissionDecision {
  candidate: TraceAcquisitionCandidate;
  requestedRequirements: AcquisitionEvidenceRequirement[];
  candidateShapeMatches: AcquisitionEvidenceRequirement[];
  accepted: boolean;
  reason: 'MATCHING_EVIDENCE_REQUIREMENT' | 'NO_MATCHING_EVIDENCE_REQUIREMENT';
}

export interface TraceEvidenceReference {
  evidenceKey: string;
  source: string;
  title?: string;
  url?: string;
  snippet?: string;
  kind?: string;
  order?: number;
  contextHeading?: string;
}

export interface TraceComponentHint {
  key: string;
  name: string;
  role: GeoEntityHint['role'];
  required: boolean;
  order?: number;
  evidenceKeys: string[];
  addressHint?: string;
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
      attempts?: TraceEntityResolutionAttempt[];
    }
  >;
  accepted: boolean;
  rejectionReasons: string[];
}

export interface TraceEntityResolutionAttempt {
  strategy: ResolutionStrategy;
  executionStatus: 'completed' | 'failed';
  provider?: string;
  query?: string;
  providerResultCount?: number;
  poolCandidateCount?: number;
  candidateAcquired: boolean;
  failureReason?: string;
  failureStage?: 'provider_search' | 'boundary_hydration';
  candidateFoundBeforeFailure?: boolean;
  selectedCandidate?: {
    canonicalName: string;
    externalId: string;
    kind: string;
  };
  identityEvidence: IdentityEvidence[];
  verificationDecision?: VerificationDecision['status'];
}

export interface TraceGeographicValidationDecision {
  candidateTraceKey: string;
  candidateName: string;
  accepted: boolean;
  status: string;
  strategy?: string;
  scope?: { kind: string; anchorName?: string; geoEntityId?: string };
  areaScopeMembership?: AreaScopeMembershipAudit;
  groundedEvidenceKeys: string[];
  rejectionReasons: string[];
  /**
   * The request's acquisition intent ('walk'/'route_like'), used ONLY to select
   * a geographic threshold policy inside CompositeGeographicValidationService.
   */
  validationIntent?: 'walk' | 'route_like';
  /**
   * Non-geometry summary of the destination boundary used for geographic
   * validation. Enables forensic trace to answer "outside which destination
   * boundary?" without storing raw geometry.
   */
  destinationBoundary?: {
    name?: string;
    externalId?: string;
  };
  components: Array<{
    hintName: string;
    hintKey?: string;
    role?: string;
    resolvedGeoEntityId?: string;
    relation?: 'accepted' | 'offending' | 'evaluated';
    /**
     * Machine-readable reason for the component's role in the decision.
     * Present for 'offending' components; may be present for 'evaluated' if useful.
     */
    decisionReason?: GeographicDecisionReason;
    /**
     * Shortest distance in meters from the resolved point to the destination boundary.
     * Only populated for OUTSIDE_DESTINATION_BOUNDARY / OUTSIDE_CANONICAL_AREA_BOUNDARY rejections.
     * Absent when unknown or not applicable.
     */
    distanceToBoundaryMeters?: number;
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
  structuredCorroboration?: {
    proposalCount: number;
    groupCount: number;
    acceptedGroupCount: number;
    rejectedGroupCount: number;
    groups: Array<{
      groupId: string;
      proposalIds: string[];
      candidateName: string;
      contributingProviders: string[];
      mergedEvidenceKeys: string[];
      requestedRequirements: AcquisitionEvidenceRequirement[];
      observationCapabilities: AcquisitionEvidenceRequirement[];
      candidateShapeMatches: AcquisitionEvidenceRequirement[];
      matchedOriginationRequirements: AcquisitionEvidenceRequirement[];
      accepted: boolean;
      reason:
        | 'MATCHING_ORIGINATION_REQUIREMENT'
        | 'NO_MATCHING_ORIGINATION_REQUIREMENT';
    }>;
    pairDecisionSummary: {
      total: number;
      byDecision: { SAME: number; NEW: number; AMBIGUOUS: number };
      byReason: Record<string, number>;
    };
  };
  materialization?: Array<{
    candidateTraceKey: string;
    candidateName: string;
    accepted: boolean;
    rejectionReasons: string[];
    experienceId?: string;
    canonicalName?: string;
    persistedComponentCount?: number;
  }>;
  executionSkipped?: {
    reason: 'DUPLICATE_SOURCE_PLAN_EXECUTION';
    fingerprint: string;
  };
  executionSkippedSourcePlans?: Array<{
    provider: string;
    fingerprint: string;
    reason: 'DUPLICATE_SOURCE_PLAN_EXECUTION';
  }>;
}

/** Identifies the orchestration strategy that produced a lifecycle step. */
export interface TraceAcquisitionContext {
  strategy: 'generic' | 'area_route_walk';
  passNumber: number;
  anchor?: {
    rawName: string;
    usage:
      | 'geographic_scope'
      | 'specific_destination'
      | 'named_path'
      | 'unknown';
    kind?: 'venue' | 'area' | 'route';
    priority: 'soft' | 'must';
  };
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
