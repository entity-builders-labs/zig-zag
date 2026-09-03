import { Injectable } from '@nestjs/common';
import {
  ExperienceDiscoveryPlan,
  ExperienceDiscoveryQuery,
  ExperienceDiscoveryRequest,
} from '../interfaces/experience-discovery.interface';

function normalizeFacet(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Provider-neutral query planner for grounded Experience acquisition. */
@Injectable()
export class ExperienceDiscoveryPlannerService {
  plan(request: ExperienceDiscoveryRequest): ExperienceDiscoveryPlan {
    const destination =
      request.scope.destinationName?.trim() || 'the destination';
    const themes = request.requestedThemes.filter(Boolean).slice(0, 5);
    const intents = (request.requestedIntents ?? [])
      .map(normalizeFacet)
      .filter(Boolean)
      .slice(0, 5);
    const dayTripRequested = intents.includes('day_trip');
    const otherIntents = intents.filter((intent) => intent !== 'day_trip');
    const gaps = (request.coverageGaps ?? []).filter(Boolean).slice(0, 3);
    const semantic = request.semanticQuery?.trim();
    const queries: ExperienceDiscoveryQuery[] = [];

    const intentTerms = otherIntents.map((intent) => intent.replace(/_/g, ' '));
    const preferenceTerms = [...themes, ...intentTerms, semantic].filter(Boolean);
    const localBase = [destination, ...preferenceTerms].filter(Boolean).join(' ');
    const dayTripBase = [...preferenceTerms, `day trips from ${destination}`]
      .filter(Boolean)
      .join(' ');

    queries.push({
      query: dayTripRequested
        ? `${dayTripBase} real places experiences`
        : `${localBase} best things to do real places experiences`,
      purpose: request.breadth === 'broad' ? 'bootstrap' : 'coverage_gap',
      expectedEvidence: dayTripRequested
        ? [
            'named same-day destinations or experiences reachable from the base destination',
            'experience description',
            'relationship to the base destination',
          ]
        : [
            'named places',
            'experience description',
            'destination association',
          ],
    });

    for (const gap of gaps) {
      queries.push({
        query: dayTripRequested
          ? `${gap} day trips from ${destination} named places official tourism`
          : `${destination} ${gap} named places official tourism`,
        purpose: 'coverage_gap',
        expectedEvidence: dayTripRequested
          ? [
              'named entities',
              'evidence of the requested experience',
              'relationship to the base destination',
            ]
          : ['named entities', 'evidence of the requested experience'],
      });
    }

    if (request.breadth === 'focused' && semantic) {
      queries.push({
        query: dayTripRequested
          ? `${semantic} day trips from ${destination} official guide`
          : `${destination} ${semantic} official guide itinerary`,
        purpose: 'focused_enrichment',
        expectedEvidence: dayTripRequested
          ? [
              'specific components',
              'same-day experience evidence',
              'relationship to the base destination',
            ]
          : ['specific components', 'ordering or relationship evidence'],
      });
    }

    return {
      queries: queries.slice(0, 4),
      enrichmentAllowed: request.breadth === 'focused' || gaps.length > 0,
    };
  }
}
