import { readFileSync } from 'fs';
import { join } from 'path';
import { KnowledgeGap } from '../src/contracts';
import { READINESS_POLICY } from '../src/policy';
import { PERMITTED_CLAIM_TYPES, ResearchAgent } from '../src/research/agent';
import { documentFromHtml } from '../src/research/documents';
import { LlmPort } from '../src/research/llm';
import { CatalogExcerpt, WebTools } from '../src/research/tools';
import { worldStore } from './fixtures/world';

const URL = 'https://www.fixture-guide.example/san-telmo';
const doc = documentFromHtml(URL, readFileSync(join(__dirname, 'fixtures/editorial-page.html'), 'utf8'), '2026-10-10T00:00:00Z');

const gap = (type: KnowledgeGap['type'], extra: Partial<KnowledgeGap> = {}): KnowledgeGap => ({
  key: `${type}|scope=x|facet=theme:history`, type, scopeGeoEntityId: 'x', facetKey: 'theme:history', threshold: 1, observed: 0,
  knownAreaIds: [], relevantAreaIds: [], ...extra,
});

const excerpt = (extra: Partial<CatalogExcerpt> = {}): CatalogExcerpt => ({
  destinationName: 'Buenos Aires', gap: { type: 'AREA_RELEVANCE', facet: 'theme:history', scopeName: 'Buenos Aires' },
  knownRelevantAreas: [], excludedAreas: [], knownPlacesInScope: [], knownCorridors: [], ...extra,
});

function scriptedLlm(replies: string[]): LlmPort & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    identity: { provider: 'scripted', model: 'test' },
    prompts,
    async complete(prompt) {
      prompts.push(prompt);
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
}

function fakeTools(overrides: Partial<WebTools> = {}): WebTools & { fetch: jest.Mock; search: jest.Mock } {
  return {
    search: jest.fn().mockResolvedValue([{ title: 'Guide', url: URL, snippet: 'San Telmo history' }]),
    fetch: jest.fn().mockResolvedValue(doc),
    ...overrides,
  } as WebTools & { fetch: jest.Mock; search: jest.Mock };
}

const budget = { maxRounds: 6, maxSearches: 2, maxFetches: 2 };
const run = (agent: ResearchAgent, g: KnowledgeGap, e = excerpt()) => agent.research({ gap: g, excerpt: e, budget, snapshotEpoch: 7 });

const proposeArea = JSON.stringify({
  action: 'propose',
  claims: [{
    claimType: 'RELEVANT_FOR', subject: 'San Telmo', themes: ['history'], authorityClass: 'official tourism authority',
    evidence: [{ doc: 'd1', quote: "San Telmo is Buenos Aires' oldest barrio and the best place to understand the city’s colonial history." }],
  }],
});

describe('bounded research agent (task 4.2)', () => {
  it('has no store write access: proposes claims, catalog unchanged', async () => {
    const store = worldStore();
    const before = store.snapshot();
    const agent = new ResearchAgent(fakeTools(), scriptedLlm([
      '{"action":"search","query":"San Telmo history"}', `{"action":"fetch","url":"${URL}"}`, proposeArea, '{"action":"finish"}',
    ]));
    const outcome = await run(agent, gap('AREA_RELEVANCE'));
    expect(outcome.kind).toBe('CLAIMS_PROPOSED');
    expect(outcome.claims).toHaveLength(1);
    expect(outcome.claims[0]).toMatchObject({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', proposedAuthorityClass: 'official tourism authority' });
    expect(outcome.claims[0].captures[0].capture.kind).toBe('PROSE_SPAN');
    expect(store.snapshot()).toEqual(before);
    expect(ResearchAgent.length).toBe(2); // constructor(tools, llm): no store parameter
  });

  it('prompt carries epistemic rules and no website list', async () => {
    const llm = scriptedLlm(['{"action":"finish"}']);
    await run(new ResearchAgent(fakeTools(), llm), gap('AREA_RELEVANCE'));
    expect(llm.prompts[0]).toContain('There is no list of preferred sites');
    expect(llm.prompts[0]).not.toMatch(/wikivoyage|turismo\.buenosaires|lonelyplanet|tripadvisor|wikipedia/i);
  });

  it('discards claims without a verifiable capture', async () => {
    const agent = new ResearchAgent(fakeTools(), scriptedLlm([
      `{"action":"fetch","url":"${URL}"}`,
      JSON.stringify({ action: 'propose', claims: [
        { claimType: 'RELEVANT_FOR', subject: 'La Boca', themes: ['history'], evidence: [{ doc: 'd1', quote: 'La Boca is the most historic barrio of all of them' }] },
        { claimType: 'RELEVANT_FOR', subject: 'Palermo', themes: ['history'] },
      ] }),
      '{"action":"finish"}',
    ]));
    const outcome = await run(agent, gap('AREA_RELEVANCE'));
    expect(outcome.claims).toHaveLength(0);
    expect(outcome.discarded.map((d) => d.reason)).toEqual(['NO_CAPTURE', 'NO_CAPTURE']);
    expect(outcome.kind).toBe('NO_EVIDENCE_FOUND');
  });

  it('discards claim types not permitted for the gap', async () => {
    expect(PERMITTED_CLAIM_TYPES).toEqual({
      AREA_RELEVANCE: ['RELEVANT_FOR'], NOTABLE_PLACES: ['NOTABLE_WITHIN', 'RELEVANT_FOR'],
      WALKING_CORRIDOR: ['WALKING_CORRIDOR'], SCHEDULE_CAPACITY: ['RELEVANT_FOR'],
    });
    const agent = new ResearchAgent(fakeTools(), scriptedLlm([
      `{"action":"fetch","url":"${URL}"}`,
      JSON.stringify({ action: 'propose', claims: [{ claimType: 'WALKING_CORRIDOR', subject: 'Defensa', evidence: [{ doc: 'd1', quote: 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama' }] }] }),
      '{"action":"finish"}',
    ]));
    const outcome = await run(agent, gap('AREA_RELEVANCE'));
    expect(outcome.discarded).toEqual([{ reason: 'CLAIM_TYPE_NOT_PERMITTED', claim: { claimType: 'WALKING_CORRIDOR', subjectMention: 'Defensa' } }]);
  });

  it('SCHEDULE_CAPACITY proposes only areas not already known', async () => {
    const agent = new ResearchAgent(fakeTools(), scriptedLlm([`{"action":"fetch","url":"${URL}"}`, proposeArea, '{"action":"finish"}']));
    const outcome = await run(agent, gap('SCHEDULE_CAPACITY', { knownAreaIds: ['geo-san-telmo'] }), excerpt({ excludedAreas: ['San Telmo'] }));
    expect(outcome.claims).toHaveLength(0);
    expect(outcome.discarded.map((d) => d.reason)).toEqual(['EXCLUDED_SUBJECT']);
  });

  it('enforces budgets in the loop and reports BUDGET_EXHAUSTED', async () => {
    const tools = fakeTools();
    const agent = new ResearchAgent(tools, scriptedLlm(['{"action":"search","query":"q"}']));
    const outcome = await run(agent, gap('AREA_RELEVANCE'));
    expect(tools.search).toHaveBeenCalledTimes(budget.maxSearches);
    expect(outcome.kind).toBe('BUDGET_EXHAUSTED');
    expect(outcome.budgetUsed).toEqual({ rounds: budget.maxRounds, searches: budget.maxSearches, fetches: 0 });
  });

  it('reports TOOL_FAILURE when every search fails', async () => {
    const tools = fakeTools({ search: jest.fn().mockRejectedValue(new Error('provider down')) });
    const agent = new ResearchAgent(tools, scriptedLlm(['{"action":"search","query":"q"}', '{"action":"finish"}']));
    const outcome = await run(agent, gap('AREA_RELEVANCE'));
    expect(outcome.kind).toBe('TOOL_FAILURE');
  });

  it('reports TOOL_FAILURE when the LLM is unavailable', async () => {
    const llm: LlmPort = { identity: { provider: 'x', model: 'y' }, complete: () => Promise.reject(new Error('quota')) };
    const outcome = await run(new ResearchAgent(fakeTools(), llm), gap('AREA_RELEVANCE'));
    expect(outcome.kind).toBe('TOOL_FAILURE');
    expect(outcome.failure).toContain('quota');
  });

  it('the policy budget is what production runs use', () => {
    expect(READINESS_POLICY.researchBudgetPerGap).toEqual({ maxRounds: 12, maxSearches: 4, maxFetches: 6 });
  });
});

describe('in-document find tool', () => {
  it('returns matching sentences of a fetched document so the agent can quote passages beyond the preview', async () => {
    const llm = scriptedLlm([`{"action":"fetch","url":"${URL}"}`, '{"action":"find","doc":"d1","terms":["Mercado"]}', '{"action":"finish"}']);
    await run(new ResearchAgent(fakeTools(), llm), gap('NOTABLE_PLACES'));
    expect(llm.prompts[2]).toContain('find in d1 [Mercado] -> 1 sentence(s)');
    expect(llm.prompts[2]).toContain('> The Mercado de San Telmo, built in 1897, is a covered market full of food stalls and antiques.');
  });
});

describe('research outcome reporting (task 4.3)', () => {
  it('returns gap key, budget used and snapshot epoch; the ledger is unchanged after research', async () => {
    const store = worldStore();
    const agent = new ResearchAgent(fakeTools(), scriptedLlm(['{"action":"search","query":"q"}', '{"action":"finish"}']));
    const outcome = await run(agent, gap('AREA_RELEVANCE'));
    expect(outcome).toMatchObject({ gapKey: 'AREA_RELEVANCE|scope=x|facet=theme:history', kind: 'NO_EVIDENCE_FOUND', snapshotEpoch: 7 });
    expect(outcome.budgetUsed).toEqual({ rounds: 2, searches: 1, fetches: 0 });
    expect(store.snapshot().ledger).toEqual({});
  });
});
