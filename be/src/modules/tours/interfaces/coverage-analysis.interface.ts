import { ActivityKind } from '@prisma/client';

export type CoverageReportStatus = 'sufficient' | 'insufficient' | 'degraded';

export type DestinationKnowledgeStatus =
  | 'unsupported_until_pr7'
  | 'profiled_fresh'
  | 'profiled_stale'
  | 'unprofiled';

export type CoverageDeficitReason =
  | 'insufficient_usable_candidates'
  | 'missing_requested_theme'
  | 'insufficient_kind_diversity'
  | 'insufficient_source_diversity'
  | 'insufficient_geographic_distribution'
  | 'insufficient_semantic_coverage';

export interface ThemeCoverageSummary {
  theme: string;
  matchedCandidateCount: number;
  strongMatchCount: number;
}

export interface KindCoverageSummary {
  kind: ActivityKind | 'unknown';
  count: number;
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
  expectedCount?: number;
  actualCount?: number;
}

export type CoverageAcquisitionDecision =
  | {
      action: 'none';
      reason: 'coverage_sufficient';
      deployableInPr6: true;
    }
  | {
      action: 'places_text_search';
      reason:
        | 'missing_requested_theme'
        | 'insufficient_kind_diversity'
        | 'insufficient_source_diversity';
      deployableInPr6: true;
      deficits: CoverageDeficit[];
    }
  | {
      action: 'places_nearby_search';
      reason: 'insufficient_geographic_distribution';
      deployableInPr6: true;
      deficits: CoverageDeficit[];
    }
  | {
      action: 'fail';
      reason:
        | 'no_usable_candidates'
        | 'provider_degraded_without_usable_pool'
        | 'insufficient_coverage_after_catalog_analysis';
      deployableInPr6: true;
      deficits: CoverageDeficit[];
    }
  | {
      action: 'defer_to_pr7_grounded_bootstrap';
      reason: 'destination_knowledge_not_owned_in_pr6';
      deployableInPr6: false;
      deficits: CoverageDeficit[];
    }
  | {
      action: 'defer_to_pr7_grounded_gap';
      reason: 'qualitative_gap_requires_activity_discovery';
      deployableInPr6: false;
      deficits: CoverageDeficit[];
    };

export interface CoverageReport {
  status: CoverageReportStatus;
  analyzedCandidateCount: number;
  eligibleCandidateCount: number;
  offeredCandidateCount: number;
  usableCandidateCount: number;
  requiredCandidateCount: number;
  requestedThemeCoverage: ThemeCoverageSummary[];
  kindCoverage: KindCoverageSummary[];
  sourceCoverage: SourceCoverageSummary[];
  geographicCoverage: GeographicCoverageSummary;
  semanticCoverage: SemanticCoverageSummary;
  destinationKnowledge: {
    status: DestinationKnowledgeStatus;
    deployableBoundary: 'catalog_quality_only_until_pr7';
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
  kind?: ActivityKind | null;
  source?: string | null;
  type?: string | null;
  knownActivityTypeName?: string | null;
  weightedScore?: number | null;
  distanceKm?: number | null;
  metadata?: unknown;
}

export interface CoverageAnalysisInput {
  candidates: CoverageCandidate[];
  requestedThemes: string[];
  days: number;
  explorationStyle?: string;
  semanticCoverage: SemanticCoverageSummary;
  offeredCandidateCount: number;
  providerHealth?: {
    status: 'healthy' | 'degraded' | 'unknown';
    reason?: string;
  };
}
