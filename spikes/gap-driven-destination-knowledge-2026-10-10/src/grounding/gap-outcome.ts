import {
  GapOutcome,
  GroundingResult,
  InterpretedRequest,
  KnowledgeGap,
  LedgerEntry,
  ResearchOutcome,
} from '../contracts';
import { ReadinessPolicy } from '../policy';
import { evaluateReadiness, relevantAreaIds } from '../readiness';
import { CatalogStore, GapOutcomeRecordingAuthority } from '../stores';

const GAP_OUTCOME = new GapOutcomeRecordingAuthority();

/**
 * Whether a gap is filled on a FRESH snapshot. Facet gaps: re-evaluated
 * readiness no longer emits (nor reports) the gap key. SCHEDULE_CAPACITY:
 * its satisfaction predicate is a newly grounded relevant area (design D5);
 * the provisional plan itself is not rerun here.
 */
export async function isGapSatisfied(input: {
  store: CatalogStore;
  gap: KnowledgeGap;
  request: InterpretedRequest;
  destinationId: string;
  policy: ReadinessPolicy;
  now: Date;
}): Promise<boolean> {
  const snapshot = input.store.snapshot();
  if (input.gap.type === 'SCHEDULE_CAPACITY') {
    const known = new Set(input.gap.knownAreaIds);
    return input.request.thematicFacets
      .flatMap((f) => relevantAreaIds(snapshot, input.destinationId, f))
      .some((id) => !known.has(id));
  }
  const verdict = await evaluateReadiness({
    snapshot, request: input.request, destinationId: input.destinationId, policy: input.policy, now: input.now,
  });
  const stillOpen = verdict.verdict === 'GAPS' && verdict.gaps.some((g) => g.key === input.gap.key);
  const reported = verdict.limitations.some((l) => l.gap.key === input.gap.key);
  return !stillOpen && !reported;
}

/** Pure classification of the gap outcome (spec "Gap outcome recording"). */
export function classifyGapOutcome(satisfied: boolean, research: ResearchOutcome, grounding: GroundingResult[]): GapOutcome {
  if (satisfied) return 'SATISFIED';
  const authorized = grounding.some((g) => g.status === 'AUTHORIZED');
  const failed = grounding.some((g) => g.status === 'FAILED');
  if (research.kind === 'TOOL_FAILURE') return 'FAILED';
  if (failed && !authorized) return 'FAILED';
  if (research.kind === 'BUDGET_EXHAUSTED') return 'BUDGET_EXHAUSTED';
  return 'INSUFFICIENT_EVIDENCE';
}

/** Records the gap outcome exactly once, after grounding and re-evaluation. */
export async function recordGapOutcome(input: {
  store: CatalogStore;
  gap: KnowledgeGap;
  request: InterpretedRequest;
  destinationId: string;
  policy: ReadinessPolicy;
  now: Date;
  research: ResearchOutcome;
  grounding: GroundingResult[];
}): Promise<LedgerEntry> {
  const satisfied = await isGapSatisfied(input);
  const entry: LedgerEntry = {
    gapKey: input.gap.key,
    outcome: classifyGapOutcome(satisfied, input.research, input.grounding),
    budgetUsed: input.research.budgetUsed,
    snapshotEpoch: input.store.epoch,
    at: input.now.toISOString(),
  };
  input.store.recordGapOutcome(GAP_OUTCOME, entry);
  return entry;
}
