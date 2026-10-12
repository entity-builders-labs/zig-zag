import { generate } from '../src/orchestrator';
import { SpikePlanner } from '../src/planner';
import { COMPOSITION_POLICY, READINESS_POLICY } from '../src/policy';
import { ResearchAgent } from '../src/research/agent';
import { LlmPort } from '../src/research/llm';
import { URLS, fakeResolver, fakeTools, fakeVerifier } from './fixtures/grounding-fakes';
import { DEST_ID, ENTITIES, FIXTURE_DESTINATION, REQUEST_A, worldStore } from './fixtures/world';

const AREA = "San Telmo is Buenos Aires' oldest barrio and the best place to understand the city’s colonial history.";
const WALK = 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama, passing antique shops and Plaza Dorrego.';
const MARKET = 'The Mercado de San Telmo, built in 1897, is a covered market full of food stalls and antiques.';

/** Scripted agent replies keyed by gap type (fake LLM; real loop). */
function scriptedLlm(): LlmPort & { calls: number } {
  const byGap: Record<string, string> = {
    AREA_RELEVANCE: JSON.stringify({ action: 'propose', claims: [{ claimType: 'RELEVANT_FOR', subject: 'San Telmo', themes: ['history', 'food'], evidence: [{ doc: 'd1', quote: AREA }] }] }),
    NOTABLE_PLACES: JSON.stringify({ action: 'propose', claims: [
      { claimType: 'NOTABLE_WITHIN', subject: 'Plaza Dorrego', area: 'San Telmo', themes: ['history', 'food'], evidence: [{ doc: 'd1', quote: WALK }] },
      { claimType: 'NOTABLE_WITHIN', subject: 'Mercado de San Telmo', area: 'San Telmo', themes: ['history', 'food'], evidence: [{ doc: 'd1', quote: MARKET }] },
    ] }),
    WALKING_CORRIDOR: JSON.stringify({ action: 'propose', claims: [{ claimType: 'WALKING_CORRIDOR', subject: 'Calle Defensa', from: 'Plaza de Mayo', to: 'Parque Lezama', themes: ['history'], evidence: [{ doc: 'd1', quote: WALK }] }] }),
    SCHEDULE_CAPACITY: '{"action":"finish"}',
  };
  const llm = {
    calls: 0,
    identity: { provider: 'scripted', model: 'orchestrator-test' },
    async complete(prompt: string) {
      llm.calls += 1;
      if (!prompt.includes('step 1: fetched')) return `{"action":"fetch","url":"${URLS.editorial}"}`;
      if (prompt.includes('proposed')) return '{"action":"finish"}';
      const type = Object.keys(byGap).find((t) => prompt.includes(t === 'AREA_RELEVANCE' ? 'neighbourhoods/areas' : t === 'NOTABLE_PLACES' ? 'specific places inside' : t === 'WALKING_CORRIDOR' ? 'tourist walking route' : 'additional areas'));
      return byGap[type ?? 'SCHEDULE_CAPACITY'];
    },
  };
  return llm;
}

const run = (store = worldStore([DEST_ID]), llm = scriptedLlm()) =>
  generate({
    store, request: REQUEST_A, destination: ENTITIES[DEST_ID],
    agent: new ResearchAgent(fakeTools(), llm),
    grounding: { tools: fakeTools(), resolver: fakeResolver(), verifier: fakeVerifier(() => 'EXPLICIT'), policy: COMPOSITION_POLICY, now: () => '2026-10-10T12:00:00Z' },
    planner: new SpikePlanner(FIXTURE_DESTINATION),
    readinessPolicy: READINESS_POLICY, compositionPolicy: COMPOSITION_POLICY, now: new Date('2026-10-10T12:00:00Z'),
  }).then((report) => ({ report, llm, store }));

describe('generation orchestration (supports task 8)', () => {
  it('discovers San Telmo from a destination-level gap, then fills area-scoped and corridor gaps, then plans', async () => {
    const { report, store } = await run();
    const order = report.iterations.map((i) => i.gap.type);
    expect(order.slice(0, 2)).toEqual(['AREA_RELEVANCE', 'NOTABLE_PLACES']);
    expect(order).toContain('WALKING_CORRIDOR');
    expect(Object.keys(store.snapshot().experiences)).toContain('CORRIDOR_WALK|route=geo-defensa|from=geo:geo-parque-lezama|to=geo:geo-plaza-de-mayo');
    expect(report.tour.status).toBe('COMPOSED');
    expect(report.finalEpoch).toBe(store.epoch);
  });

  it('a second request over the same catalog performs zero research for satisfied gaps', async () => {
    const first = await run();
    const satisfied = first.report.iterations.filter((i) => i.ledger.outcome === 'SATISFIED').map((i) => i.gap.key);
    const second = await run(first.store);
    const researchedAgain = second.report.iterations.map((i) => i.gap.key).filter((k) => satisfied.includes(k));
    expect(researchedAgain).toEqual([]);
    const keysBefore = Object.keys(first.store.snapshot().experiences).sort();
    expect(Object.keys(second.store.snapshot().experiences).sort()).toEqual(keysBefore);
  });
});
