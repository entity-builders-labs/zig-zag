/**
 * G-P7-U.A characterization of the LIVE preference ordering code (no production change).
 * Runs the real `plannerRelevanceScore` / `sortCandidatesDeterministically` (with the real
 * daily-planning policy config), `composeSet` and `findHardExclusionMatches` on the scenario
 * values of ../scripts/encoding.py and records what the current tree does.
 *
 * Run from be/: npx jest -c ../spikes/planner-comparison-2026-10-12/g-p7-u-a/characterization/jest.config.json
 * Writes ../runs/current_code.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  plannerRelevanceScore,
  sortCandidatesDeterministically,
} from '../../../../be/src/modules/tours/utils/daily-planning-candidate-sort.util';
import dailyPlanningPolicyConfig from '../../../../be/src/modules/tours/config/daily-planning-policy.config';
import { composeSet } from '../../../../be/src/modules/tours/utils/composition-set-cover.util';
import { findHardExclusionMatches } from '../../../../be/src/modules/tours/utils/experience-preference-evaluator.util';
import { PlanningExperienceCandidate } from '../../../../be/src/modules/tours/interfaces/daily-planning.interface';
import {
  CompositionCandidate,
  PreferenceSpec,
  RequestedFacet,
} from '../../../../be/src/modules/tours/interfaces/preference-spec.interface';

const OUT = path.join(__dirname, '..', 'runs', 'current_code.json');
const results: Record<string, unknown> = {};

const footprint = { type: 'POINT' as const, centroid: { lat: 0, lng: 0 } };
// The normalizer maps a missing similarity to 0 (`semanticSimilarity ?? 0`) and
// the composition service does the same; reproduce that input faithfully.
function planner(
  id: string,
  sim: number | null,
  quality: number | undefined,
  preferenceWeight: number,
): PlanningExperienceCandidate {
  return {
    experienceId: id,
    title: id,
    durationMinutes: 60,
    spatialFootprint: footprint,
    startFootprint: footprint,
    endFootprint: footprint,
    semanticScore: sim ?? 0,
    qualityScore: quality,
    preferenceWeight,
  } as PlanningExperienceCandidate;
}

const wizard = (key: string): RequestedFacet => ({
  dimension: 'theme',
  key,
  weight: 1,
  source: 'wizard',
  required: false,
});
const freeText = (key: string, weight: number): RequestedFacet => ({
  dimension: 'theme',
  key,
  weight,
  source: 'free_text',
  required: false,
});
const nullSignal = { value: null, confidence: 0, evidence: [], reasonCodes: [] };
function spec(facets: RequestedFacet[]): PreferenceSpec {
  return {
    facets,
    exclusions: { themes: [], traits: [], hard: [] },
    anchors: [],
    semanticQuery: 'x',
    explorationStyle: 'balanced',
    softConstraints: { dietary: [], accessibility: [], budget: [], group: [] },
    trip: { days: 1, startDates: [], pace: 'relaxed' },
  };
}
function comp(
  id: string,
  facets: string[],
  sim: number | null,
  quality: number | null,
): CompositionCandidate {
  return {
    id,
    componentCount: 1,
    satisfiedFacets: facets.map((f) => `theme:${f}`),
    qualityScore: quality,
    explorationSignals: {
      prominence: nullSignal,
      tourismIntensity: nullSignal,
      localCharacter: nullSignal,
    },
    explorationTilt: 0,
    semanticSimilarity: sim ?? 0,
    groundingStrength: facets.length > 0 ? 1 : 0,
    matchesHardExclusion: false,
    softAnchorBoost: 0,
    isPerformanceVenue: false,
  } as CompositionCandidate;
}

afterAll(() => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
});

describe('G-P7-U.A current-code characterization', () => {
  const scoring = dailyPlanningPolicyConfig().scoring;

  it('records the live planner weights', () => {
    results.plannerScoring = {
      semanticWeight: scoring.semanticWeight,
      qualityWeight: scoring.qualityWeight,
    };
    expect(scoring.semanticWeight).toBeDefined();
  });

  it.each([
    // [scenario, candidates as (id, sim, quality, Σ matched facet weight)]
    ['A1 wizard', [['A', 0.6, 3.5, 2], ['B', 0.98, 5, 1], ['C', 0.99, 5, 0]]],
    ['A2 free text 0.42', [['A', 0.6, 3.5, 0.84], ['B', 0.98, 5, 0.42], ['C', 0.99, 5, 0]]],
    ['B2 semantic vs quality', [['A', 0.48, 3.2, 1], ['B', 0.44, 4.8, 1]]],
    ['C1 unknown embedding', [['K1', 0.62, 4, 2], ['K2', 0.41, 4.2, 2], ['K3', 0.3, 3.6, 2], ['U', null, 4.5, 2]]],
    ['C2 unknown vs weaker explicit', [['K', 0.95, 4.9, 1], ['U', null, 3.1, 2]]],
    ['E1 wizard vs 4 weak inferred', [['A', 0.5, 4, 1], ['B', 0.8, 4.5, 1.2]]],
  ] as [string, [string, number | null, number, number][]][])(
    'planner order: %s',
    (name, rows) => {
      const candidates = rows.map(([id, sim, q, w]) => planner(id, sim, q, w));
      const sorted = sortCandidatesDeterministically(candidates, scoring);
      results[`planner ${name}`] = sorted.map((c) => ({
        id: c.experienceId,
        plannerRelevanceScore: Number(
          plannerRelevanceScore(c, scoring).toFixed(4),
        ),
      }));
      expect(sorted).toHaveLength(rows.length);
    },
  );

  it.each([
    ['A2 free text 0.42', [freeText('history', 0.42), freeText('architecture', 0.42)],
      [comp('A', ['history', 'architecture'], 0.6, 3.5), comp('B', ['history'], 0.98, 5), comp('C', [], 0.99, 5)]],
    ['C1 unknown embedding (service maps missing to 0)', [wizard('food'), wizard('markets')],
      [comp('K1', ['food', 'markets'], 0.62, 4), comp('K2', ['food', 'markets'], 0.41, 4.2),
        comp('K3', ['food', 'markets'], 0.3, 3.6), comp('U', ['food', 'markets'], null, 4.5)]],
    ['E1 wizard vs 4 weak inferred',
      [wizard('history'), freeText('street_art', 0.3), freeText('cafes', 0.3), freeText('bookshops', 0.3), freeText('parks', 0.3)],
      [comp('A', ['history'], 0.5, 4), comp('B', ['street_art', 'cafes', 'bookshops', 'parks'], 0.8, 4.5),
        comp('Z1', [], 0.1, 3), comp('Z2', [], 0.1, 3), comp('Z3', [], 0.1, 3)]],
  ] as [string, RequestedFacet[], CompositionCandidate[]][])(
    'composeSet: %s',
    (name, facets, candidates) => {
      const out = composeSet({ candidates, preferenceSpec: spec(facets) });
      results[`composeSet ${name}`] = {
        selected: out.selected,
        reservoir: out.reservoir,
        reservedForFacets: Object.fromEntries(
          out.decisions
            .filter((d) => d.reservedForFacets.length)
            .map((d) => [d.id, d.reservedForFacets]),
        ),
        remainderFill: out.decisions.filter((d) => d.remainderFill).map((d) => d.id),
        portfolioTarget: out.portfolioTarget,
      };
      expect(out.selected.length).toBeGreaterThan(0);
    },
  );

  it('hard exclusion removes a semantically excellent church before utility', () => {
    const church = {
      canonicalName: 'Basílica de San Francisco',
      description: 'Iglesia y convento en San Telmo',
      themes: ['religion', 'history'],
      traits: [],
      intents: [],
    };
    const matches = findHardExclusionMatches(church, ['religion']);
    results.hardExclusionChurch = matches;
    expect(matches).toEqual(['religion']);
  });
});
