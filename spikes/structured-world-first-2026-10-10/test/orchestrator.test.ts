import { readFileSync } from 'fs';
import { join } from 'path';
import { Spike2Catalog } from '../src/catalog';
import { EvaluatorAgent } from '../src/evaluator';
import { EvidenceMemory } from '../src/memory';
import { generate2 } from '../src/orchestrator';
import { READINESS_POLICY_2 } from '../src/policy';
import { COMPOSITION_POLICY, FetchedDocument, GeographyResolutionAuthority, LlmPort, ProviderCallCounts, SpikePlanner, SupportVerifier, WebTools, claimStatement, documentFromHtml } from '../src/spike1';
import { CABA, DEST, FIXTURE_DESTINATION, REQUEST_A2, fakeOsm, fakeRoutes, fakeWikidata } from './fixtures/world2';

const ED = 'https://www.fixture-guide.example/san-telmo';
const BLOG = 'https://someone.blog-host.example/ba-notes';
const DOCS: Record<string, FetchedDocument> = {
  [ED]: documentFromHtml(ED, readFileSync(join(__dirname, 'fixtures/editorial-page.html'), 'utf8'), 't'),
  [BLOG]: documentFromHtml(BLOG, readFileSync(join(__dirname, 'fixtures/blog-page.html'), 'utf8'), 't'),
};

function harness() {
  const counts: Record<string, ProviderCallCounts> = {};
  const bump = (p: string) => { (counts[p] ??= { live: 0, replayed: 0, failed: 0 }).live += 1; };
  const tools: WebTools = {
    search: async () => { bump('serper'); return [{ title: 'Guide', url: ED, snippet: '' }]; },
    fetch: async (url) => { bump('web'); return DOCS[url]; },
  };
  const llm: LlmPort = {
    identity: { provider: 'scripted', model: 't' },
    async complete(prompt) {
      bump('llm');
      if (!prompt.includes('fetched d1')) return JSON.stringify({ action: 'fetch', url: ED });
      if (!prompt.includes('fetched d2')) return JSON.stringify({ action: 'fetch', url: BLOG });
      if (prompt.includes('answered')) return '{"action":"finish"}';
      const st = /(q\d+)\. AREA "San Telmo"/.exec(prompt)?.[1];
      const plaza = /(q\d+)\. PLACE "Plaza Dorrego"/.exec(prompt)?.[1];
      const walk = /(q\d+)\. street "Defensa"/.exec(prompt)?.[1];
      const anchor = (name: string) => new RegExp(`(a\\d+)=${name}`).exec(prompt)?.[1];
      const answers = [
        ...(st ? [{ question: st, evidence: [{ doc: 'd1', quote: "San Telmo is Buenos Aires' oldest barrio and the best place to understand the city’s colonial history." }, { doc: 'd2', quote: 'San Telmo is full of history, cobbled streets and old colonial houses.' }] }] : []),
        ...(plaza ? [{ question: plaza, evidence: [{ doc: 'd2', quote: 'Plaza Dorrego is the historic heart of San Telmo, surrounded by colonial buildings.' }] }] : []),
        ...(walk ? [{ question: walk, from: anchor('Plaza Dorrego'), to: anchor('Parque Lezama'), evidence: [{ doc: 'd1', quote: 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama, passing antique shops and Plaza Dorrego.' }] }] : []),
      ];
      return answers.length ? JSON.stringify({ action: 'answer', answers }) : '{"action":"finish"}';
    },
  };
  const verifier: SupportVerifier = { identity: { provider: 'fake', model: 'r' }, async judge(q, c) { bump('verifier'); void claimStatement(q); return { claimKey: q.claimKey, level: c.capture.kind === 'PROSE_SPAN' ? 'EXPLICIT' : 'NONE', verifier: { provider: 'fake', model: 'r' } }; } };
  const catalog = Spike2Catalog.empty();
  catalog.store.recordGeoEntity(new GeographyResolutionAuthority(), DEST);
  const input = {
    catalog, memory: EvidenceMemory.empty(), request: REQUEST_A2, destination: DEST, destinationBoundary: CABA,
    osm: fakeOsm(), wikidata: fakeWikidata(), routes: fakeRoutes(), evaluator: new EvaluatorAgent(tools, llm), verifier, tools,
    planner: new SpikePlanner(FIXTURE_DESTINATION), availability: {}, policy: READINESS_POLICY_2, compositionPolicy: COMPOSITION_POLICY,
    now: new Date('2026-10-10T12:00:00Z'), providerCounts: () => structuredClone(counts),
  };
  return { input, counts };
}

describe('generation orchestration, revision 2', () => {
  it('discovery runs first with zero LLM/search calls; research only evaluates candidates already in L1', async () => {
    const { input } = harness();
    const report = await generate2(input);
    expect(report.iterations[0].gap.type).toBe('AREA_CANDIDATES');
    expect(Object.keys(report.iterations[0].providerCallsDelta)).not.toEqual(expect.arrayContaining(['llm']));
    expect(report.iterations[0].providerCallsDelta.llm ?? 0).toBe(0);
    expect(report.iterations[0].providerCallsDelta.serper ?? 0).toBe(0);
    for (const it of report.iterations.filter((i) => i.offered)) {
      expect(it.offered?.every((o) => o.candidateExistedInL1BeforeResearch && o.candidateDiscoveredBy.length > 0)).toBe(true);
    }
    const kinds = report.iterations.map((i) => i.gap.type);
    expect(kinds.indexOf('PLACE_CANDIDATES')).toBeLessThan(kinds.indexOf('PLACE_RELEVANCE'));
    expect(kinds.indexOf('ROUTE_CANDIDATES')).toBeLessThan(kinds.indexOf('WALKING_CORRIDOR_RELEVANCE'));
  });

  it('route traces record policy version, selected strategies, which ran and their outcomes (task 12.2)', async () => {
    const { input } = harness();
    const report = await generate2(input);
    const meaning = report.iterations.find((i) => i.gap.type === 'AREA_RELEVANCE');
    expect(meaning?.route.policyVersion).toBe('routing-spike2-1');
    expect(meaning?.route.selected).toEqual(['structured-relevance-facts', 'research-memory', 'web-evidence']);
    expect(meaning?.route.runs.map((r) => r.strategyId)).toEqual(['structured-relevance-facts', 'research-memory', 'web-evidence']);
    expect(meaning?.route.runs.every((r) => ['SUCCESS', 'EMPTY', 'FAILED', 'SKIPPED'].includes(r.outcome))).toBe(true);
  });

  it('grounds San Telmo, a POI and the Defensa corridor in the fixture world; Defensa existed before corridor research', async () => {
    const { input } = harness();
    const report = await generate2(input);
    const assertions = Object.values(input.catalog.snapshot().catalog.assertions);
    expect(assertions.some((a) => a.claimType === 'RELEVANT_FOR' && a.subject.kind === 'GEO_ENTITY' && a.subject.geoEntityId === 'geo:osm:relation:2223069')).toBe(true);
    expect(assertions.some((a) => a.claimType === 'NOTABLE_WITHIN')).toBe(true);
    const corridorIt = report.iterations.find((i) => i.gap.type === 'WALKING_CORRIDOR_RELEVANCE');
    const routeIt = report.iterations.find((i) => i.gap.type === 'ROUTE_CANDIDATES');
    expect(routeIt && corridorIt && routeIt.index < corridorIt.index).toBe(true);
    expect(corridorIt?.offered?.[0]).toMatchObject({ candidateName: 'Defensa', candidateExistedInL1BeforeResearch: true });
    expect(report.result.status).toBe('TOUR');
  });

  it('a meaning gap with the same key is re-attempted for its next unevaluated candidates', async () => {
    const { input } = harness();
    const report = await generate2({ ...input, request: { ...input.request, thematicFacets: ['theme:food'], experienceFormatFacets: [] }, policy: { ...input.policy, offerPerExecution: { areas: 1, places: 1, routes: 1 } } });
    const foodAttempts = report.iterations.filter((i) => i.gap.type === 'AREA_RELEVANCE');
    expect(foodAttempts.length).toBeGreaterThan(1);
    const offered = foodAttempts.flatMap((i) => i.offered?.map((o) => o.questionKey) ?? []);
    expect(new Set(offered).size).toBe(offered.length);
  });

  it('structured provider outage: discovery FAILED, no web strategy, explicit insufficient result', async () => {
    const { input, counts } = harness();
    const report = await generate2({ ...input, availability: { 'osm-overpass': false, 'wikidata-sparql': false } });
    expect(report.iterations[0]).toMatchObject({ gapOutcome: 'FAILED' });
    expect(report.iterations[0].route.selected).toEqual([]);
    expect(counts.llm).toBeUndefined();
    expect(report.result.status).toBe('INSUFFICIENT_KNOWLEDGE');
  });
});
