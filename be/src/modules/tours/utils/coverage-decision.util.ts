import { CoverageReport } from '../interfaces/coverage-analysis.interface';

/**
 * Whether a coverage report represents a genuinely infeasible pool that
 * must abort generation, as opposed to an unsatisfied *preference*
 * (a missing requested theme/trait/intent) that should only ever lower
 * satisfaction or trigger discovery — never fail the Tour by itself.
 *
 * `decision.action === 'fail'` covers the analyzer's own explicit
 * infeasibility branches. `eligibleCandidateCount === 0` is checked
 * independently as a regression guard: CoverageAnalyzer can label a
 * zero-candidate pool as `needs_additional_discovery` (not `fail`) when
 * specific themes/traits/intents were requested, but a genuinely empty
 * pool is always fatal regardless of which branch produced that label.
 *
 * `decision.requiresAdditionalDiscovery` is deliberately NOT part of this
 * check — it only ever means "a requested preference has no supply", which
 * is exactly the case invariant #11 of the Experience Domain V2 plan says
 * must never fail a Tour on its own.
 */
export function isCoverageFatal(report: CoverageReport): boolean {
  return (
    report.decision.action === 'fail' || report.eligibleCandidateCount === 0
  );
}
