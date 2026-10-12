import { Spike2Catalog, discoveryKey, evaluationQuestionKey } from '../src/catalog';
import { discoverAreas, discoverPlaces, discoverRoutes } from '../src/discovery';
import { READINESS_POLICY_2 } from '../src/policy';
import { CapacityProbe2, evaluateReadiness2 } from '../src/readiness';
import { GapOutcomeRecordingAuthority, GeographyResolutionAuthority, GroundingAuthority, assertionKey, Assertion, AssertionSubject, ClaimType } from '../src/spike1';
import { CABA, DEST, REQUEST_A2, fakeOsm, fakeRoutes, fakeWikidata } from './fixtures/world2';

const NOW = new Date('2026-10-10T12:00:00Z');
const ST = 'geo:osm:relation:2223069';
const SOHO = 'geo:osm:node:9001';
const outcome = new GapOutcomeRecordingAuthority();
const usage = { rounds: 0, searches: 0, fetches: 0 };

function assertion(claimType: ClaimType, subject: AssertionSubject, facetKey: string): Assertion {
  return { key: assertionKey(claimType, subject, facetKey), claimType, subject, facetKey, destinationId: DEST.id, evidence: [], status: 'ACTIVE', createdAt: 'now' };
}

async function catalogWith(steps: { areas?: boolean; places?: boolean; routes?: boolean } = {}) {
  const catalog = Spike2Catalog.empty();
  catalog.store.recordGeoEntity(new GeographyResolutionAuthority(), DEST);
  const d = { catalog, osm: fakeOsm(), wikidata: fakeWikidata(), routes: fakeRoutes(), destination: DEST, destinationBoundary: CABA };
  const record = (kind: 'AREA' | 'PLACE' | 'ROUTE', scope: string) => catalog.store.recordGapOutcome(outcome, { gapKey: discoveryKey(kind, scope), outcome: 'SATISFIED', budgetUsed: usage, snapshotEpoch: 0, at: NOW.toISOString() });
  if (steps.areas) { await discoverAreas({ ...d, strategies: ['osm-admin-areas', 'osm-named-places', 'wikidata-area-facts'] }); record('AREA', DEST.id); }
  const st = catalog.snapshot().catalog.geoEntities[ST];
  if (steps.places) { await discoverPlaces({ ...d, strategies: ['osm-pois', 'wikidata-place-facts'] }, st); record('PLACE', ST); }
  if (steps.routes) { await discoverRoutes({ ...d, strategies: ['osm-routes'] }, st); record('ROUTE', ST); }
  return catalog;
}

const evaluate = (catalog: Spike2Catalog, request = REQUEST_A2, capacityProbe?: CapacityProbe2) =>
  evaluateReadiness2({ snapshot: catalog.snapshot(), request, destinationId: DEST.id, policy: READINESS_POLICY_2, now: NOW, capacityProbe });

describe('readiness revision 2: gap model (task 14.1)', () => {
  it('cold destination emits AREA_CANDIDATES only', async () => {
    const v = await evaluate(await catalogWith());
    expect(v.verdict === 'GAPS' && v.gaps.map((g) => g.key)).toEqual([`AREA_CANDIDATES|scope=${DEST.id}`]);
  });

  it('after area discovery, AREA_RELEVANCE offers top-ranked canonical candidates (no corridor gap yet)', async () => {
    const v = await evaluate(await catalogWith({ areas: true }));
    if (v.verdict !== 'GAPS') throw new Error('expected gaps');
    expect(v.gaps.map((g) => g.type)).toEqual(['AREA_RELEVANCE', 'AREA_RELEVANCE']);
    expect(v.gaps[0].questions[0]).toMatchObject({ claimType: 'RELEVANT_FOR', candidateId: 'geo:osm:relation:2223070' }); // Recoleta: 35 sitelinks
    expect(v.gaps.some((g) => g.type.startsWith('WALKING') || g.type === 'ROUTE_CANDIDATES')).toBe(false);
  });

  it('PLACE_CANDIDATES precedes PLACE_RELEVANCE; corridor discovery only for a bounded relevant area', async () => {
    const catalog = await catalogWith({ areas: true });
    catalog.store.upsertAssertion(new GroundingAuthority(), assertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: ST }, 'theme:history'));
    const v = await evaluate(catalog);
    if (v.verdict !== 'GAPS') throw new Error('expected gaps');
    expect(v.gaps.map((g) => `${g.type}|${g.scopeId}`)).toEqual(expect.arrayContaining([`PLACE_CANDIDATES|${ST}`, `ROUTE_CANDIDATES|${ST}`]));
    expect(v.gaps.some((g) => g.type === 'PLACE_RELEVANCE')).toBe(false);
  });

  it('one corridor gap per relevant area, keyed by the area, with offered anchors', async () => {
    const catalog = await catalogWith({ areas: true, places: true, routes: true });
    catalog.store.upsertAssertion(new GroundingAuthority(), assertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: ST }, 'theme:history'));
    const v = await evaluate(catalog);
    if (v.verdict !== 'GAPS') throw new Error('expected gaps');
    const corridor = v.gaps.filter((g) => g.type === 'WALKING_CORRIDOR_RELEVANCE');
    expect(corridor.map((g) => g.key)).toEqual([`WALKING_CORRIDOR_RELEVANCE|scope=${ST}|facet=intent:walk`]);
    expect(corridor[0].questions[0]).toMatchObject({ candidateId: 'geo:osm-route:osm:way:1', areaId: ST });
    expect(corridor[0].questions[0].anchorIds).toEqual(expect.arrayContaining([ST, 'geo:osm:way:17441757']));
  });

  it('walking only as a transport mode emits no corridor or route gap', async () => {
    const catalog = await catalogWith({ areas: true, places: true });
    catalog.store.upsertAssertion(new GroundingAuthority(), assertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: ST }, 'theme:history'));
    const v = await evaluate(catalog, { ...REQUEST_A2, experienceFormatFacets: [] });
    expect(v.verdict === 'GAPS' && v.gaps.some((g) => g.type === 'ROUTE_CANDIDATES' || g.type === 'WALKING_CORRIDOR_RELEVANCE')).toBe(false);
  });

  it('a relevant area with unknown extent becomes a NO_BOUNDED_AREA limitation (no place discovery)', async () => {
    const catalog = await catalogWith({ areas: true });
    catalog.store.upsertAssertion(new GroundingAuthority(), assertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: SOHO }, 'theme:food'));
    const v = await evaluate(catalog);
    expect(v.limitations).toContainEqual(expect.objectContaining({ type: 'PLACE_CANDIDATES', scopeId: SOHO, reason: 'NO_BOUNDED_AREA' }));
  });
});

describe('readiness revision 2: question ledger and verdicts (task 14.2)', () => {
  it('a recently INSUFFICIENT question is not re-offered by any gap type, including SCHEDULE_CAPACITY', async () => {
    const catalog = await catalogWith({ areas: true });
    const recoleta = evaluationQuestionKey('RELEVANT_FOR', 'geo:osm:relation:2223070', 'theme:history');
    catalog.store.recordGapOutcome(outcome, { gapKey: recoleta, outcome: 'INSUFFICIENT_EVIDENCE', budgetUsed: usage, snapshotEpoch: 1, at: NOW.toISOString() });
    const v = await evaluate(catalog, { ...REQUEST_A2, thematicFacets: ['theme:history'], experienceFormatFacets: [] });
    if (v.verdict !== 'GAPS') throw new Error('expected gaps');
    expect(v.gaps.flatMap((g) => g.questions.map((q) => q.key))).not.toContain(recoleta);
  });

  it('FAILED does not suppress a question', async () => {
    const catalog = await catalogWith({ areas: true });
    const recoleta = evaluationQuestionKey('RELEVANT_FOR', 'geo:osm:relation:2223070', 'theme:history');
    catalog.store.recordGapOutcome(outcome, { gapKey: recoleta, outcome: 'FAILED', budgetUsed: usage, snapshotEpoch: 1, at: NOW.toISOString() });
    const v = await evaluate(catalog, { ...REQUEST_A2, thematicFacets: ['theme:history'], experienceFormatFacets: [] });
    expect(v.verdict === 'GAPS' && v.gaps.flatMap((g) => g.questions.map((q) => q.key))).toContain(recoleta);
  });

  it('all remaining gaps exhausted -> INSUFFICIENT_KNOWLEDGE, not READY', async () => {
    const catalog = await catalogWith({ areas: true });
    for (const c of Object.values(catalog.snapshot().candidates).filter((x) => x.kind === 'AREA')) {
      catalog.store.recordGapOutcome(outcome, { gapKey: evaluationQuestionKey('RELEVANT_FOR', c.geoEntityId, 'theme:history'), outcome: 'INSUFFICIENT_EVIDENCE', budgetUsed: usage, snapshotEpoch: 1, at: NOW.toISOString() });
    }
    const v = await evaluate(catalog, { ...REQUEST_A2, thematicFacets: ['theme:history'], experienceFormatFacets: [] });
    expect(v.verdict).toBe('INSUFFICIENT_KNOWLEDGE');
    expect(v.limitations).toContainEqual(expect.objectContaining({ type: 'AREA_RELEVANCE', reason: 'QUESTIONS_EXHAUSTED' }));
  });

  it('SCHEDULE_CAPACITY expands by lineage over unevaluated place candidates', async () => {
    const catalog = await catalogWith({ areas: true, places: true });
    const g = new GroundingAuthority();
    catalog.store.upsertAssertion(g, assertion('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: ST }, 'theme:history'));
    for (const p of ['geo:osm:way:31364659', 'geo:osm:way:17441757']) {
      catalog.store.upsertAssertion(g, assertion('NOTABLE_WITHIN', { kind: 'PLACE_IN_AREA', placeGeoEntityId: p, areaGeoEntityId: ST }, 'theme:history'));
    }
    const probe: CapacityProbe2 = async () => [{ dayNumber: 2, availableMinutes: 300, meaningful: true }];
    const v = await evaluate(catalog, { ...REQUEST_A2, thematicFacets: ['theme:history'], experienceFormatFacets: [] }, probe);
    if (v.verdict !== 'GAPS') throw new Error('expected capacity gap');
    expect(v.gaps[0]).toMatchObject({ type: 'SCHEDULE_CAPACITY', lineage: 'PLACE_RELEVANCE_EXPANSION' });
    expect(v.gaps[0].questions.every((q) => q.claimType === 'NOTABLE_WITHIN' && q.areaId === ST)).toBe(true);
  });

  it('readiness takes no evidence-memory input', () => {
    expect(evaluateReadiness2.length).toBe(1);
  });
});
