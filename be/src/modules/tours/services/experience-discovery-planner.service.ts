import { Injectable } from '@nestjs/common';
import {
  ExperienceDiscoveryPlan,
  ExperienceDiscoveryQuery,
  ExperienceDiscoveryRequest,
} from '../interfaces/experience-discovery.interface';

/** Provider-neutral query planner for grounded Experience acquisition. */
@Injectable()
export class ExperienceDiscoveryPlannerService {
  plan(request: ExperienceDiscoveryRequest): ExperienceDiscoveryPlan {
    const destination =
      request.scope.destinationName?.trim() || 'the destination';
    const origin = request.scope.originName?.trim();
    const themes = request.requestedThemes.filter(Boolean).slice(0, 5);
    const gaps = (request.coverageGaps ?? []).filter(Boolean).slice(0, 3);
    const semantic = request.semanticQuery?.trim();
    const queries: ExperienceDiscoveryQuery[] = [];

    const base = [destination, ...themes, semantic].filter(Boolean).join(' ');
    queries.push({
      query: `${base} best things to do real places experiences`,
      purpose: request.breadth === 'broad' ? 'bootstrap' : 'coverage_gap',
      expectedEvidence: [
        'named places',
        'experience description',
        'destination association',
      ],
    });

    for (const gap of gaps) {
      queries.push({
        query: `${destination} ${gap} named places official tourism`,
        purpose: 'coverage_gap',
        expectedEvidence: [
          'named entities',
          'evidence of the requested experience',
        ],
      });
    }

    if (request.breadth === 'focused' && semantic) {
      queries.push({
        query: `${destination} ${semantic} official guide itinerary`,
        purpose: 'focused_enrichment',
        expectedEvidence: [
          'specific components',
          'ordering or relationship evidence',
        ],
      });
    }

    if (origin && request.scope.sameDayReturn) {
      queries.push({
        query: `${origin} day trip ${destination} experiences return same day`,
        purpose: 'focused_enrichment',
        expectedEvidence: ['destination relationship', 'travel feasibility'],
      });
    }

    return {
      queries: queries.slice(0, 4),
      enrichmentAllowed: request.breadth === 'focused' || gaps.length > 0,
    };
  }
}
