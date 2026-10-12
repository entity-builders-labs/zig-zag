import dailyPlanningPolicyConfig from '../../../be/src/modules/tours/config/daily-planning-policy.config';
import { ClaimType, FacetKey, ResearchBudget } from './spike1';

const planningPolicy = dailyPlanningPolicyConfig();

/** Spike 2 readiness/offering policy (spike calibration, not production defaults). */
export interface ReadinessPolicy2 {
  version: string;
  minRelevantAreasPerFacet: number;
  minRelevantPlacesPerAreaFacet: number;
  negativeOutcomeFreshnessDays: number;
  minimumUsefulResidualMinutes: number;
  offerPerExecution: { areas: number; places: number; routes: number };
  corridorRankBufferMeters: number;
  researchBudgetPerGap: ResearchBudget;
  maxGapsPerGeneration: number;
  rationale: Record<string, string>;
}

export const READINESS_POLICY_2: ReadinessPolicy2 = {
  version: 'readiness-spike2-2',
  minRelevantAreasPerFacet: 1,
  minRelevantPlacesPerAreaFacet: 2,
  negativeOutcomeFreshnessDays: 30,
  minimumUsefulResidualMinutes: planningPolicy.backfill.minimumUsefulResidualMinutes,
  offerPerExecution: { areas: 2, places: 3, routes: 2 },
  corridorRankBufferMeters: 150,
  researchBudgetPerGap: { maxRounds: 12, maxSearches: 4, maxFetches: 6 },
  maxGapsPerGeneration: 20,
  rationale: {
    minRelevantAreasPerFacet: 'Unchanged from spike 1 for comparability.',
    minRelevantPlacesPerAreaFacet: 'Unchanged from spike 1 (NOTABLE_PLACES threshold) for comparability.',
    negativeOutcomeFreshnessDays: 'Unchanged from spike 1.',
    minimumUsefulResidualMinutes: 'Reuses the planner backfill policy.',
    offerPerExecution: 'Calibrated down from 6/8/4 after A2 attempt 2: with 4 searches per execution the agent answered 11 of 72 offered questions, and unanswered questions were recorded as INSUFFICIENT_EVIDENCE without evaluation (San Telmo among them). 2/3/2 fits the per-gap budget.',
    corridorRankBufferMeters: 'Same one-block buffer as composition corridor stops.',
    researchBudgetPerGap: 'Unchanged from spike 1 final attempt for comparability.',
    maxGapsPerGeneration: 'Raised 14 -> 20 with the smaller offer size so a cold generation can reach place and route stages; still bounded.',
  },
};

/**
 * Versioned source-capability mapping for structured facts (owner decision
 * P1). A structured field supports only the meaning it establishes; no entry
 * authorizes alone, and no entry maps to WALKING_CORRIDOR.
 */
export interface StructuredEvidenceMapping {
  source: 'openstreetmap' | 'wikidata';
  /** Field path as stored on StructuredFact.field. */
  field: string;
  /** Value match: '*' = any value. */
  value: string;
  facetKey: FacetKey;
  claimTypes: ClaimType[];
  establishes: string;
  authorizesAlone: boolean;
}

export const SOURCE_CAPABILITY_VERSION = 'source-capability-spike2-1';

export const STRUCTURED_EVIDENCE_MAPPINGS: StructuredEvidenceMapping[] = [
  { source: 'wikidata', field: 'P1435', value: '*', facetKey: 'theme:history', claimTypes: ['RELEVANT_FOR', 'NOTABLE_WITHIN'], establishes: 'has a heritage designation', authorizesAlone: false },
  { source: 'openstreetmap', field: 'tag:historic', value: '*', facetKey: 'theme:history', claimTypes: ['RELEVANT_FOR', 'NOTABLE_WITHIN'], establishes: 'is mapped as a historic feature', authorizesAlone: false },
  { source: 'openstreetmap', field: 'tag:heritage', value: '*', facetKey: 'theme:history', claimTypes: ['RELEVANT_FOR', 'NOTABLE_WITHIN'], establishes: 'carries a heritage tag', authorizesAlone: false },
  { source: 'wikidata', field: 'class:museum', value: 'true', facetKey: 'theme:culture', claimTypes: ['RELEVANT_FOR', 'NOTABLE_WITHIN'], establishes: 'is a museum', authorizesAlone: false },
  { source: 'openstreetmap', field: 'tag:tourism', value: 'museum', facetKey: 'theme:culture', claimTypes: ['RELEVANT_FOR', 'NOTABLE_WITHIN'], establishes: 'is mapped as a museum', authorizesAlone: false },
];
