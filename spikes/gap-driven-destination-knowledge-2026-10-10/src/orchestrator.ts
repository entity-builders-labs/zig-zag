import { GeoEntityRef, GroundingResult, InterpretedRequest, KnowledgeGap, LedgerEntry, ResearchOutcome } from './contracts';
import { RecompositionReport, recompose } from './composition/reusable';
import { PlannerPort, TourComposition, composeTour } from './composition/tour';
import { recordGapOutcome } from './grounding/gap-outcome';
import { GroundingDeps, groundClaims } from './grounding/ground';
import { CompositionPolicy, ReadinessPolicy } from './policy';
import { CapacityProbe, KnownLimitation, evaluateReadiness } from './readiness';
import { ResearchAgent } from './research/agent';
import { catalogRead } from './research/tools';
import { CatalogStore } from './stores';

export interface GapIteration {
  gap: KnowledgeGap;
  research: ResearchOutcome;
  grounding: GroundingResult[];
  recomposition: RecompositionReport;
  ledger: LedgerEntry;
}

export interface GenerationReport {
  initialEpoch: number;
  initialRecomposition: RecompositionReport;
  readinessChecks: Array<{ epoch: number; verdict: 'READY' | 'GAPS'; gapKeys: string[]; limitationKeys: string[] }>;
  iterations: GapIteration[];
  stoppedBecause: 'READY' | 'GAP_BUDGET_EXHAUSTED' | 'ONLY_ATTEMPTED_GAPS_REMAIN';
  remainingGapKeys: string[];
  limitations: KnownLimitation[];
  finalEpoch: number;
  tour: TourComposition;
}

/**
 * One generation (design: "Generation flow"): catalog first; research runs
 * only for typed readiness gaps, one gap per execution, each gap key at most
 * once per generation; every write is followed by a fresh snapshot; the Tour
 * is composed from the snapshot read after the last write.
 */
export async function generate(input: {
  store: CatalogStore;
  request: InterpretedRequest;
  destination: GeoEntityRef;
  agent: ResearchAgent;
  grounding: Omit<GroundingDeps, 'store' | 'destination'>;
  planner: PlannerPort & { capacityProbe(): CapacityProbe };
  readinessPolicy: ReadinessPolicy;
  compositionPolicy: CompositionPolicy;
  now: Date;
  log?: (event: string, data: unknown) => void;
}): Promise<GenerationReport> {
  const { store, request, destination } = input;
  const log = input.log ?? (() => undefined);
  const initialEpoch = store.epoch;
  const initialRecomposition = recompose(store, destination.id, input.compositionPolicy);
  const readinessChecks: GenerationReport['readinessChecks'] = [];
  const iterations: GapIteration[] = [];
  const attempted = new Set<string>();
  let stoppedBecause: GenerationReport['stoppedBecause'] = 'READY';
  let remainingGapKeys: string[] = [];
  let limitations: KnownLimitation[] = [];

  for (;;) {
    const snapshot = store.snapshot();
    const verdict = await evaluateReadiness({
      snapshot, request, destinationId: destination.id, policy: input.readinessPolicy, now: input.now, capacityProbe: input.planner.capacityProbe(),
    });
    limitations = verdict.limitations;
    const gapKeys = verdict.verdict === 'GAPS' ? verdict.gaps.map((g) => g.key) : [];
    readinessChecks.push({ epoch: snapshot.epoch, verdict: verdict.verdict, gapKeys, limitationKeys: verdict.limitations.map((l) => l.gap.key) });
    log('readiness', readinessChecks[readinessChecks.length - 1]);
    if (verdict.verdict === 'READY') {
      stoppedBecause = 'READY';
      remainingGapKeys = [];
      break;
    }
    const gap = verdict.gaps.find((g) => !attempted.has(g.key));
    remainingGapKeys = gapKeys;
    if (!gap) {
      stoppedBecause = 'ONLY_ATTEMPTED_GAPS_REMAIN';
      break;
    }
    if (iterations.length >= input.readinessPolicy.maxResearchedGapsPerGeneration) {
      stoppedBecause = 'GAP_BUDGET_EXHAUSTED';
      break;
    }
    attempted.add(gap.key);

    const research = await input.agent.research({
      gap, excerpt: catalogRead(snapshot, gap, destination.id), budget: input.readinessPolicy.researchBudgetPerGap, snapshotEpoch: snapshot.epoch,
    });
    log('research', { gap: gap.key, kind: research.kind, claims: research.claims.length, discarded: research.discarded.length, budget: research.budgetUsed });
    const grounding = research.claims.length
      ? await groundClaims({ ...input.grounding, store, destination }, gap, research.claims)
      : [];
    log('grounding', grounding.map((g) => ({ status: g.status, subject: g.claim.subjectMention, reason: 'reason' in g ? g.reason : undefined })));
    const recomposition = recompose(store, destination.id, input.compositionPolicy);
    const ledger = await recordGapOutcome({
      store, gap, request, destinationId: destination.id, policy: input.readinessPolicy, now: input.now, research, grounding,
    });
    log('gap-outcome', ledger);
    iterations.push({ gap, research, grounding, recomposition, ledger });
  }

  const finalSnapshot = store.snapshot();
  if (finalSnapshot.epoch !== store.epoch) throw new Error('final snapshot is older than the last write');
  const tour = await composeTour({ snapshot: finalSnapshot, request, planner: input.planner, policy: input.compositionPolicy });
  return {
    initialEpoch, initialRecomposition, readinessChecks, iterations, stoppedBecause, remainingGapKeys, limitations,
    finalEpoch: finalSnapshot.epoch, tour,
  };
}
