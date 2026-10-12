import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Spike2Catalog, discoveryKey } from '../src/catalog';
import { Gap2 } from '../src/contracts';
import { discoverAreas, discoverPlaces, discoverRoutes } from '../src/discovery';
import { EvaluatorAgent, offerQuestions } from '../src/evaluator';
import { EvidenceMemory } from '../src/memory';
import { READINESS_POLICY_2 } from '../src/policy';
import { evaluateReadiness2 } from '../src/readiness';
import { GapOutcomeRecordingAuthority, GeographyResolutionAuthority, LlmPort, WebTools, captureFromQuote, documentFromHtml } from '../src/spike1';
import { CABA, DEST, REQUEST_A2, fakeOsm, fakeRoutes, fakeWikidata } from './fixtures/world2';

const URL = 'https://www.fixture-guide.example/san-telmo';
const doc = documentFromHtml(URL, readFileSync(join(__dirname, 'fixtures/editorial-page.html'), 'utf8'), '2026-10-10T00:00:00Z');
const ST = 'geo:osm:relation:2223069';

async function world() {
  const catalog = Spike2Catalog.empty();
  catalog.store.recordGeoEntity(new GeographyResolutionAuthority(), DEST);
  const d = { catalog, osm: fakeOsm(), wikidata: fakeWikidata(), routes: fakeRoutes(), destination: DEST, destinationBoundary: CABA };
  await discoverAreas({ ...d, strategies: ['osm-admin-areas', 'osm-named-places', 'wikidata-area-facts'] });
  const st = catalog.snapshot().catalog.geoEntities[ST];
  await discoverPlaces({ ...d, strategies: ['osm-pois'] }, st);
  await discoverRoutes({ ...d, strategies: ['osm-routes'] }, st);
  const rec = new GapOutcomeRecordingAuthority();
  for (const [k, s] of [['AREA', DEST.id], ['PLACE', ST], ['ROUTE', ST]] as const) catalog.store.recordGapOutcome(rec, { gapKey: discoveryKey(k, s), outcome: 'SATISFIED', budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: 0, at: '2026-10-10T00:00:00Z' });
  return catalog;
}

const areaGap: Gap2 = {
  key: 'AREA_RELEVANCE|scope=d|facet=theme:history', type: 'AREA_RELEVANCE', kind: 'MEANING', scopeId: DEST.id, facetKey: 'theme:history', threshold: 1, observed: 0,
  questions: [{ key: `Q|RELEVANT_FOR|candidate=${ST}|facet=theme:history`, claimType: 'RELEVANT_FOR', candidateId: ST, facetKey: 'theme:history' }],
};

function scripted(replies: string[]): LlmPort & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return { identity: { provider: 'scripted', model: 't' }, prompts, async complete(p) { prompts.push(p); return replies[Math.min(i++, replies.length - 1)]; } };
}
const tools: WebTools = { search: async () => [{ title: 'Guide', url: URL, snippet: 's' }], fetch: async () => doc };
const budget = { maxRounds: 6, maxSearches: 2, maxFetches: 2 };

describe('Research Evidence Memory (task 15.1)', () => {
  it('retains pending captures per question in its own file and records reuse', () => {
    const memory = EvidenceMemory.empty();
    const capture = captureFromQuote(doc, "San Telmo is Buenos Aires' oldest barrio", 'fixture-guide.example');
    memory.addPending('Q|x', capture ? [capture] : [], 'INSUFFICIENT_CORROBORATION', 't1');
    memory.addPending('Q|x', capture ? [capture] : [], 'INSUFFICIENT_CORROBORATION', 't2');
    expect(memory.retrieve('Q|x', 't3')).toHaveLength(1);
    expect(memory.stats()).toMatchObject({ pendingQuestions: 1, pendingCaptures: 1, reuseEvents: 1 });
    const path = join(mkdtempSync(join(tmpdir(), 'mem-')), 'memory.json');
    memory.save(path);
    expect(EvidenceMemory.load(path).stats().pendingCaptures).toBe(1);
  });

  it('memory content never changes readiness (it is not an input)', async () => {
    const catalog = await world();
    const before = await evaluateReadiness2({ snapshot: catalog.snapshot(), request: REQUEST_A2, destinationId: DEST.id, policy: READINESS_POLICY_2, now: new Date('2026-10-10T12:00:00Z') });
    const memory = EvidenceMemory.empty();
    memory.addPending(areaGap.questions[0].key, [], 'INSUFFICIENT_CORROBORATION', 't');
    const after = await evaluateReadiness2({ snapshot: catalog.snapshot(), request: REQUEST_A2, destinationId: DEST.id, policy: READINESS_POLICY_2, now: new Date('2026-10-10T12:00:00Z') });
    expect(after).toEqual(before);
  });
});

describe('evaluator agent over offered candidates (task 15.2)', () => {
  it('prompt lists only offered candidates with provider names, and no request to find new entities', async () => {
    const catalog = await world();
    const llm = scripted(['{"action":"finish"}']);
    const agent = new EvaluatorAgent(tools, llm);
    await agent.evaluate({ gap: areaGap, offered: offerQuestions(catalog.snapshot(), areaGap), destinationName: 'Buenos Aires', budget, now: () => 't' });
    expect(llm.prompts[0]).toContain('q1. AREA "San Telmo" / "Barrio de San Telmo"');
    expect(llm.prompts[0]).toContain('Evaluate ONLY the candidates listed below');
    expect(llm.prompts[0]).not.toMatch(/Recoleta|Palermo|Find (neighbourhoods|specific places|streets)/);
    expect(llm.prompts[0]).not.toMatch(/wikivoyage|lonelyplanet|turismo\.buenosaires/i);
  });

  it('an answer about an unoffered entity is discarded and stored as a mention; unlisted names are mentions', async () => {
    const catalog = await world();
    const agent = new EvaluatorAgent(tools, scripted([
      `{"action":"fetch","url":"${URL}"}`,
      JSON.stringify({ action: 'answer', answers: [
        { question: 'q1', subject: 'La Boca', evidence: [{ doc: 'd1', quote: "San Telmo is Buenos Aires' oldest barrio" }] },
        { question: 'q1', evidence: [{ doc: 'd1', quote: "San Telmo is Buenos Aires' oldest barrio and the best place to understand the city’s colonial history." }] },
        { question: 'q9', evidence: [] },
      ], unlisted: [{ name: 'Microcentro', note: 'mentioned as historic' }] }),
      '{"action":"finish"}',
    ]));
    const out = await agent.evaluate({ gap: areaGap, offered: offerQuestions(catalog.snapshot(), areaGap), destinationName: 'Buenos Aires', budget, now: () => 't' });
    expect(out.discarded.map((d) => d.reason)).toEqual(['NOT_OFFERED_CANDIDATE', 'UNKNOWN_QUESTION']);
    expect(out.mentions.map((m) => m.name).sort()).toEqual(['La Boca', 'Microcentro']);
    expect(out.answers).toHaveLength(1);
    expect(out.answers[0]).toMatchObject({ questionKey: areaGap.questions[0].key, candidateId: ST, facetKey: 'theme:history', origin: 'WEB_EVIDENCE' });
  });

  it('from/to/area on a non-street question are ignored, not treated as unoffered entities', async () => {
    const catalog = await world();
    const agent = new EvaluatorAgent(tools, scripted([
      `{"action":"fetch","url":"${URL}"}`,
      JSON.stringify({ action: 'answer', answers: [{ question: 'q1', from: '0', to: '1', area: 'San Telmo', evidence: [{ doc: 'd1', quote: "San Telmo is Buenos Aires' oldest barrio and the best place to understand the city\u2019s colonial history." }] }] }),
      '{"action":"finish"}',
    ]));
    const out = await agent.evaluate({ gap: areaGap, offered: offerQuestions(catalog.snapshot(), areaGap), destinationName: 'Buenos Aires', budget, now: () => 't' });
    expect(out.discarded).toEqual([]);
    expect(out.mentions).toEqual([]);
    expect(out.answers).toHaveLength(1);
    expect(out.answers[0].fromId).toBeUndefined();
  });

  it('corridor anchors must come from the offered anchor list', async () => {
    const catalog = await world();
    const snapshot = catalog.snapshot();
    const v = await evaluateReadiness2({ snapshot, request: REQUEST_A2, destinationId: DEST.id, policy: READINESS_POLICY_2, now: new Date('2026-10-10T12:00:00Z') });
    expect(v.verdict).toBe('GAPS');
    const corridorGap: Gap2 = {
      key: 'WALKING_CORRIDOR_RELEVANCE|scope=st', type: 'WALKING_CORRIDOR_RELEVANCE', kind: 'MEANING', scopeId: ST, facetKey: 'intent:walk', threshold: 1, observed: 0,
      questions: [{ key: 'Q|WALKING_CORRIDOR|candidate=geo:osm-route:osm:way:1|facet=intent:walk', claimType: 'WALKING_CORRIDOR', candidateId: 'geo:osm-route:osm:way:1', facetKey: 'intent:walk', areaId: ST, anchorIds: [ST, 'geo:osm:way:17441757', 'geo:osm:way:31364659'] }],
    };
    const offered = offerQuestions(snapshot, corridorGap);
    const quote = 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama, passing antique shops and Plaza Dorrego.';
    const agent = new EvaluatorAgent(tools, scripted([
      `{"action":"fetch","url":"${URL}"}`,
      JSON.stringify({ action: 'answer', answers: [
        { question: 'q1', from: 'a9', to: 'a1', evidence: [{ doc: 'd1', quote }] },
        { question: 'q1', area: 'a0', evidence: [{ doc: 'd1', quote }] },
      ] }),
      '{"action":"finish"}',
    ]));
    const out = await agent.evaluate({ gap: corridorGap, offered, destinationName: 'Buenos Aires', budget, now: () => 't' });
    expect(out.discarded).toEqual([{ reason: 'NOT_OFFERED_CANDIDATE', detail: 'anchor a9' }]);
    expect(out.answers[0]).toMatchObject({ claimType: 'WALKING_CORRIDOR', areaId: ST });
    expect(out.answers[0].fromId).toBeUndefined();
  });
});
