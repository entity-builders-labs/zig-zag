import { isCoverageFatal } from './coverage-decision.util';
import { CoverageReport } from '../interfaces/coverage-analysis.interface';

function buildReport(overrides: Partial<CoverageReport>): CoverageReport {
  return {
    status: 'sufficient',
    analyzedCandidateCount: 12,
    eligibleCandidateCount: 12,
    relevantCandidateCount: 12,
    offeredCandidateCount: 0,
    usableCandidateCount: 0,
    requiredCandidateCount: 0,
    requestedThemeCoverage: [],
    requestedTraitCoverage: [],
    requestedIntentCoverage: [],
    sourceCoverage: [],
    geographicCoverage: { distinctClusterCount: 0, thresholdKilometers: 2 },
    semanticCoverage: {
      status: 'not_requested',
      eligibleCandidateCount: 0,
      indexedCandidateCount: 0,
    },
    destinationKnowledge: {
      status: 'discovery_supported',
      coverageBoundary: 'catalog_and_grounded_discovery',
      reason: 'test',
    },
    providerHealth: { status: 'healthy' },
    deficits: [],
    decision: {
      action: 'none',
      reason: 'coverage_sufficient',
      requiresAdditionalDiscovery: false,
    },
    ...overrides,
  };
}

describe('isCoverageFatal', () => {
  it('is not fatal when coverage is sufficient', () => {
    expect(isCoverageFatal(buildReport({}))).toBe(false);
  });

  it('is not fatal when a rich pool is only missing a requested theme (invariant #11: a missing positive preference must never fail the Tour)', () => {
    const report = buildReport({
      eligibleCandidateCount: 250,
      relevantCandidateCount: 230,
      deficits: [
        {
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message:
            'No hay coverage verificable para el tema solicitado "tango".',
          theme: 'tango',
          expectedCount: 1,
          actualCount: 0,
        },
      ],
      decision: {
        action: 'needs_additional_discovery',
        reason: 'requested_coverage_is_missing',
        requiresAdditionalDiscovery: true,
        deficits: [],
      },
    });
    expect(isCoverageFatal(report)).toBe(false);
  });

  it('is not fatal when a rich pool is missing a requested trait and intent simultaneously', () => {
    const report = buildReport({
      eligibleCandidateCount: 40,
      deficits: [
        {
          reason: 'missing_requested_trait',
          severity: 'blocking',
          message: 'trait missing',
          trait: 'accessible',
          expectedCount: 1,
          actualCount: 0,
        },
        {
          reason: 'missing_requested_intent',
          severity: 'blocking',
          message: 'intent missing',
          intent: 'day_trip',
          expectedCount: 1,
          actualCount: 0,
        },
      ],
      decision: {
        action: 'needs_additional_discovery',
        reason: 'requested_coverage_is_missing',
        requiresAdditionalDiscovery: true,
        deficits: [],
      },
    });
    expect(isCoverageFatal(report)).toBe(false);
  });

  it('is fatal when the decision explicitly failed', () => {
    const report = buildReport({
      eligibleCandidateCount: 0,
      decision: {
        action: 'fail',
        reason: 'no_usable_candidates',
        requiresAdditionalDiscovery: false,
        deficits: [],
      },
    });
    expect(isCoverageFatal(report)).toBe(true);
  });

  it('is fatal when the pool is genuinely empty even if the decision action is not literally "fail"', () => {
    // Regression guard: CoverageAnalyzer's own branching can label a
    // zero-candidate pool as `needs_additional_discovery` when specific
    // themes were requested (see coverage-analyzer.service.ts). A zero
    // pool is always fatal regardless of which branch produced it.
    const report = buildReport({
      eligibleCandidateCount: 0,
      decision: {
        action: 'needs_additional_discovery',
        reason: 'requested_coverage_is_missing',
        requiresAdditionalDiscovery: true,
        deficits: [],
      },
    });
    expect(isCoverageFatal(report)).toBe(true);
  });
});
