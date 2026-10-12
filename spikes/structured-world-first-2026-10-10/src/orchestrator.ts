import { OsmCandidate } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { OsmStructuredAdapter, WikidataFactsAdapter } from './adapters/structured';
import { Spike2Catalog, discoveryKey } from './catalog';
import { EvaluatorOutcome, Gap2, Grounding2Result, Limitation, ProposedAnswer, Verdict2 } from './contracts';
import { DiscoveryOutcome, discoverAreas, discoverPlaces, discoverRoutes } from './discovery';
import { EvaluatorAgent, offerQuestions } from './evaluator';
import { groundQuestion, structuredCaptures } from './grounding';
import { EvidenceMemory } from './memory';
import { ReadinessPolicy2 } from './policy';
import { CapacityProbe2, evaluateReadiness2 } from './readiness';
import { ProviderAvailability, RouteTrace, StrategyRun, newRouteTrace, routeGap } from './routing';
import {
  CompositionPolicy,
  GapOutcome,
  GapOutcomeRecordingAuthority,
  GeoEntityRef,
  InterpretedRequest,
  OsmGeoResolver,
  PlannerPort,
  ProviderCallCounts,
  RecompositionReport,
  SupportVerifier,
  TourComposition,
  WebTools,
  composeTour,
  recompose,
} from './spike1';

const OUTCOMES = new GapOutcomeRecordingAuthority();

export interface OfferedTrace {
  questionKey: string;
  claimType: string;
  candidateId: string;
  candidateName: string;
  facetKey: string;
  candidateExistedInL1BeforeResearch: boolean;
  candidateDiscoveredBy: string[];
}

export interface Iteration2 {
  index: number;
  gap: Pick<Gap2, 'key' | 'type' | 'kind' | 'scopeId' | 'facetKey' | 'lineage'>;
  route: RouteTrace;
  discovery?: DiscoveryOutcome;
  offered?: OfferedTrace[];
  structuredCaptures?: number;
  memoryCapturesRetrieved?: number;
  evaluator?: Omit<EvaluatorOutcome, 'answers'> & { answers: number };
  grounding?: Grounding2Result[];
  questionOutcomes?: Record<string, GapOutcome>;
  gapOutcome: GapOutcome;
  recomposition: RecompositionReport;
  providerCallsDelta: Record<string, number>;
}

export interface GenerationReport2 {
  readinessChecks: Array<{ epoch: number; verdict: Verdict2['verdict']; gapKeys: string[]; limitationKeys: string[] }>;
  iterations: Iteration2[];
  finalVerdict: Verdict2['verdict'];
  stoppedBecause: 'READY' | 'INSUFFICIENT_KNOWLEDGE' | 'GAP_BUDGET_EXHAUSTED' | 'ONLY_ATTEMPTED_GAPS_REMAIN';
  limitations: Limitation[];
  result: { status: 'TOUR'; tour: TourComposition } | { status: 'INSUFFICIENT_KNOWLEDGE'; limitations: Limitation[] };
}

export interface Generate2Input {
  catalog: Spike2Catalog;
  memory: EvidenceMemory;
  request: InterpretedRequest;
  destination: GeoEntityRef;
  destinationBoundary: OsmCandidate;
  osm: OsmStructuredAdapter;
  wikidata: WikidataFactsAdapter;
  routes: OsmGeoResolver;
  evaluator: EvaluatorAgent;
  verifier: SupportVerifier;
  tools: WebTools;
  planner: PlannerPort & { capacityProbe(): (snapshot: ReturnType<Spike2Catalog['snapshot']>['catalog'], request: InterpretedRequest) => ReturnType<CapacityProbe2> };
  availability: ProviderAvailability;
  policy: ReadinessPolicy2;
  compositionPolicy: CompositionPolicy;
  now: Date;
  providerCounts: () => Record<string, ProviderCallCounts>;
  log?: (event: string, data: unknown) => void;
}

function totals(counts: Record<string, ProviderCallCounts>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.live + v.replayed + v.failed]));
}

function delta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[k] ?? 0) - (before[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

const discoveryLedger = (status: DiscoveryOutcome['status']): GapOutcome => (status === 'SUCCESS' ? 'SATISFIED' : status === 'EMPTY' ? 'INSUFFICIENT_EVIDENCE' : 'FAILED');

/**
 * One generation, revision 2: structured world first. Discovery gaps run
 * only structured strategies; meaning gaps run structured facts, evidence
 * memory, then the evaluator over offered canonical candidates.
 */
export async function generate2(input: Generate2Input): Promise<GenerationReport2> {
  const { catalog, memory, request, destination } = input;
  const log = input.log ?? (() => undefined);
  const nowIso = () => input.now.toISOString();
  const capacityProbe: CapacityProbe2 = (snapshot, req) => input.planner.capacityProbe()(snapshot.catalog, req);
  const readinessChecks: GenerationReport2['readinessChecks'] = [];
  const iterations: Iteration2[] = [];
  const attempted = new Set<string>();
  let verdict: Verdict2;
  let stoppedBecause: GenerationReport2['stoppedBecause'];

  for (;;) {
    const snapshot = catalog.snapshot();
    verdict = await evaluateReadiness2({ snapshot, request, destinationId: destination.id, policy: input.policy, now: input.now, capacityProbe });
    readinessChecks.push({
      epoch: snapshot.catalog.epoch, verdict: verdict.verdict,
      gapKeys: verdict.verdict === 'GAPS' ? verdict.gaps.map((g) => g.key) : [], limitationKeys: verdict.limitations.map((l) => l.key),
    });
    log('readiness', readinessChecks[readinessChecks.length - 1]);
    if (verdict.verdict !== 'GAPS') { stoppedBecause = verdict.verdict; break; }
    // Discovery gaps are attempted once per generation; meaning gaps once per evaluation question.
    const fresh = (g: Gap2) => (g.kind === 'DISCOVERY' ? !attempted.has(g.key) : g.questions.some((q) => !attempted.has(q.key)));
    const gap = verdict.gaps.find(fresh);
    if (!gap) { stoppedBecause = 'ONLY_ATTEMPTED_GAPS_REMAIN'; break; }
    if (iterations.length >= input.policy.maxGapsPerGeneration) { stoppedBecause = 'GAP_BUDGET_EXHAUSTED'; break; }
    attempted.add(gap.key);
    for (const q of gap.questions) attempted.add(q.key);

    const before = totals(input.providerCounts());
    const decision = routeGap(gap, input.availability);
    const route = newRouteTrace(gap, decision);
    const selected = decision.strategies.map((s) => s.id);
    const iteration: Partial<Iteration2> = { index: iterations.length + 1, gap: { key: gap.key, type: gap.type, kind: gap.kind, scopeId: gap.scopeId, ...(gap.facetKey ? { facetKey: gap.facetKey } : {}), ...(gap.lineage ? { lineage: gap.lineage } : {}) }, route };
    let gapOutcome: GapOutcome;

    if (gap.kind === 'DISCOVERY') {
      const deps = { catalog, osm: input.osm, wikidata: input.wikidata, routes: input.routes, destination, destinationBoundary: input.destinationBoundary, strategies: selected };
      let outcome: DiscoveryOutcome;
      if (selected.length === 0) {
        outcome = { kind: gap.type === 'AREA_CANDIDATES' ? 'AREA' : gap.type === 'PLACE_CANDIDATES' ? 'PLACE' : 'ROUTE', scopeId: gap.scopeId, status: 'FAILED', acquired: 0, candidateIds: [], excluded: [], runs: [] };
      } else {
        const scope = catalog.snapshot().catalog.geoEntities[gap.scopeId];
        outcome = gap.type === 'AREA_CANDIDATES' ? await discoverAreas(deps) : gap.type === 'PLACE_CANDIDATES' ? await discoverPlaces(deps, scope) : await discoverRoutes(deps, scope);
      }
      route.runs.push(...outcome.runs);
      gapOutcome = discoveryLedger(outcome.status);
      catalog.store.recordGapOutcome(OUTCOMES, { gapKey: discoveryKey(outcome.kind, gap.scopeId), outcome: gapOutcome, budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: catalog.store.epoch, at: nowIso() });
      iteration.discovery = outcome;
      log('discovery', { gap: gap.key, status: outcome.status, acquired: outcome.acquired, candidates: outcome.candidateIds.length, excluded: outcome.excluded.length });
    } else {
      const offeredSnapshot = catalog.snapshot();
      iteration.offered = gap.questions.map((q) => ({
        questionKey: q.key, claimType: q.claimType, candidateId: q.candidateId,
        candidateName: offeredSnapshot.catalog.geoEntities[q.candidateId]?.name ?? q.candidateId, facetKey: q.facetKey,
        candidateExistedInL1BeforeResearch: !!offeredSnapshot.catalog.geoEntities[q.candidateId],
        candidateDiscoveredBy: offeredSnapshot.candidates[q.candidateId]?.discoveredBy.strategies ?? [],
      }));
      const answers = new Map<string, ProposedAnswer[]>(gap.questions.map((q): [string, ProposedAnswer[]] => [q.key, []]));
      const add = (a: ProposedAnswer) => answers.get(a.questionKey)?.push(a);
      const runOf = (id: string, sourceClass: StrategyRun['sourceClass'], outcome: StrategyRun['outcome'], detail?: string) => route.runs.push({ strategyId: id, sourceClass, outcome, ...(detail ? { detail } : {}) });

      let structuredCount = 0;
      if (selected.includes('structured-relevance-facts')) {
        for (const q of gap.questions) {
          const caps = structuredCaptures(offeredSnapshot.candidates[q.candidateId], q, nowIso());
          structuredCount += caps.length;
          if (caps.length) add({ questionKey: q.key, claimType: q.claimType, candidateId: q.candidateId, facetKey: q.facetKey, ...(q.areaId && q.claimType !== 'WALKING_CORRIDOR' ? { areaId: q.areaId } : {}), captures: caps, origin: 'STRUCTURED_FACTS' });
        }
        runOf('structured-relevance-facts', 'STRUCTURED_ENTITY_FACTS', structuredCount ? 'SUCCESS' : 'EMPTY', `${structuredCount} mapped capture(s)`);
      }
      let retrieved = 0;
      if (selected.includes('research-memory')) {
        for (const q of gap.questions) {
          const caps = memory.retrieve(q.key, nowIso());
          retrieved += caps.length;
          if (caps.length) add({ questionKey: q.key, claimType: q.claimType, candidateId: q.candidateId, facetKey: q.facetKey, ...(q.areaId && q.claimType !== 'WALKING_CORRIDOR' ? { areaId: q.areaId } : {}), captures: caps, origin: 'RESEARCH_MEMORY' });
        }
        runOf('research-memory', 'RESEARCH_MEMORY', retrieved ? 'SUCCESS' : 'EMPTY', `${retrieved} retained capture(s)`);
      }
      iteration.structuredCaptures = structuredCount;
      iteration.memoryCapturesRetrieved = retrieved;

      const gdeps = { catalog, memory, tools: input.tools, osm: input.osm, wikidata: input.wikidata, verifier: input.verifier, policy: input.compositionPolicy, destinationId: destination.id, now: nowIso };
      const results = new Map<string, Grounding2Result>();
      for (const q of gap.questions) {
        const pre = answers.get(q.key) ?? [];
        if (pre.length) results.set(q.key, await groundQuestion(gdeps, q, pre));
      }
      const remaining = gap.questions.filter((q) => results.get(q.key)?.status !== 'AUTHORIZED');
      let evaluator: (EvaluatorOutcome & { documents: unknown[] }) | undefined;
      if (remaining.length && selected.includes('web-evidence')) {
        const sub: Gap2 = { ...gap, questions: remaining };
        const out = await input.evaluator.evaluate({ gap: sub, offered: offerQuestions(catalog.snapshot(), sub), destinationName: destination.name, budget: input.policy.researchBudgetPerGap, now: nowIso });
        for (const d of out.documents) memory.recordDocument(d);
        memory.addMentions(out.mentions);
        evaluator = out;
        runOf('web-evidence', 'WEB_EVIDENCE', out.kind === 'CLAIMS_PROPOSED' ? 'SUCCESS' : out.kind === 'TOOL_FAILURE' ? 'FAILED' : 'EMPTY', out.kind);
        for (const q of remaining) {
          const web = out.answers.filter((a) => a.questionKey === q.key);
          if (web.length) results.set(q.key, await groundQuestion(gdeps, q, [...(answers.get(q.key) ?? []), ...web]));
        }
        const { answers: proposed, documents: _docs, ...rest } = out;
        void _docs;
        iteration.evaluator = { ...rest, answers: proposed.length };
      } else if (remaining.length) {
        runOf('web-evidence', 'WEB_EVIDENCE', 'SKIPPED', selected.includes('web-evidence') ? 'nothing remaining' : 'not selected');
      }
      iteration.grounding = [...results.values()];

      const questionOutcomes: Record<string, GapOutcome> = {};
      for (const q of gap.questions) {
        const r = results.get(q.key);
        const o: GapOutcome = r
          ? r.status === 'AUTHORIZED' ? 'SATISFIED' : r.status === 'FAILED' ? 'FAILED' : 'INSUFFICIENT_EVIDENCE'
          : !evaluator ? (selected.includes('web-evidence') ? 'INSUFFICIENT_EVIDENCE' : 'FAILED')
            : evaluator.kind === 'TOOL_FAILURE' ? 'FAILED' : evaluator.kind === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : 'INSUFFICIENT_EVIDENCE';
        questionOutcomes[q.key] = o;
        catalog.store.recordGapOutcome(OUTCOMES, { gapKey: q.key, outcome: o, budgetUsed: evaluator?.budgetUsed ?? { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: catalog.store.epoch, at: nowIso() });
      }
      iteration.questionOutcomes = questionOutcomes;
      const outs = Object.values(questionOutcomes);
      gapOutcome = outs.includes('SATISFIED') ? 'SATISFIED' : outs.every((o) => o === 'FAILED') ? 'FAILED' : outs.includes('BUDGET_EXHAUSTED') ? 'BUDGET_EXHAUSTED' : 'INSUFFICIENT_EVIDENCE';
      log('meaning', { gap: gap.key, offered: gap.questions.length, structured: structuredCount, memory: retrieved, evaluator: evaluator?.kind, results: [...results.values()].map((r) => `${r.status}${'reason' in r ? `:${r.reason}` : ''}`) });
    }

    const recomposition = recompose(catalog.store, destination.id, input.compositionPolicy);
    catalog.store.recordGapOutcome(OUTCOMES, { gapKey: gap.key, outcome: gapOutcome, budgetUsed: iteration.evaluator?.budgetUsed ?? { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: catalog.store.epoch, at: nowIso() });
    iterations.push({ ...(iteration as Iteration2), gapOutcome, recomposition, providerCallsDelta: delta(before, totals(input.providerCounts())) });
  }

  const finalSnapshot = catalog.snapshot();
  const units = Object.values(finalSnapshot.catalog.experiences).filter((e) => e.status === 'ACTIVE').length;
  const result: GenerationReport2['result'] = units === 0
    ? { status: 'INSUFFICIENT_KNOWLEDGE', limitations: verdict.limitations }
    : { status: 'TOUR', tour: await composeTour({ snapshot: finalSnapshot.catalog, request, planner: input.planner, policy: input.compositionPolicy }) };
  return { readinessChecks, iterations, finalVerdict: verdict.verdict, stoppedBecause, limitations: verdict.limitations, result };
}
