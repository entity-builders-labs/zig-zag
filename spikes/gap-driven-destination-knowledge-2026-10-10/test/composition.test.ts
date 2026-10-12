import { CorridorSubject } from '../src/contracts';
import { toPlanningCandidate } from '../src/composition/projection';
import { deriveExperiences, recompose } from '../src/composition/reusable';
import { retractAssertion } from '../src/grounding/ground';
import { corridorWalkKey, placeVisitKey } from '../src/keys';
import { SpikePlanner } from '../src/planner';
import { COMPOSITION_POLICY } from '../src/policy';
import {
  DEFENSA_CLIP,
  DEFENSA_STATED,
  DEST_ID,
  FIXTURE_DESTINATION,
  REQUEST_A,
  fixtureAssertion,
  grounding,
  worldStore,
} from './fixtures/world';

const notable = (placeId: string, facet = 'theme:history') =>
  fixtureAssertion('NOTABLE_WITHIN', { kind: 'PLACE_IN_AREA', placeGeoEntityId: placeId, areaGeoEntityId: 'geo-san-telmo' }, facet);
const corridor = (subject: CorridorSubject = DEFENSA_STATED) => fixtureAssertion('WALKING_CORRIDOR', { kind: 'CORRIDOR', corridor: subject }, 'intent:walk');

function knowledgeStore() {
  const store = worldStore();
  store.upsertAssertion(grounding, notable('geo-plaza-dorrego'));
  store.upsertAssertion(grounding, notable('geo-mercado-san-telmo', 'theme:food'));
  store.upsertAssertion(grounding, fixtureAssertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: 'geo-cementerio-recoleta' }, 'theme:history'));
  store.upsertAssertion(grounding, corridor());
  return store;
}

const DEFENSA_KEY = corridorWalkKey(DEFENSA_STATED);

describe('reusable Experience derivation (task 6.1)', () => {
  it('derives PLACE_VISITs and one CORRIDOR_WALK whose keys follow the stable identity rule', () => {
    const experiences = deriveExperiences(knowledgeStore().snapshot(), DEST_ID, COMPOSITION_POLICY);
    expect(experiences.map((e) => e.key)).toEqual([
      DEFENSA_KEY,
      placeVisitKey('geo-cementerio-recoleta'),
      placeVisitKey('geo-mercado-san-telmo'),
      placeVisitKey('geo-plaza-dorrego'),
    ]);
    expect(DEFENSA_KEY).toBe('CORRIDOR_WALK|route=geo-defensa|from=geo:geo-parque-lezama|to=geo:geo-plaza-de-mayo');
  });

  it('corridor content: clipped LINE, relevant stops ordered along the segment, trimmable, derived duration', () => {
    const walk = deriveExperiences(knowledgeStore().snapshot(), DEST_ID, COMPOSITION_POLICY).find((e) => e.key === DEFENSA_KEY);
    expect(walk?.content.footprint.type).toBe('LINE');
    expect(walk?.content.stops.map((s) => s.name)).toEqual(['Mercado de San Telmo', 'Plaza Dorrego']);
    expect(walk?.content.stops.every((s) => s.required === false)).toBe(true);
    // Canonical start is Parque Lezama (sorted bound): stops ordered from the south.
    expect(walk?.content.stops[0].alongMeters).toBeLessThan(walk?.content.stops[1].alongMeters ?? 0);
    expect(walk?.content.durationMinutes).toBeGreaterThan(2 * COMPOSITION_POLICY.corridorStopDwellMinutes);
    expect(walk?.justification).toEqual(expect.arrayContaining([corridor().key, notable('geo-plaza-dorrego').key]));
    expect(walk?.content.name).toBe('Walk along Defensa: Parque Lezama - Plaza de Mayo');
  });

  it('is deterministic: repeated composition yields identical keys and content', () => {
    const store = knowledgeStore();
    expect(deriveExperiences(store.snapshot(), DEST_ID, COMPOSITION_POLICY)).toEqual(deriveExperiences(store.snapshot(), DEST_ID, COMPOSITION_POLICY));
  });

  it('area-clip corridors derive their segment from the area boundary', () => {
    const store = knowledgeStore();
    store.upsertAssertion(grounding, corridor(DEFENSA_CLIP));
    const clip = deriveExperiences(store.snapshot(), DEST_ID, COMPOSITION_POLICY).find((e) => e.key === corridorWalkKey(DEFENSA_CLIP));
    expect(clip?.content.name).toBe('Walk along Defensa through San Telmo');
    expect(clip?.content.footprint.type === 'LINE' && clip.content.footprint.line.length).toBeGreaterThanOrEqual(2);
  });

  it('opening hours stay explicitly unknown in the planner projection', () => {
    const [first] = deriveExperiences(knowledgeStore().snapshot(), DEST_ID, COMPOSITION_POLICY);
    expect(toPlanningCandidate(first, REQUEST_A).openingHours).toEqual({ status: 'unknown' });
  });
});

describe('upsert by key, revisions and archival (task 6.2)', () => {
  it('a new grounded stop along the corridor revises content under the same key', () => {
    const store = worldStore();
    store.upsertAssertion(grounding, corridor());
    store.upsertAssertion(grounding, notable('geo-plaza-dorrego'));
    const first = recompose(store, DEST_ID, COMPOSITION_POLICY);
    expect(first.created).toContain(DEFENSA_KEY);
    const before = store.snapshot().experiences[DEFENSA_KEY];
    store.upsertAssertion(grounding, notable('geo-mercado-san-telmo', 'theme:food'));
    const second = recompose(store, DEST_ID, COMPOSITION_POLICY);
    expect(second.revised).toContain(DEFENSA_KEY);
    const after = store.snapshot().experiences[DEFENSA_KEY];
    expect(after.key).toBe(before.key);
    expect(after.contentRevision).toBe(before.contentRevision + 1);
    expect(after.content.stops).toHaveLength(2);
  });

  it('a policy version bump recomposes in place and creates no duplicate', () => {
    const store = knowledgeStore();
    recompose(store, DEST_ID, COMPOSITION_POLICY);
    const keysBefore = Object.keys(store.snapshot().experiences).sort();
    const report = recompose(store, DEST_ID, { ...COMPOSITION_POLICY, version: 'composition-spike-2', corridorStopDwellMinutes: 20 });
    expect(report.created).toEqual([]);
    expect(Object.keys(store.snapshot().experiences).sort()).toEqual(keysBefore);
    expect(store.snapshot().experiences[DEFENSA_KEY].policyVersion).toBe('composition-spike-2');
  });

  it('retracting the corridor assertion archives the corridor walk; nothing new is offered', () => {
    const store = knowledgeStore();
    recompose(store, DEST_ID, COMPOSITION_POLICY);
    retractAssertion(store, corridor().key);
    const report = recompose(store, DEST_ID, COMPOSITION_POLICY);
    expect(report.archived).toEqual([DEFENSA_KEY]);
    expect(store.snapshot().experiences[DEFENSA_KEY].status).toBe('ARCHIVED');
  });

  it('recomposition with no knowledge change writes nothing', () => {
    const store = knowledgeStore();
    recompose(store, DEST_ID, COMPOSITION_POLICY);
    const epoch = store.epoch;
    const report = recompose(store, DEST_ID, COMPOSITION_POLICY);
    expect(report.unchanged).toHaveLength(4);
    expect(store.epoch).toBe(epoch);
  });
});

describe('planner projection (task 6.3)', () => {
  it('projects POINT and LINE footprints and the real solver plans the corridor walk along its stops', async () => {
    const experiences = deriveExperiences(knowledgeStore().snapshot(), DEST_ID, COMPOSITION_POLICY);
    const candidates = experiences.map((e) => toPlanningCandidate(e, REQUEST_A));
    const walk = candidates.find((c) => c.experienceId === DEFENSA_KEY);
    expect(walk?.spatialFootprint.type).toBe('LINE');
    expect(walk?.componentFootprints).toHaveLength(4); // start + 2 stops + end
    expect(walk?.startFootprint).toEqual(walk?.componentFootprints?.[0]);
    expect(walk?.endFootprint).toEqual(walk?.componentFootprints?.[3]);
    expect(candidates.find((c) => c.experienceId === placeVisitKey('geo-plaza-dorrego'))?.spatialFootprint.type).toBe('POINT');

    const solution = await new SpikePlanner(FIXTURE_DESTINATION).solve(candidates, REQUEST_A);
    const planned = solution.days.flatMap((d) => d.experiences.map((e) => e.experienceId));
    expect(planned).toContain(DEFENSA_KEY);
    expect(solution.metadata.routing?.internalEstimateCount).toBeGreaterThan(0);
  });
});
