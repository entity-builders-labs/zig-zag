import { Injectable } from '@nestjs/common';
import {
  ExperienceDiscoveryPlan,
  ExperienceDiscoveryRequest,
} from '../interfaces/experience-discovery.interface';

function normalizeFacet(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Provider-neutral query planner for grounded Experience acquisition. */
@Injectable()
export class ExperienceDiscoveryPlannerService {
  /**
   * A single, keyword-style query combining every requested preference,
   * rather than one query per theme/trait/intent gap. Splitting into
   * multiple calls was tried and measured against the live Tavily API
   * (see docs/superpowers — the "Dos relojes" / discovery-quality session):
   * each extra call cost real money for no quality gain, and the per-gap
   * queries were built from CoverageAnalyzer's human-readable diagnostic
   * `message` strings (meant for the Bitácora, not a search engine),
   * producing queries so garbled they mostly returned results for the
   * wrong country entirely (e.g. San Juan, Puerto Rico instead of San Juan,
   * Argentina). A single plain-keyword query beat both the broken
   * multi-query approach and a long natural-language instruction sentence —
   * search engines respond to search terms, not prompts.
   */
  plan(request: ExperienceDiscoveryRequest): ExperienceDiscoveryPlan {
    const destination = request.scope.destinationName?.trim() ?? '';
    const themes = request.requestedThemes
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);
    const traits = (request.preferredTraits ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);
    const intents = (request.requestedIntents ?? [])
      .map(normalizeFacet)
      .filter(Boolean)
      .slice(0, 5);
    const dayTripRequested = intents.includes('day_trip');
    const intentTerms = intents.map((intent) => intent.replace(/_/g, ' '));
    const semantic = request.semanticQuery?.trim();

    // Live testing against Tavily showed far more run-to-run result-count
    // variance than expected for the identical query (0 to 20 results with
    // no code change at all), so no single-sample before/after comparison
    // can prove one exact wording "safer" than another — every wording
    // choice here is a reasonable simplification, not a proven fix.
    //
    // Every requested intent (day_trip included) is folded into the same
    // flat term list as themes/traits instead of day_trip driving its own
    // fixed phrase ("day trips from ... walking tours"/"real named places
    // official tourism") — that fixed framing was never empirically shown
    // to help, and a plain "day trip" keyword term is consistent with
    // treating this as keywords, not prose ("search engines respond to
    // search terms, not prompts" — see the query-length test below).
    // `expectedEvidence` below is not read by anything downstream (verified
    // across the codebase) — it does not carry the day-trip semantics
    // anywhere the raw query text above doesn't already reach.
    const queryTerms = [
      destination,
      ...themes,
      ...traits,
      ...intentTerms,
      semantic,
    ].filter(Boolean);
    const query = [...new Set(queryTerms)].join(' ');

    return {
      queries: [
        {
          query,
          purpose: request.breadth === 'broad' ? 'bootstrap' : 'coverage_gap',
          expectedEvidence: dayTripRequested
            ? [
                'named same-day destinations or experiences reachable from the base destination',
                'evidence that the experience can start from the base and return the same day',
                'experience description',
                'relationship to the base destination',
              ]
            : [
                'named places',
                'experience description',
                'destination association',
              ],
        },
      ],
      enrichmentAllowed: true,
    };
  }
}
