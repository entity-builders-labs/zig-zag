import { DailyPlanningSolution, PlanningExperienceCandidate } from '../../../be/src/modules/tours/interfaces/daily-planning.interface';
import { recompose } from '../src/composition/reusable';
import { PlannerPort, composeTour } from '../src/composition/tour';
import { corridorWalkKey, placeVisitKey } from '../src/keys';
import { SpikePlanner } from '../src/planner';
import { COMPOSITION_POLICY } from '../src/policy';
import { DEFENSA_STATED, DEST_ID, FIXTURE_DESTINATION, REQUEST_A, fixtureAssertion, grounding, worldStore } from './fixtures/world';

const DEFENSA_KEY = corridorWalkKey(DEFENSA_STATED);

function catalog() {
  const store = worldStore();
  for (const [place, facet] of [['geo-plaza-dorrego', 'theme:history'], ['geo-mercado-san-telmo', 'theme:food']]) {
    store.upsertAssertion(grounding, fixtureAssertion('NOTABLE_WITHIN', { kind: 'PLACE_IN_AREA', placeGeoEntityId: place, areaGeoEntityId: 'geo-san-telmo' }, facet));
  }
  store.upsertAssertion(grounding, fixtureAssertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: 'geo-cementerio-recoleta' }, 'theme:history'));
  store.upsertAssertion(grounding, fixtureAssertion('WALKING_CORRIDOR', { kind: 'CORRIDOR', corridor: DEFENSA_STATED }, 'intent:walk'));
  recompose(store, DEST_ID, COMPOSITION_POLICY);
  return store;
}

describe('Tour composition boundary (task 7.1)', () => {
  it('rejects the whole selection when it contains an unoffered identity', async () => {
    const store = catalog();
    const planner: PlannerPort = { solve: jest.fn() };
    const result = await composeTour({
      snapshot: store.snapshot(), request: REQUEST_A, planner, policy: COMPOSITION_POLICY,
      selection: [placeVisitKey('geo-plaza-dorrego'), 'PLACE_VISIT|place=invented'],
    });
    expect(result).toEqual({ status: 'SELECTION_REJECTED', unofferedIds: ['PLACE_VISIT|place=invented'] });
    expect(planner.solve).not.toHaveBeenCalled();
  });

  it('composes a Tour snapshot with the real planner; the L4 store is unchanged', async () => {
    const store = catalog();
    const before = store.snapshot();
    const result = await composeTour({ snapshot: store.snapshot(), request: REQUEST_A, planner: new SpikePlanner(FIXTURE_DESTINATION), policy: COMPOSITION_POLICY });
    if (result.status !== 'COMPOSED') throw new Error('expected a tour');
    const walk = result.tour.experiences.find((r) => r.experienceId === DEFENSA_KEY);
    expect(walk?.components[0]).toMatchObject({ role: 'route', geoEntityId: 'geo-defensa', geometry: { type: 'LineString' } });
    expect(walk?.components.slice(1).map((c) => c.name)).toEqual(['Mercado de San Telmo', 'Plaza Dorrego']);
    expect(result.tour.catalogEpoch).toBe(before.epoch);
    expect(store.snapshot()).toEqual(before);
  });

  it('optional stop trimming appears only in the Tour snapshot', async () => {
    const store = catalog();
    const before = store.snapshot();
    // A planner stub that cannot fit the full corridor walk but fits it without stops.
    const calls: PlanningExperienceCandidate[][] = [];
    const planner: PlannerPort = {
      async solve(candidates) {
        calls.push(candidates);
        const walk = candidates.find((c) => c.experienceId === DEFENSA_KEY) as PlanningExperienceCandidate;
        const fits = (walk.componentFootprints?.length ?? 0) <= 2;
        const solution: DailyPlanningSolution = {
          days: [{ dayNumber: 1, experiences: fits ? [{ experienceId: DEFENSA_KEY, startMinutesFromMidnight: 540, endMinutesFromMidnight: 540 + walk.durationMinutes }] : [], totalExperienceMinutes: 0, totalTravelMinutes: 0, totalWalkingMinutes: 0, utilizationMinutes: 0 }],
          unselected: fits ? [] : [{ experienceId: DEFENSA_KEY, reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'] }],
          score: 0, metadata: { solver: 'stub', approximateTravel: true },
        };
        return solution;
      },
    };
    const result = await composeTour({ snapshot: store.snapshot(), request: REQUEST_A, planner, policy: COMPOSITION_POLICY });
    if (result.status !== 'COMPOSED') throw new Error('expected a tour');
    expect(calls).toHaveLength(2);
    const row = result.tour.experiences[0];
    expect(row.experienceId).toBe(DEFENSA_KEY);
    expect(row.trimmedOptionalStops).toEqual(['geo-mercado-san-telmo', 'geo-plaza-dorrego']);
    expect(row.components.map((c) => c.role)).toEqual(['route']);
    expect(row.durationMinutes).toBeLessThan(before.experiences[DEFENSA_KEY].content.durationMinutes);
    // Catalog content is unchanged: same stops, same revision.
    expect(store.snapshot().experiences[DEFENSA_KEY]).toEqual(before.experiences[DEFENSA_KEY]);
  });
});
