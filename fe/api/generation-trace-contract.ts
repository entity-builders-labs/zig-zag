export type TraceDecisionStatus = "PASS" | "FAIL" | "WARN" | "INFO";
export type TraceRuleResult = "PASS" | "FAIL" | "WARN" | "SKIPPED";
export type TraceCandidateStatus =
  | "ELIGIBLE"
  | "REJECTED"
  | "RANKED"
  | "SELECTED"
  | "UNSELECTED";

export interface CandidateScoreBreakdown {
  semanticSimilarity?: number | null;
  qualityBonus?: number;
  proximityBonus?: number;
  diversityBonus?: number;
  totalScore?: number;
}

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

export interface TraceCandidate {
  source: string;
  id: string;
  name: string;
  detail?: string;
  offered: boolean;
  chosen: boolean;
  scoreBreakdown?: CandidateScoreBreakdown;
}

export type IdentityEvidence =
  | {
      type: "EXACT_NAME";
      identityMultiplicity: "SINGLE" | "MULTIPLE" | "UNKNOWN";
    }
  | { type: "ADDRESS_MATCH" }
  | {
      type: "DECLARED_ALIAS_MATCH";
      identityMultiplicity: "SINGLE" | "MULTIPLE" | "UNKNOWN";
    }
  | {
      type: "WIKIDATA_IDENTITY_MATCH";
      source: "OWN_QID" | "OBSERVATION_QID" | "NEARBY";
      hintMatched: boolean;
      candidateMatched: boolean;
    }
  | { type: "WIKIDATA_UNAVAILABLE" }
  | { type: "IDENTITY_CONVERGENCE"; priorStrategy: ResolutionStrategy }
  | {
      type: "STRUCTURED_ROUTE_RESOLUTION";
      provider: "openstreetmap";
      segmentExternalIds: string[];
      destinationCompatibility: "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";
      ambiguity: "SINGLE_CLUSTER" | "MULTIPLE_CLUSTERS";
    }
  | {
      type: "CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH";
      retrievalVariant: "RAW" | "DESIGNATOR_NORMALIZED";
      identityMultiplicity: "SINGLE" | "MULTIPLE" | "UNKNOWN";
    };

export type ResolutionStrategy =
  | "CATALOG_REUSE"
  | "TRUSTED_OBSERVATION_REUSE"
  | "TARGETED_ROUTE"
  | "LOCAL_OSM_POOL"
  | "NOMINATIM"
  | "PLACES"
  | "AREA_TO_PLACE_CORRECTION"
  | "ANCHOR_RESOLUTION";

export type VerificationDecision =
  | "VERIFIED"
  | "AMBIGUOUS"
  | "INSUFFICIENT_EVIDENCE"
  | "REJECTED";

export interface TraceEntityResolutionAttempt {
  strategy: ResolutionStrategy;
  executionStatus: "completed" | "failed";
  provider?: string;
  query?: string;
  providerResultCount?: number;
  poolCandidateCount?: number;
  candidateAcquired: boolean;
  failureReason?: string;
  failureStage?: "provider_search" | "boundary_hydration";
  candidateFoundBeforeFailure?: boolean;
  selectedCandidate?: {
    canonicalName: string;
    externalId: string;
    kind: string;
  };
  identityEvidence: IdentityEvidence[];
  verificationDecision?: VerificationDecision;
  destinationCompatibility?: {
    verdict: "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";
    reason: string;
  };
  routeResolution?: {
    status:
      | "RESOLVED"
      | "AMBIGUOUS"
      | "NOT_FOUND"
      | "INCOMPATIBLE"
      | "UNAVAILABLE";
    reason: string;
    variants: Array<{
      variant: "RAW" | "DESIGNATOR_NORMALIZED";
      name: string;
      rawCount: number;
      acceptedCount: number;
    }>;
    clusterCount: number;
    compatibleClusterCount: number;
    resolvedSegmentCount?: number;
    knownGeoEntityCount?: number;
  };
}

export interface TraceComponentHint {
  key: string;
  name: string;
  sourceName?: string;
  normalizationKind?: 'TYPO_CORRECTION' | 'TRANSLATION' | 'CANONICAL_NAME';
  role: string;
  expectedKind?: string;
  evidenceKeys: string[];
  addressHint?: string;
  /** Backend identity outcome (RESOLVED/UNRESOLVED/AMBIGUOUS/CONFLICTED). */
  identityStatus?: string;
}

export interface TraceEntityResolutionHint extends TraceComponentHint {
  status: "resolved" | "unresolved" | "ambiguous";
  resolvedGeoEntity?: {
    geoEntityId?: string;
    canonicalName?: string | null;
    provider?: string;
    externalId?: string;
  };
  reason?: string;
  attempts?: TraceEntityResolutionAttempt[];
  /** Canonical geometry + relation to the request scope; RESOLVED only. */
  geography?: TraceComponentGeography;
  /** Why no canonical object exists; non-RESOLVED only. */
  deficit?: TraceComponentDeficit;
}

export interface TraceComponentGeography {
  geoEntityId?: string;
  geoEntityKind?: "PLACE" | "AREA" | "ROUTE";
  canonicalGeometry: "POINT" | "LINE" | "POLYGON" | "NONE";
  geographicRelation: "INSIDE" | "INTERSECTS" | "OUTSIDE" | "UNDETERMINED";
  distanceToBoundaryMeters?: number;
}

export interface TraceComponentDeficit {
  reason:
    | "NO_CANDIDATE_ACQUIRED"
    | "CANDIDATE_UNCONFIRMED"
    | "CANDIDATE_REJECTED"
    | "AMBIGUOUS_CANDIDATES"
    | "IDENTITY_CONFLICT"
    | "PROVIDER_FAILURE"
    | "DESTINATION_INCOMPATIBLE"
    | "DESTINATION_COMPATIBILITY_UNKNOWN";
  classification:
    | "KNOWLEDGE_DEFICIT"
    | "OPERATIONAL_FAILURE"
    | "PENDING_CLASSIFICATION";
}

/** Observability of a source composition; never an acceptance threshold. */
export interface TraceCompositeCoverage {
  totalComponents: number;
  identityResolvedComponents: number;
  geographicallyAcceptedComponents: number;
  unresolvedComponents: number;
  ambiguousComponents: number;
  conflictedComponents: number;
  resolutionRatio: number;
  openResearchDeficits: string[];
  sourceCompositionComplete: boolean;
}

export interface TraceEntityResolutionDecision {
  candidateTraceKey: string;
  candidateName: string;
  hints: TraceEntityResolutionHint[];
  coverage?: TraceCompositeCoverage;
  accepted: boolean;
  rejectionReasons: string[];
}

/** Why one source composite did or did not reach the planner. */
export interface TraceCompositeOutcome {
  coverage?: TraceCompositeCoverage;
  geographicDecision:
    | {
        status: "NOT_EVALUATED";
        reason: "INCOMPLETE_SOURCE_COMPOSITION" | "NO_VALIDATION_RESULT";
      }
    | { status: "ACCEPTED"; strategy?: string }
    | { status: "REJECTED"; reasons: string[] };
  persistence:
    | {
        status: "PERSISTED";
        experienceId: string;
        dedupeDecision?: "SAME" | "NEW" | "AMBIGUOUS";
      }
    | {
        status: "NOT_PERSISTED";
        reasons: string[];
        dedupe?: {
          conflictingExperienceIds: string[];
          evidence?: {
            nameSimilarity: number;
            semanticSimilarity: number;
            componentOverlap: number;
            roleAwareComponentOverlap: number;
            reasons: string[];
          };
        };
      };
  plannerEligible: boolean;
}

export interface TraceMaterializationDecision {
  candidateTraceKey: string;
  candidateName: string;
  accepted: boolean;
  rejectionReasons: string[];
  experienceId?: string;
  compositeOutcome?: TraceCompositeOutcome;
}

export interface TraceGeographicComponent {
  hintName: string;
  hintKey?: string;
  role?: string;
  resolvedGeoEntityId?: string;
  relation?: "accepted" | "offending" | "evaluated";
  decisionReason?: string;
  distanceToBoundaryMeters?: number;
}

export interface TraceGeographicValidationDecision {
  candidateTraceKey: string;
  candidateName: string;
  accepted: boolean;
  status: string;
  strategy?: string;
  scope?: { kind: string; anchorName?: string; geoEntityId?: string };
  validationIntent?: "walk" | "route_like";
  destinationBoundary?: { name?: string; externalId?: string };
  rejectionReasons: string[];
  components: TraceGeographicComponent[];
}

export interface GenerationTraceStep {
  stage: string;
  label: string;
  summary: string;
  component?: string;
  status?: TraceDecisionStatus;
  inputs?: Record<string, unknown>;
  rules?: TraceRuleEvaluation[];
  decision?: TraceDecision;
  outputs?: Record<string, unknown>;
  candidateDecisions?: TraceCandidateDecision[];
  timing?: { startedAt?: string; durationMs?: number };
  entityResolutionAudit?: TraceEntityResolutionDecision[];
  geographicValidationAudit?: TraceGeographicValidationDecision[];
  materializationAudit?: TraceMaterializationDecision[];
  candidates?: TraceCandidate[];
  providerStatus?: "success" | "failed";
  degradedReason?: string;
  coverageReport?: Record<string, unknown>;
  semanticRanking?: Record<string, unknown>;
  grounding?: Record<string, unknown>;
  dailyPlanning?: Record<string, unknown>;
  tourCompleteness?: Record<string, unknown>;
  tourFormatCoverage?: Record<string, unknown>;
  candidatePool?: Record<string, unknown>;
}

export interface GenerationTrace {
  version?: 1 | 2 | 3 | 4;
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: {
    perExperience: Array<{
      experienceId?: string;
      experienceName: string;
      openingHoursCheck: string;
      priceLevelCheck: string;
    }>;
  };
  executionSummary?: {
    status: "completed" | "failed";
    orderedStages?: Array<Record<string, unknown>>;
    acceptedExperiences?: number;
    rejectedProposals?: number;
    selectedExperiences?: number;
    failure?: string;
  };
}
