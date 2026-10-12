import { readFileSync } from 'fs';
import { join } from 'path';
import { Spike2Catalog, discoveryKey } from '../src/catalog';
import { EvaluationQuestion, ProposedAnswer } from '../src/contracts';
import { discoverAreas, discoverPlaces, discoverRoutes } from '../src/discovery';
import { groundQuestion, structuredCaptures, sufficiency2 } from '../src/grounding';
import { EvidenceMemory } from '../src/memory';
import { COMPOSITION_POLICY, EvidenceCapture, FetchedDocument, GapOutcomeRecordingAuthority, GeographyResolutionAuthority, SupportLevel, SupportVerifier, WebTools, captureFromQuote, claimStatement, documentFromHtml, registrableDomain } from '../src/spike1';
import { CABA, DEST, fakeOsm, fakeRoutes, fakeWikidata } from './fixtures/world2';

const ED = 'https://www.fixture-guide.example/san-telmo';
const BLOG = 'https://someone.blog-host.example/ba-notes';
const DOCS: Record<string, FetchedDocument> = {
  [ED]: documentFromHtml(ED, readFileSync(join(__dirname, 'fixtures/editorial-page.html'), 'utf8'), '2026-10-10T00:00:00Z'),
  [BLOG]: documentFromHtml(BLOG, readFileSync(join(__dirname, 'fixtures/blog-page.html'), 'utf8'), '2026-10-10T00:00:00Z'),
};
const cap = (url: string, quote: string) => {
  const c = captureFromQuote(DOCS[url], quote, registrableDomain(url));
  if (!c) throw new Error(`quote not in ${url}`);
  return c;
};
const tools: WebTools = { search: async () => [], fetch: async (url) => { if (!DOCS[url]) throw new Error('404'); return DOCS[url]; } };
const verifier = (rule: (statement: string, text: string) => SupportLevel = () => 'EXPLICIT'): SupportVerifier => ({
  identity: { provider: 'fake', model: 'rules' },
  async judge(q, c) { return { claimKey: q.claimKey, level: rule(claimStatement(q), c.capture.kind === 'PROSE_SPAN' ? c.capture.text : ''), verifier: { provider: 'fake', model: 'rules' } }; },
});

const ST = 'geo:osm:relation:2223069';
const PLAZA = 'geo:osm:way:31364659';
const LEZAMA = 'geo:osm:way:17441757';
const DEFENSA = 'geo:osm-route:osm:way:1';

async function setup() {
  const catalog = Spike2Catalog.empty();
  catalog.store.recordGeoEntity(new GeographyResolutionAuthority(), DEST);
  const d = { catalog, osm: fakeOsm(), wikidata: fakeWikidata(), routes: fakeRoutes(), destination: DEST, destinationBoundary: CABA };
  await discoverAreas({ ...d, strategies: ['osm-admin-areas', 'osm-named-places', 'wikidata-area-facts'] });
  const st = catalog.snapshot().catalog.geoEntities[ST];
  await discoverPlaces({ ...d, strategies: ['osm-pois', 'wikidata-place-facts'] }, st);
  await discoverRoutes({ ...d, strategies: ['osm-routes'] }, st);
  catalog.store.recordGapOutcome(new GapOutcomeRecordingAuthority(), { gapKey: discoveryKey('AREA', DEST.id), outcome: 'SATISFIED', budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: 0, at: 't' });
  const memory = EvidenceMemory.empty();
  const deps = (v = verifier()) => ({ catalog, memory, tools, osm: fakeOsm(), wikidata: fakeWikidata(), verifier: v, policy: COMPOSITION_POLICY, destinationId: DEST.id, now: () => '2026-10-10T12:00:00Z' });
  return { catalog, memory, deps };
}

const q = (claimType: EvaluationQuestion['claimType'], candidateId: string, facetKey: string, extra: Partial<EvaluationQuestion> = {}): EvaluationQuestion => ({
  key: `Q|${claimType}|candidate=${candidateId}|facet=${facetKey}`, claimType, candidateId, facetKey, ...extra,
});
const answer = (question: EvaluationQuestion, captures: EvidenceCapture[], extra: Partial<ProposedAnswer> = {}): ProposedAnswer => ({
  questionKey: question.key, claimType: question.claimType, candidateId: question.candidateId, facetKey: question.facetKey, captures, origin: 'WEB_EVIDENCE', ...extra,
});
const AREA_QUOTE = "San Telmo is Buenos Aires' oldest barrio and the best place to understand the city’s colonial history.";

describe('grounding over offered ids (task 16.1)', () => {
  it('rejects NOT_OFFERED_CANDIDATE for an answer that names another candidate or an unoffered anchor', async () => {
    const { deps } = await setup();
    const question = q('RELEVANT_FOR', ST, 'theme:history');
    const r = await groundQuestion(deps(), question, [answer(question, [cap(ED, AREA_QUOTE)], { candidateId: 'geo:osm:relation:999' })]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'NOT_OFFERED_CANDIDATE' });
    const cq = q('WALKING_CORRIDOR', DEFENSA, 'intent:walk', { areaId: ST, anchorIds: [ST, LEZAMA] });
    const r2 = await groundQuestion(deps(), cq, [answer(cq, [cap(ED, 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama, passing antique shops and Plaza Dorrego.')], { fromId: PLAZA, toId: LEZAMA })]);
    expect(r2).toMatchObject({ status: 'REJECTED', reason: 'NOT_OFFERED_CANDIDATE' });
  });

  it('EVIDENCE_DOES_NOT_NAME_SUBJECT when the quote lacks every provider name of the subject', async () => {
    const { deps } = await setup();
    const question = q('RELEVANT_FOR', 'geo:osm:relation:2223070', 'theme:history'); // Recoleta
    const r = await groundQuestion(deps(), question, [answer(question, [cap(ED, AREA_QUOTE)])]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'EVIDENCE_DOES_NOT_NAME_SUBJECT' });
  });

  it('corridor bounded by offered anchors records ROUTE_CORRESPONDENCE (park touching Defensa)', async () => {
    const { deps, catalog } = await setup();
    const cq = q('WALKING_CORRIDOR', DEFENSA, 'intent:walk', { areaId: ST, anchorIds: [ST, PLAZA, LEZAMA] });
    const r = await groundQuestion(deps(), cq, [answer(cq, [cap(ED, 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama, passing antique shops and Plaza Dorrego.'), cap(BLOG, 'On Sundays we walked along Defensa from Plaza de Mayo to Parque Lezama, the classic San Telmo walk.')], { fromId: PLAZA, toId: LEZAMA })]);
    expect(r.status).toBe('AUTHORIZED');
    if (r.status === 'AUTHORIZED') {
      expect(r.routeCorrespondence?.map((x) => x.anchorId)).toEqual([PLAZA, LEZAMA]);
      expect(r.routeCorrespondence?.every((x) => x.meters <= COMPOSITION_POLICY.anchorOnRouteToleranceMeters)).toBe(true);
    }
    const a = Object.values(catalog.snapshot().catalog.assertions)[0];
    expect(a.subject).toMatchObject({ kind: 'CORRIDOR', corridor: { routeGeoEntityId: DEFENSA, boundKind: 'STATED_ANCHORS' } });
  });

  it('grounding writes no L1 entity', async () => {
    const { deps, catalog } = await setup();
    const before = Object.keys(catalog.snapshot().catalog.geoEntities).sort();
    const question = q('RELEVANT_FOR', ST, 'theme:history');
    await groundQuestion(deps(), question, [answer(question, [cap(ED, AREA_QUOTE)])]);
    expect(Object.keys(catalog.snapshot().catalog.geoEntities).sort()).toEqual(before);
    expect(Object.keys(catalog.snapshot().candidates).length).toBeGreaterThan(0);
  });

  it('structured facts map only through the versioned mapping; heritage corroborates a prose capture for history', async () => {
    const { deps, catalog } = await setup();
    const question = q('NOTABLE_WITHIN', PLAZA, 'theme:history', { areaId: ST });
    const structured = structuredCaptures(catalog.snapshot().candidates[PLAZA], question, 't');
    expect(structured.map((c) => (c.locator.kind === 'DATASET_RECORD' ? `${c.locator.dataset}:${c.locator.fieldPath}` : ''))).toEqual(expect.arrayContaining(['wikidata:P1435', 'openstreetmap:tag:historic']));
    expect(structuredCaptures(catalog.snapshot().candidates[PLAZA], q('NOTABLE_WITHIN', PLAZA, 'theme:food', { areaId: ST }), 't')).toEqual([]);
    expect(structuredCaptures(catalog.snapshot().candidates[DEFENSA], q('WALKING_CORRIDOR', DEFENSA, 'intent:walk'), 't')).toEqual([]);
    // Structured alone: never authorizes.
    const alone = await groundQuestion(deps(), question, [answer(question, structured, { origin: 'STRUCTURED_FACTS', areaId: ST })]);
    expect(alone).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' });
    // Structured + one prose capture from an unestablished publisher: authorized by independent corroboration.
    const pq = q('NOTABLE_WITHIN', PLAZA, 'theme:history', { areaId: ST });
    const both = await groundQuestion(deps(), pq, [
      answer(pq, structured, { origin: 'STRUCTURED_FACTS', areaId: ST }),
      answer(pq, [cap(BLOG, 'Plaza Dorrego is the historic heart of San Telmo, surrounded by colonial buildings.')], { areaId: ST }),
    ]);
    expect(both).toMatchObject({ status: 'AUTHORIZED', basis: 'INDEPENDENT_CORROBORATION' });
  });
});

describe('corroboration accumulation (task 16.2)', () => {
  it('one capture in run 1 becomes pending; an independent capture in run 2 authorizes', async () => {
    const { deps, memory, catalog } = await setup();
    const question = q('RELEVANT_FOR', ST, 'theme:history');
    const run1 = await groundQuestion(deps(), question, [answer(question, [cap(BLOG, 'San Telmo is full of history, cobbled streets and old colonial houses.')])]);
    expect(run1).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' });
    const retained = memory.retrieve(question.key, 't');
    expect(retained).toHaveLength(1);
    const run2 = await groundQuestion(deps(), question, [
      answer(question, retained, { origin: 'RESEARCH_MEMORY' }),
      answer(question, [{ ...cap(ED, AREA_QUOTE), locator: { kind: 'URL', url: ED } }]),
    ]);
    expect(run2.status).toBe('AUTHORIZED');
    expect(memory.stats().pendingQuestions).toBe(0);
    expect(Object.keys(catalog.snapshot().catalog.assertions)).toHaveLength(1);
  });

  it('an unreproducible retained capture does not count', async () => {
    const { deps, memory } = await setup();
    const question = q('RELEVANT_FOR', ST, 'theme:history');
    const gone = { ...cap(BLOG, 'San Telmo is full of history, cobbled streets and old colonial houses.'), locator: { kind: 'URL' as const, url: 'https://vanished.example/page' } };
    memory.addPending(question.key, [gone], 'INSUFFICIENT_CORROBORATION', 't');
    const r = await groundQuestion(deps(), question, [answer(question, memory.retrieve(question.key, 't'), { origin: 'RESEARCH_MEMORY' })]);
    expect(r).toMatchObject({ status: 'FAILED', reason: 'FETCH_UNAVAILABLE' });
  });

  it('other rejection reasons do not become pending', async () => {
    const { deps, memory } = await setup();
    const question = q('RELEVANT_FOR', ST, 'theme:history');
    await groundQuestion(deps(verifier(() => 'NONE')), question, [answer(question, [cap(ED, AREA_QUOTE)])]);
    expect(memory.stats().pendingQuestions).toBe(0);
  });

  it('sufficiency2: structured captures never authorize alone without a prose capture', () => {
    const structured = (id: string, dataset: string): EvidenceCapture => ({
      id, locator: { kind: 'DATASET_RECORD', dataset, recordId: 'r', fieldPath: 'f' }, retrievedAt: 't', contentFingerprint: 'f',
      capture: { kind: 'STRUCTURED_FIELD', values: { f: 'v' } }, registrableDomain: `dataset:${dataset}`, provenanceSignals: [{ kind: 'REPRODUCIBLE', refetchedAt: 't', fingerprintDrift: false }], supportVerdicts: [],
    });
    expect(sufficiency2([
      { capture: structured('a', 'wikidata'), level: 'EXPLICIT', structured: true, authorizesAlone: false },
      { capture: structured('b', 'openstreetmap'), level: 'EXPLICIT', structured: true, authorizesAlone: false },
    ])).toEqual({ status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' });
  });
});
