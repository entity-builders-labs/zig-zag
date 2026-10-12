import dailyPlanningPolicyConfig from '../../../be/src/modules/tours/config/daily-planning-policy.config';
import { ResearchBudget } from './contracts';

/**
 * Spike policies (design D5, D9). Every value carries its rationale. These
 * are SPIKE CALIBRATION values, not production defaults.
 */
const planningPolicy = dailyPlanningPolicyConfig();

export interface ReadinessPolicy {
  version: string;
  minRelevantAreasPerFacet: number;
  minNotablePlacesPerAreaFacet: number;
  negativeOutcomeFreshnessDays: number;
  minimumUsefulResidualMinutes: number;
  researchBudgetPerGap: ResearchBudget;
  maxResearchedGapsPerGeneration: number;
  rationale: Record<string, string>;
}

export const READINESS_POLICY: ReadinessPolicy = {
  version: 'readiness-spike-2',
  minRelevantAreasPerFacet: 1,
  minNotablePlacesPerAreaFacet: 2,
  negativeOutcomeFreshnessDays: 30,
  minimumUsefulResidualMinutes: planningPolicy.backfill.minimumUsefulResidualMinutes,
  researchBudgetPerGap: { maxRounds: 12, maxSearches: 4, maxFetches: 6 },
  maxResearchedGapsPerGeneration: 10,
  rationale: {
    minRelevantAreasPerFacet:
      'A facet is represented once at destination level; breadth for longer trips comes from SCHEDULE_CAPACITY measured by the planner, not from a count.',
    minNotablePlacesPerAreaFacet:
      'An area-scoped facet with a single place is a place, not an area; two grounded places make a visit to the area meaningful.',
    negativeOutcomeFreshnessDays:
      'Destination tourism knowledge changes slowly; a month avoids re-researching exhausted gaps on every request while letting the web change.',
    minimumUsefulResidualMinutes:
      'Reuses the planner backfill policy so capacity has one definition.',
    researchBudgetPerGap:
      'Bounded so one gap cannot dominate a generation; enough for 2-3 search angles, corroborating fetches and in-document find steps (raised 8 -> 12 rounds after Run A attempt 3 showed find steps are needed).',
    maxResearchedGapsPerGeneration:
      'Bounds the recursive destination -> area gap chain for one generation.',
  },
};

export interface CompositionPolicy {
  version: string;
  placeVisitDwellMinutes: number;
  corridorStopDwellMinutes: number;
  corridorStopBufferMeters: number;
  walkingSpeedKmh: number;
  anchorOnRouteToleranceMeters: number;
  rationale: Record<string, string>;
}

export const COMPOSITION_POLICY: CompositionPolicy = {
  version: 'composition-spike-1',
  placeVisitDwellMinutes: 60,
  corridorStopDwellMinutes: 15,
  corridorStopBufferMeters: 150,
  walkingSpeedKmh: planningPolicy.travel.walkingSpeedKmh,
  anchorOnRouteToleranceMeters: 120,
  rationale: {
    placeVisitDwellMinutes: 'One hour per standalone visit; explicit product assumption, no per-venue knowledge yet.',
    corridorStopDwellMinutes: 'A walk pauses briefly at stops; full visits are separate PLACE_VISITs.',
    corridorStopBufferMeters: 'About one city block either side of the street.',
    walkingSpeedKmh: 'Reuses the planner travel policy.',
    anchorOnRouteToleranceMeters: 'A plaza or park endpoint touches the street within about one block.',
  },
};
