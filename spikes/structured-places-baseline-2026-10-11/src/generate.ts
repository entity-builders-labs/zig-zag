import { OsmCandidate } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { DailyPlanningSolution, PlanningExperienceCandidate } from '../../../be/src/modules/tours/interfaces/daily-planning.interface';
import { plannerResidualCapacity } from '../../../be/src/modules/tours/utils/daily-planning-convergence.util';
import { AdmissionLedger, PlaceDiscoveryOutcome, composePlaceVisits, discoverAndAdmitPlaces } from './places';
import { RANKING_POLICY_VERSION, RankingInputs, rankPlaces } from './ranking';
import { Verdict3, evaluateReadiness3, placeDiscoveryKey } from './readiness';
import { ROUTING_POLICY_3, route3, structuredStrategiesRemaining } from './routing';
import {
  CompositionPolicy,
  GapOutcomeRecordingAuthority,
  GeoEntityRef,
  InterpretedRequest,
  LngLat,
  OsmStructuredAdapter,
  ProviderCallCounts,
  ReusableExperience,
  Spike2Catalog,
  SpikePlanner,
  WikidataFactsAdapter,
  toPlanningCandidate,
} from './reuse';

const OUTCOMES = new GapOutcomeRecordingAuthority();

export interface TourRow3 {
  dayNumber: number;
  order: number;
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
  placeId: string;
  name: string;
  admissionClass: string;
  travelFromPreviousMinutes?: number;
  travelMode?: string;
}

export interface GenerationReport3 {
  readinessChecks: Array<Pick<Verdict3, 'verdict' | 'admittedPlaceVisits' | 'evidence'> & { coreGaps: string[]; productSemanticGaps: string[]; enrichmentGaps: string[]; residual?: Verdict3['residual'] }>;
  stages: Array<{ stage: string; route?: string[]; providerCallsDelta: Record<string, number>; discovery?: PlaceDiscoveryOutcome; composition?: ReturnType<typeof composePlaceVisits> }>;
  finalVerdict: Verdict3['verdict'];
  ranking: { policyVersion: string; ranked: number; selected: RankingInputs[] };
  plannerInput: Array<Pick<PlanningExperienceCandidate, 'experienceId' | 'title' | 'durationMinutes' | 'semanticScore'> & { point: LngLat }>;
  plannerOutput?: { days: number; selected: number; unselected: DailyPlanningSolution['unselected']; metadata: DailyPlanningSolution['metadata'] };
  tour: TourRow3[];
  result: 'TOUR' | 'INSUFFICIENT_KNOWLEDGE';
  l2AssertionsAtTour: number;
  placeVisitsWithZeroL2: number;
}

const totals = (c: Record<string, ProviderCallCounts>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.live + v.replayed + v.failed]));
const delta = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]).filter(([, v]) => v !== 0));

/**
 * One generation, revision 3 core happy path: structured places -> admission
 * -> PLACE_VISITs -> deterministic ranking -> provisional plan -> planner ->
 * Tour. No LLM, web search, fetch or enrichment.
 */
export async function generate3(input: {
  catalog: Spike2Catalog;
  ledger: AdmissionLedger;
  request: InterpretedRequest;
  destination: GeoEntityRef;
  destinationBoundary: OsmCandidate;
  osm: OsmStructuredAdapter;
  wikidata: WikidataFactsAdapter;
  planner: SpikePlanner;
  compositionPolicy: CompositionPolicy;
  plannerPoolSize: number;
  now: Date;
  providerCounts: () => Record<string, ProviderCallCounts>;
  log?: (e: string, d: unknown) => void;
}): Promise<GenerationReport3> {
  const { catalog, ledger, request, destination } = input;
  const log = input.log ?? (() => undefined);
  const executed = new Set<string>();
  const stages: GenerationReport3['stages'] = [];
  const readinessChecks: GenerationReport3['readinessChecks'] = [];

  const rankedPool = () => {
    const snap = catalog.snapshot();
    const points = Object.fromEntries(Object.values(snap.catalog.geoEntities).map((g) => [g.id, g.centroid]));
    const activePlaces = new Set(Object.values(snap.catalog.experiences).filter((e) => e.status === 'ACTIVE' && e.unitKind === 'PLACE_VISIT').map((e) => e.anchors[0]));
    const ranked = rankPlaces(ledger.admitted().filter((r) => activePlaces.has(r.placeId)), snap.candidates, points);
    const selected = ranked.slice(0, input.plannerPoolSize);
    const byPlace = new Map(Object.values(snap.catalog.experiences).map((e) => [e.anchors[0], e]));
    const candidates = selected.map((r, i) => {
      const e = byPlace.get(r.placeId) as ReusableExperience;
      // Rank-derived relevance so the unchanged planner respects the structured ranking.
      return { ...toPlanningCandidate(e, request), semanticScore: Number(((selected.length - i) / selected.length).toFixed(4)) };
    });
    return { ranked, selected, candidates, points };
  };
  const probe = async () => {
    const { candidates } = rankedPool();
    const solution = await input.planner.solve(candidates, request);
    return plannerResidualCapacity(solution, input.planner.planningWindow(), input.planner.policy.backfill.minimumUsefulResidualMinutes);
  };

  let verdict: Verdict3;
  for (;;) {
    verdict = await evaluateReadiness3({ snapshot: catalog.snapshot(), request, destinationId: destination.id, probe, structuredStrategiesRemaining: structuredStrategiesRemaining(executed) });
    readinessChecks.push({
      verdict: verdict.verdict, admittedPlaceVisits: verdict.admittedPlaceVisits, ...(verdict.evidence ? { evidence: verdict.evidence } : {}),
      coreGaps: verdict.coreGaps.map((g) => g.key), productSemanticGaps: verdict.productSemanticGaps.map((g) => g.key), enrichmentGaps: verdict.enrichmentGaps.map((g) => g.key),
      ...(verdict.residual ? { residual: verdict.residual } : {}),
    });
    log('readiness', readinessChecks[readinessChecks.length - 1]);
    if (verdict.verdict !== 'NEEDS_ACQUISITION') break;
    const g = verdict.coreGaps[0];
    const strategies = route3(g.type, g.gapClass);
    const pending = strategies.filter((s) => !executed.has(s.id));
    if (!pending.length) {
      catalog.store.recordGapOutcome(OUTCOMES, { gapKey: g.key, outcome: 'FAILED', budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: catalog.store.epoch, at: input.now.toISOString() });
      stages.push({ stage: `${g.type}: no structured strategy remaining`, route: [], providerCallsDelta: {} });
      verdict = { ...verdict, verdict: 'INSUFFICIENT_KNOWLEDGE', evidence: `${g.type} has no remaining structured strategy under ${ROUTING_POLICY_3}` };
      break;
    }
    const before = totals(input.providerCounts());
    strategies.forEach((s) => executed.add(s.id));
    const discovery = await discoverAndAdmitPlaces({ catalog, ledger, osm: input.osm, wikidata: input.wikidata, destination, destinationBoundary: input.destinationBoundary });
    catalog.store.recordGapOutcome(OUTCOMES, {
      gapKey: placeDiscoveryKey(destination.id), outcome: discovery.status === 'SUCCESS' ? 'SATISFIED' : discovery.status === 'EMPTY' ? 'INSUFFICIENT_EVIDENCE' : 'FAILED',
      budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: catalog.store.epoch, at: input.now.toISOString(),
    });
    const composition = composePlaceVisits(catalog, ledger, input.compositionPolicy);
    stages.push({ stage: g.type, route: strategies.map((s) => s.id), providerCallsDelta: delta(before, totals(input.providerCounts())), discovery, composition });
    log('discovery', { gap: g.key, discovery, composition });
  }

  const snap = catalog.snapshot();
  const l2 = Object.values(snap.catalog.assertions).filter((a) => a.status === 'ACTIVE').length;
  const placeVisits = Object.values(snap.catalog.experiences).filter((e) => e.status === 'ACTIVE' && e.unitKind === 'PLACE_VISIT');
  const zeroL2 = placeVisits.filter((e) => e.content.facetKeys.length === 0 && e.justification.every((j) => j.startsWith('ADMISSION|'))).length;
  const pool = rankedPool();
  const plannerInput = pool.candidates.map((c) => ({ experienceId: c.experienceId, title: c.title, durationMinutes: c.durationMinutes, semanticScore: c.semanticScore, point: pool.points[c.experienceId.replace('PLACE_VISIT|place=', '')] }));
  const base = { readinessChecks, stages, finalVerdict: verdict.verdict, ranking: { policyVersion: RANKING_POLICY_VERSION, ranked: pool.ranked.length, selected: pool.selected }, plannerInput, l2AssertionsAtTour: l2, placeVisitsWithZeroL2: zeroL2 };
  if (verdict.verdict !== 'READY' && placeVisits.length === 0) return { ...base, tour: [], result: 'INSUFFICIENT_KNOWLEDGE' };

  const before = totals(input.providerCounts());
  const solution = await input.planner.solve(pool.candidates, request);
  const cls = new Map(pool.selected.map((r) => [r.placeId, r.admissionClass]));
  const tour: TourRow3[] = solution.days.flatMap((d) => d.experiences.map((e, i) => {
    const placeId = e.experienceId.replace('PLACE_VISIT|place=', '');
    return {
      dayNumber: d.dayNumber, order: i + 1, startMinutesFromMidnight: e.startMinutesFromMidnight, endMinutesFromMidnight: e.endMinutesFromMidnight,
      placeId, name: snap.catalog.geoEntities[placeId]?.name ?? placeId, admissionClass: cls.get(placeId) ?? '',
      ...(e.travelFromPrevious ? { travelFromPreviousMinutes: Math.round(e.travelFromPrevious.durationMinutes), travelMode: e.travelFromPrevious.mode } : {}),
    };
  }));
  stages.push({ stage: 'PLANNER', providerCallsDelta: delta(before, totals(input.providerCounts())) });
  return {
    ...base,
    plannerOutput: { days: solution.days.length, selected: tour.length, unselected: solution.unselected, metadata: solution.metadata },
    tour, result: tour.length ? 'TOUR' : 'INSUFFICIENT_KNOWLEDGE',
  };
}
