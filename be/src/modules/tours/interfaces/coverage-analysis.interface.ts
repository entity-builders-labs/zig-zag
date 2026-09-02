export type CoverageReportStatus = 'sufficient' | 'insufficient' | 'degraded';

export type DestinationKnowledgeStatus =
  | 'discovery_supported'
  | 'profiled_fresh'
  | 'profiled_stale'
  | 'unprofiled';

export type CoverageDeficitReason =
  | 'insufficient_usable_candidates'
  | 'missing_requested_theme'
  | 'missing_requested_trait'
  | 'missing_requested_intent'
  | 'insufficient_duration_fit'
  | 'insufficient_source_diversity'
  | 'insufficient_geographic_distribution'
  | 'insufficient_semantic_coverage';

export interface ThemeCoverageSummary {
  theme: string;
  matchedCandidateCount: number;
  strongMatchCount: number;
}

export interface TraitCoverageSummary {
  trait: string;
  matchedCandidateCount: number;
  strongMatchCount: number;
}

export interface IntentCoverageSummary {
  intent: string;
  matchedCandidateCount: number;
  strongMatchCount: number;
}

export interface SourceCoverageSummary {
  source: string;
  count: number;
}

export interface GeographicCoverageSummary {
  distinctClusterCount: number;
  thresholdKilometers: number;
}

export interface SemanticCoverageSummary {
  status: 'not_requested' | 'applied' | 'unavailable';
  eligibleCandidateCount: number;
  indexedCandidateCount: number;
  reason?: string;
}

export interface CoverageDeficit {
  reason: CoverageDeficitReason;
  severity: 'blocking' | 'warning';
  message: string;
  theme?: string;
  trait?: string;
  intent?: string;
  expectedCount?: number;
  actualCount?: number;
}

interface CoverageDecisionBase {
  requiresAdditionalDiscovery: boolean;
}

export type CoverageAcquisitionDecision =
  | (CoverageDecisionBase & {
      action: 'none';
      reason: 'coverage_sufficient';
      requiresAdditionalDiscovery: false;
    })
  | (CoverageDecisionBase & {
      action: 'fail';
      reason:
        | 'no_usable_candidates'
        | 'provider_degraded_without_usable_pool'
        | 'insufficient_coverage_after_catalog_analysis';
      requiresAdditionalDiscovery: false;
      deficits: CoverageDeficit[];
    })
  | (CoverageDecisionBase & {
      action: 'needs_destination_discovery';
      reason: 'destination_requires_grounded_discovery';
      requiresAdditionalDiscovery: true;
      deficits: CoverageDeficit[];
    })
  | (CoverageDecisionBase & {
      action: 'needs_additional_discovery';
      reason: 'requested_coverage_is_missing';
      requiresAdditionalDiscovery: true;
      deficits: CoverageDeficit[];
    });

export interface CoverageReport {
  status: CoverageReportStatus;
  analyzedCandidateCount: number;
  eligibleCandidateCount: number;
  relevantCandidateCount: number;
  offeredCandidateCount: number;
  usableCandidateCount: number;
  requiredCandidateCount: number;
  requestedThemeCoverage: ThemeCoverageSummary[];
  requestedTraitCoverage: TraitCoverageSummary[];
  requestedIntentCoverage: IntentCoverageSummary[];
  sourceCoverage: SourceCoverageSummary[];
  geographicCoverage: GeographicCoverageSummary;
  semanticCoverage: SemanticCoverageSummary;
  destinationKnowledge: {
    status: DestinationKnowledgeStatus;
    coverageBoundary: 'catalog_and_grounded_discovery';
    reason: string;
  };
  providerHealth: {
    status: 'healthy' | 'degraded' | 'unknown';
    reason?: string;
  };
  deficits: CoverageDeficit[];
  decision: CoverageAcquisitionDecision;
}

export interface CoverageCandidate {
  id: string;
  name: string;
  description?: string | null;
  source?: string | null;
  weightedScore?: number | null;
  distanceKm?: number | null;
  durationMinutes?: number | null;
  themes?: string[];
  traits?: string[];
  intents?: string[];
  metadata?: unknown;
}

export interface CoverageAnalysisInput {
  candidates: CoverageCandidate[];
  requestedThemes: string[];
  requestedTraits?: string[];
  requestedIntents?: string[];
  preferredDurationMinutes?: { min?: number; max?: number };
  days: number;
  explorationStyle?: string;
  travelPace?: string;
  semanticCoverage: SemanticCoverageSummary;
  offeredCandidateCount: number;
  providerHealth?: {
    status: 'healthy' | 'degraded' | 'unknown';
    reason?: string;
  };
}
