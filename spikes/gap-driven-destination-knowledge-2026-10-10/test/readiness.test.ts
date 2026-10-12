import { ReusableExperience } from '../src/contracts';
import { experienceFormatFacets, mapClaimThemes, thematicFacets } from '../src/facets';
import { SpikePlanner } from '../src/planner';
import { READINESS_POLICY } from '../src/policy';
import { CapacityProbe, evaluateReadiness } from '../src/readiness';
import { GapOutcomeRecordingAuthority, ReusableCompositionAuthority } from '../src/stores';
import {
  DEFENSA_STATED,
  DEST_ID,
  FIXTURE_DESTINATION,
  REQUEST_A,
  fixtureAssertion,
  grounding,
  worldStore,
} from './fixtures/world';

const NOW = new Date('2026-10-10T12:00:00Z');
const evaluate = (store: ReturnType<typeof worldStore>, request = REQUEST_A, capacityProbe?: CapacityProbe) =>
  evaluateReadiness({ snapshot: store.snapshot(), request, destinationId: DEST_ID, policy: READINESS_POLICY, now: NOW, capacityProbe });

const relevant = (areaId: string, facet: string) => fixtureAssertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: areaId }, facet);
const notable = (placeId: string, areaId: string, facet: string) =>
  fixtureAssertion('NOTABLE_WITHIN', { kind: 'PLACE_IN_AREA', placeGeoEntityId: placeId, areaGeoEntityId: areaId }, facet);

function satisfiedStore() {
  const store = worldStore();
  for (const facet of ['theme:history', 'theme:food']) {
    store.upsertAssertion(grounding, relevant('geo-san-telmo', facet));
    store.upsertAssertion(grounding, notable('geo-plaza-dorrego', 'geo-san-telmo', facet));
    store.upsertAssertion(grounding, notable('geo-mercado-san-telmo', 'geo-san-telmo', facet));
  }
  store.upsertAssertion(grounding, fixtureAssertion('WALKING_CORRIDOR', { kind: 'CORRIDOR', corridor: DEFENSA_STATED }, 'intent:walk'));
  return store;
}

describe('facet canonicalization (task 3.1)', () => {
  it('maps synonymous wording to one canonical facet key', () => {
    expect(thematicFacets(['historia', 'History', 'histórico'])).toEqual(['theme:history']);
    expect(thematicFacets(['comida'])).toEqual(['theme:food']);
    expect(experienceFormatFacets(['walking', 'caminar'])).toEqual(['intent:walk']);
  });

  it('drops unmapped themes instead of storing free text', () => {
    expect(mapClaimThemes(['colonial charm', 'history', 'theme:not-a-facet'])).toEqual(['theme:history']);
    expect(mapClaimThemes(['intent:walk'])).toEqual(['intent:walk']);
  });

  it('readiness policy is versioned and every value has a rationale', () => {
    expect(READINESS_POLICY.version).toMatch(/spike/);
    for (const field of ['minRelevantAreasPerFacet', 'minNotablePlacesPerAreaFacet', 'negativeOutcomeFreshnessDays', 'researchBudgetPerGap']) {
      expect(READINESS_POLICY.rationale[field]).toBeTruthy();
    }
  });
});

describe('readiness evaluation (task 3.2)', () => {
  it('is deterministic for the same snapshot, request and policy', async () => {
    const store = worldStore();
    expect(await evaluate(store)).toEqual(await evaluate(store));
  });

  it('emits destination-level gaps on an empty catalog', async () => {
    const result = await evaluate(worldStore());
    expect(result.verdict).toBe('GAPS');
    if (result.verdict !== 'GAPS') return;
    expect(result.gaps.map((g) => g.key)).toEqual([
      `AREA_RELEVANCE|scope=${DEST_ID}|facet=theme:food`,
      `AREA_RELEVANCE|scope=${DEST_ID}|facet=theme:history`,
      `WALKING_CORRIDOR|scope=${DEST_ID}|facet=intent:walk`,
    ]);
  });

  it('emits area-scoped NOTABLE_PLACES once an area is known (recursive discovery)', async () => {
    const store = worldStore();
    store.upsertAssertion(grounding, relevant('geo-san-telmo', 'theme:history'));
    const result = await evaluate(store);
    if (result.verdict !== 'GAPS') throw new Error('expected gaps');
    expect(result.gaps.map((g) => g.key)).toContain('NOTABLE_PLACES|scope=geo-san-telmo|facet=theme:history');
    expect(result.gaps.map((g) => g.key)).not.toContain(`AREA_RELEVANCE|scope=${DEST_ID}|facet=theme:history`);
  });

  it('scopes WALKING_CORRIDOR to the destination and satisfies it by a corridor in a relevant area', async () => {
    const store = worldStore();
    store.upsertAssertion(grounding, relevant('geo-san-telmo', 'theme:history'));
    const before = await evaluate(store);
    if (before.verdict !== 'GAPS') throw new Error('expected gaps');
    const corridorGap = before.gaps.find((g) => g.type === 'WALKING_CORRIDOR');
    expect(corridorGap?.scopeGeoEntityId).toBe(DEST_ID);
    expect(corridorGap?.relevantAreaIds).toEqual(['geo-san-telmo']);
    store.upsertAssertion(grounding, fixtureAssertion('WALKING_CORRIDOR', { kind: 'CORRIDOR', corridor: DEFENSA_STATED }, 'intent:walk'));
    const after = await evaluate(store);
    expect(after.verdict === 'GAPS' ? after.gaps.some((g) => g.type === 'WALKING_CORRIDOR') : false).toBe(false);
  });

  it('emits no WALKING_CORRIDOR when walking is only a permitted transport mode', async () => {
    const result = await evaluate(worldStore(), { ...REQUEST_A, experienceFormatFacets: [] });
    expect(result.verdict === 'GAPS' && result.gaps.some((g) => g.type === 'WALKING_CORRIDOR')).toBe(false);
    expect(REQUEST_A.mobility.allowedTransportationModes).toContain('walking');
  });

  it('does not emit gaps that current knowledge satisfies', async () => {
    const result = await evaluate(satisfiedStore());
    expect(result.verdict).toBe('READY');
  });

  it('suppresses INSUFFICIENT_EVIDENCE/BUDGET_EXHAUSTED within the window, re-emits after FAILED', async () => {
    const key = `AREA_RELEVANCE|scope=${DEST_ID}|facet=theme:food`;
    const usage = { rounds: 1, searches: 1, fetches: 1 };
    for (const outcome of ['INSUFFICIENT_EVIDENCE', 'BUDGET_EXHAUSTED'] as const) {
      const store = worldStore();
      store.recordGapOutcome(new GapOutcomeRecordingAuthority(), { gapKey: key, outcome, budgetUsed: usage, snapshotEpoch: 1, at: '2026-10-01T00:00:00Z' });
      const result = await evaluate(store);
      if (result.verdict !== 'GAPS') throw new Error('expected gaps');
      expect(result.gaps.map((g) => g.key)).not.toContain(key);
      expect(result.limitations.map((l) => l.gap.key)).toContain(key);
    }
    const failed = worldStore();
    failed.recordGapOutcome(new GapOutcomeRecordingAuthority(), { gapKey: key, outcome: 'FAILED', budgetUsed: usage, snapshotEpoch: 1, at: '2026-10-09T00:00:00Z' });
    const result = await evaluate(failed);
    expect(result.verdict === 'GAPS' && result.gaps.map((g) => g.key)).toContain(key);
  });

  it('re-emits an exhausted gap once the freshness window has passed', async () => {
    const key = `AREA_RELEVANCE|scope=${DEST_ID}|facet=theme:food`;
    const store = worldStore();
    store.recordGapOutcome(new GapOutcomeRecordingAuthority(), {
      gapKey: key, outcome: 'INSUFFICIENT_EVIDENCE', budgetUsed: { rounds: 1, searches: 1, fetches: 1 }, snapshotEpoch: 1, at: '2026-08-01T00:00:00Z',
    });
    const result = await evaluate(store);
    expect(result.verdict === 'GAPS' && result.gaps.map((g) => g.key)).toContain(key);
  });
});

describe('SCHEDULE_CAPACITY via a provisional plan (task 3.3)', () => {
  const placeVisit = (id: string, lng: number, lat: number): ReusableExperience => ({
    key: `PLACE_VISIT|place=${id}`, unitKind: 'PLACE_VISIT', anchors: [id], justification: ['fixture'], contentRevision: 1,
    policyVersion: 'fixture', status: 'ACTIVE',
    content: { name: id, stops: [], durationMinutes: 60, footprint: { type: 'POINT', point: { lng, lat } }, facetKeys: ['theme:history'] },
  });

  it('emits SCHEDULE_CAPACITY when facet gaps are satisfied but the real planner leaves meaningful residual capacity', async () => {
    const store = satisfiedStore();
    store.upsertExperience(new ReusableCompositionAuthority(), placeVisit('geo-plaza-dorrego', -58.3716, -34.6206));
    store.upsertExperience(new ReusableCompositionAuthority(), placeVisit('geo-mercado-san-telmo', -58.3726, -34.6211));
    const planner = new SpikePlanner(FIXTURE_DESTINATION);
    const before = store.snapshot();
    const result = await evaluate(store, REQUEST_A, planner.capacityProbe());
    if (result.verdict !== 'GAPS') throw new Error('expected capacity gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ type: 'SCHEDULE_CAPACITY', key: `SCHEDULE_CAPACITY|scope=${DEST_ID}|facet=theme:food+theme:history` });
    expect(result.gaps[0].observed).toBeGreaterThan(0);
    // The provisional plan is discarded: nothing in the catalog changed.
    expect(store.snapshot()).toEqual(before);
  });

  it('is not evaluated while facet gaps are emitted', async () => {
    const probe = jest.fn<ReturnType<CapacityProbe>, Parameters<CapacityProbe>>().mockResolvedValue([{ dayNumber: 1, availableMinutes: 600, meaningful: true }]);
    const result = await evaluate(worldStore(), REQUEST_A, probe);
    expect(probe).not.toHaveBeenCalled();
    expect(result.verdict === 'GAPS' && result.gaps.some((g) => g.type === 'SCHEDULE_CAPACITY')).toBe(false);
  });
});
