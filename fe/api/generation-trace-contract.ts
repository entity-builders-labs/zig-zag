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
  | { type: "WIKIDATA_UNAVAILABLE" };

export type ResolutionStrategy =
  | "TRUSTED_OBSERVATION_REUSE"
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
  provider?: string;
  query?: string;
  resultCount?: number;
  candidateAcquired: boolean;
  selectedCandidate?: {
    canonicalName: string;
    externalId: string;
    kind: string;
  };
  identityEvidence: IdentityEvidence[];
  verificationDecision?: VerificationDecision;
}

export interface TraceComponentHint {
  key: string;
  name: string;
  role: string;
  expectedKind?: string;
  required: boolean;
  evidenceKeys: string[];
  addressHint?: string;
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
}

export interface TraceEntityResolutionDecision {
  candidateTraceKey: string;
  candidateName: string;
  hints: TraceEntityResolutionHint[];
  accepted: boolean;
  rejectionReasons: string[];
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
  candidates?: TraceCandidate[];
  providerStatus?: "success" | "failed";
  degradedReason?: string;
  [key: string]: unknown;
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
