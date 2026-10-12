import { InterpretedRequest, LedgerEntry, Spike2Snapshot, WALKING_FORMAT_FACET } from './reuse';

/** Revision 3 readiness (spec `knowledge-readiness`, design S5). */
export const READINESS_POLICY_3 = {
  version: 'readiness-spike3-1',
  rationale: 'READY when a provisional plan over admitted PLACE_VISITs leaves no meaningful residual capacity (planner backfill threshold); enrichment never changes the verdict.',
};

export type GapClass3 = 'CORE' | 'PRODUCT_SEMANTIC' | 'ENRICHMENT';
export type GapType3 = 'PLACE_CANDIDATES' | 'SCHEDULE_CAPACITY' | 'AREA_RELEVANCE' | 'PLACE_RELEVANCE' | 'WALKING_CORRIDOR_RELEVANCE';

export interface Gap3 {
  key: string;
  type: GapType3;
  gapClass: GapClass3;
  scopeId: string;
  facetKey?: string;
  product?: string;
}

export interface PlannerResidual {
  dayNumber: number;
  availableMinutes: number;
  meaningful: boolean;
}

export type Verdict3 = {
  verdict: 'READY' | 'NEEDS_ACQUISITION' | 'INSUFFICIENT_KNOWLEDGE';
  coreGaps: Gap3[];
  productSemanticGaps: Gap3[];
  enrichmentGaps: Gap3[];
  admittedPlaceVisits: number;
  residual?: PlannerResidual[];
  evidence?: string;
  policyVersion: string;
};

export const placeDiscoveryKey = (destinationId: string) => `DISCOVERY|PLACE|scope=${destinationId}`;

const gap = (type: GapType3, gapClass: GapClass3, scopeId: string, facetKey?: string, product?: string): Gap3 => ({
  key: `${type}|scope=${scopeId}${facetKey ? `|facet=${facetKey}` : ''}`, type, gapClass, scopeId, ...(facetKey ? { facetKey } : {}), ...(product ? { product } : {}),
});

function latest(snapshot: Spike2Snapshot, key: string): LedgerEntry | undefined {
  const e = snapshot.catalog.ledger[key];
  return e?.[e.length - 1];
}

/**
 * Deterministic readiness over schedulable admitted candidates. Enrichment
 * and product-semantic gaps are listed but never change the verdict of the
 * ordinary PLACE_VISIT path. `structuredStrategiesRemaining` is the router's
 * list of structured strategies not yet exhausted for this destination.
 */
export async function evaluateReadiness3(input: {
  snapshot: Spike2Snapshot;
  request: InterpretedRequest;
  destinationId: string;
  probe: () => Promise<PlannerResidual[]>;
  structuredStrategiesRemaining: string[];
}): Promise<Verdict3> {
  const { snapshot, request, destinationId } = input;
  const enrichmentGaps = request.thematicFacets.flatMap((f) => [gap('AREA_RELEVANCE', 'ENRICHMENT', destinationId, f), gap('PLACE_RELEVANCE', 'ENRICHMENT', destinationId, f)]);
  const productSemanticGaps = request.experienceFormatFacets.includes(WALKING_FORMAT_FACET)
    ? [gap('WALKING_CORRIDOR_RELEVANCE', 'PRODUCT_SEMANTIC', destinationId, WALKING_FORMAT_FACET, 'CORRIDOR_WALK')]
    : [];
  const base = { productSemanticGaps, enrichmentGaps, policyVersion: READINESS_POLICY_3.version };
  const admittedPlaceVisits = Object.values(snapshot.catalog.experiences).filter((e) => e.status === 'ACTIVE' && e.unitKind === 'PLACE_VISIT').length;

  const discovery = latest(snapshot, placeDiscoveryKey(destinationId));
  if (!discovery || discovery.outcome === 'FAILED') {
    return { ...base, verdict: 'NEEDS_ACQUISITION', coreGaps: [gap('PLACE_CANDIDATES', 'CORE', destinationId)], admittedPlaceVisits };
  }
  const residual = admittedPlaceVisits ? await input.probe() : [];
  const unfilled = admittedPlaceVisits === 0 || residual.some((r) => r.meaningful);
  if (!unfilled) return { ...base, verdict: 'READY', coreGaps: [], admittedPlaceVisits, residual };
  if (input.structuredStrategiesRemaining.length) {
    return { ...base, verdict: 'NEEDS_ACQUISITION', coreGaps: [gap('SCHEDULE_CAPACITY', 'CORE', destinationId)], admittedPlaceVisits, residual };
  }
  return {
    ...base, verdict: 'INSUFFICIENT_KNOWLEDGE', coreGaps: [], admittedPlaceVisits, residual,
    evidence: `structured providers exhausted with ${admittedPlaceVisits} admitted PLACE_VISITs; residual days: ${residual.filter((r) => r.meaningful).map((r) => r.dayNumber).join(',') || 'n/a'}`,
  };
}
