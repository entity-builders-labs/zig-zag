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
    const destination =
      request.scope.destinationName?.trim() || 'the destination';
    const themes = request.requestedThemes.filter(Boolean).slice(0, 5);
    const traits = (request.preferredTraits ?? []).filter(Boolean).slice(0, 5);
    const intents = (request.requestedIntents ?? [])
      .map(normalizeFacet)
      .filter(Boolean)
      .slice(0, 5);
    const dayTripRequested = intents.includes('day_trip');
    const otherIntents = intents.filter((intent) => intent !== 'day_trip');
    const semantic = request.semanticQuery?.trim();

    const intentTerms = otherIntents.map((intent) => intent.replace(/_/g, ' '));
    const preferenceTerms = [...themes, ...traits, ...intentTerms, semantic]
      .filter(Boolean)
      .slice(0, 12);

    // Live testing against Tavily turned out to have far more run-to-run
    // result-count variance than expected — the exact same query, called
    // back to back with no change, returned anywhere from 0 to 20 results.
    // That noise makes any single-sample "this wording broke it" claim
    // unreliable, so treat the change below as a reasonable simplification,
    // not a proven fix: mention the destination exactly once instead of
    // repeating it (as the old `${destination} ... day trips from
    // ${destination}` shape did), and drop the padding words after the
    // preference terms ("returning the same day", "no overnight", "real
    // named places") — shorter, no redundant destination mention, and the
    // "same day, no overnight" meaning still reaches the extraction LLM via
    // expectedEvidence below regardless of what the raw search query says.
    const query = dayTripRequested
      ? [destination, 'day trips from', ...preferenceTerms, 'walking tours']
          .filter(Boolean)
          .join(' ')
      : [destination, ...preferenceTerms, 'real named places official tourism']
          .filter(Boolean)
          .join(' ');

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
