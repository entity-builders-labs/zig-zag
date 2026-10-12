import { Spike2Snapshot, discoveryKey, evaluationQuestionKey } from './catalog';
import { CandidateFacts, EvaluationQuestion, Gap2, GapType2, Limitation, Verdict2 } from './contracts';
import { rankByProminence, rankRoutes } from './offering';
import { ReadinessPolicy2 } from './policy';
import { Assertion, ClaimType, FacetKey, InterpretedRequest, LedgerEntry, WALKING_FORMAT_FACET, containsPoint, corridorLine } from './spike1';

export interface PlannerResidual {
  dayNumber: number;
  availableMinutes: number;
  meaningful: boolean;
}

/** Provisional-plan probe (discarded); injected to keep readiness pure. */
export type CapacityProbe2 = (snapshot: Spike2Snapshot, request: InterpretedRequest) => Promise<PlannerResidual[]>;

function latest(snapshot: Spike2Snapshot, key: string): LedgerEntry | undefined {
  const e = snapshot.catalog.ledger[key];
  return e?.[e.length - 1];
}

function recentNegative(entry: LedgerEntry | undefined, policy: ReadinessPolicy2, now: Date): boolean {
  if (!entry || (entry.outcome !== 'INSUFFICIENT_EVIDENCE' && entry.outcome !== 'BUDGET_EXHAUSTED')) return false;
  return (now.getTime() - new Date(entry.at).getTime()) / 86_400_000 <= policy.negativeOutcomeFreshnessDays;
}

function active(snapshot: Spike2Snapshot, destinationId: string): Assertion[] {
  return Object.values(snapshot.catalog.assertions)
    .filter((a) => a.status === 'ACTIVE' && a.destinationId === destinationId)
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Discovery recorded (SUCCESS or EMPTY). FAILED or missing -> not done. */
function discoveryDone(snapshot: Spike2Snapshot, kind: 'AREA' | 'PLACE' | 'ROUTE', scopeId: string): boolean {
  const e = latest(snapshot, discoveryKey(kind, scopeId));
  return !!e && e.outcome !== 'FAILED';
}

export function relevantAreaIds(snapshot: Spike2Snapshot, destinationId: string, facet: FacetKey): string[] {
  return [...new Set(active(snapshot, destinationId)
    .filter((a) => a.claimType === 'RELEVANT_FOR' && a.facetKey === facet && a.subject.kind === 'GEO_ENTITY')
    .map((a) => (a.subject.kind === 'GEO_ENTITY' ? a.subject.geoEntityId : ''))
    .filter((id) => snapshot.catalog.geoEntities[id]?.kind === 'AREA'))].sort();
}

export function relevantPlaceIds(snapshot: Spike2Snapshot, destinationId: string, areaId: string, facet?: FacetKey): string[] {
  const area = snapshot.catalog.geoEntities[areaId];
  const ids = new Set<string>();
  for (const a of active(snapshot, destinationId)) {
    if (facet && a.facetKey !== facet) continue;
    if (a.claimType === 'NOTABLE_WITHIN' && a.subject.kind === 'PLACE_IN_AREA' && a.subject.areaGeoEntityId === areaId) ids.add(a.subject.placeGeoEntityId);
    if (a.claimType === 'RELEVANT_FOR' && a.subject.kind === 'GEO_ENTITY') {
      const place = snapshot.catalog.geoEntities[a.subject.geoEntityId];
      if (place?.kind === 'PLACE' && area && containsPoint(area.geometry, place.centroid)) ids.add(place.id);
    }
  }
  return [...ids].sort();
}

export function corridorAssertionsInArea(snapshot: Spike2Snapshot, destinationId: string, areaId: string): string[] {
  const area = snapshot.catalog.geoEntities[areaId];
  if (!area) return [];
  return active(snapshot, destinationId)
    .filter((a) => a.claimType === 'WALKING_CORRIDOR' && a.subject.kind === 'CORRIDOR')
    .filter((a) => {
      if (a.subject.kind !== 'CORRIDOR') return false;
      const line = corridorLine(snapshot.catalog.geoEntities, a.subject.corridor);
      return line.status === 'OK' && line.line.some((p) => containsPoint(area.geometry, p));
    })
    .map((a) => a.key);
}

/** A question is open when it is neither satisfied nor recently negative. */
export function questionOpen(snapshot: Spike2Snapshot, key: string, policy: ReadinessPolicy2, now: Date): boolean {
  const e = latest(snapshot, key);
  if (e?.outcome === 'SATISFIED') return false;
  return !recentNegative(e, policy, now);
}

function candidatesOf(snapshot: Spike2Snapshot, kind: 'AREA' | 'PLACE' | 'ROUTE', scopeId: string): CandidateFacts[] {
  return Object.values(snapshot.candidates).filter((c) => c.kind === kind && (kind === 'AREA' ? c.discoveredBy.scopeId === scopeId : c.parentAreaIds.includes(scopeId)));
}

function questions(
  snapshot: Spike2Snapshot,
  ranked: string[],
  claimType: ClaimType,
  facet: FacetKey,
  limit: number,
  policy: ReadinessPolicy2,
  now: Date,
  extra: Partial<EvaluationQuestion> = {},
): EvaluationQuestion[] {
  return ranked
    .map((candidateId) => ({ key: evaluationQuestionKey(claimType, candidateId, facet), claimType, candidateId, facetKey: facet, ...extra }))
    .filter((q) => questionOpen(snapshot, q.key, policy, now))
    .slice(0, limit);
}

function gap(type: GapType2, kind: Gap2['kind'], scopeId: string, facetKey: string | undefined, threshold: number, observed: number, qs: EvaluationQuestion[], lineage?: string): Gap2 {
  return { key: `${type}|scope=${scopeId}${facetKey ? `|facet=${facetKey}` : ''}`, type, kind, scopeId, ...(facetKey ? { facetKey } : {}), threshold, observed, questions: qs, ...(lineage ? { lineage } : {}) };
}

const TYPE_ORDER: GapType2[] = ['AREA_CANDIDATES', 'PLACE_CANDIDATES', 'ROUTE_CANDIDATES', 'AREA_RELEVANCE', 'PLACE_RELEVANCE', 'WALKING_CORRIDOR_RELEVANCE', 'SCHEDULE_CAPACITY'];

/**
 * Deterministic readiness for revision 2 (spec `knowledge-readiness`):
 * discovery gaps before meaning gaps, meaning gaps only over unevaluated
 * canonical candidates, per-question suppression, explicit
 * INSUFFICIENT_KNOWLEDGE. Evidence memory is not an input.
 */
export async function evaluateReadiness2(input: {
  snapshot: Spike2Snapshot;
  request: InterpretedRequest;
  destinationId: string;
  policy: ReadinessPolicy2;
  now: Date;
  capacityProbe?: CapacityProbe2;
}): Promise<Verdict2> {
  const { snapshot, request, destinationId, policy, now } = input;
  const K = policy.offerPerExecution;
  const gaps: Gap2[] = [];
  const limitations: Limitation[] = [];
  const limit = (type: GapType2, scopeId: string, facetKey: string | undefined, reason: Limitation['reason']) =>
    limitations.push({ key: `${type}|scope=${scopeId}${facetKey ? `|facet=${facetKey}` : ''}`, type, scopeId, ...(facetKey ? { facetKey } : {}), reason });
  const facets = [...request.thematicFacets].sort();

  if (!discoveryDone(snapshot, 'AREA', destinationId)) {
    gaps.push(gap('AREA_CANDIDATES', 'DISCOVERY', destinationId, undefined, 1, 0, []));
  } else {
    const areaCandidates = candidatesOf(snapshot, 'AREA', destinationId);
    const rankedAreas = rankByProminence(areaCandidates).map((r) => r.id);
    const boundedRelevant = new Set<string>();
    for (const facet of facets) {
      const relevant = relevantAreaIds(snapshot, destinationId, facet);
      if (relevant.length < policy.minRelevantAreasPerFacet) {
        const qs = questions(snapshot, rankedAreas, 'RELEVANT_FOR', facet, K.areas, policy, now);
        if (qs.length) gaps.push(gap('AREA_RELEVANCE', 'MEANING', destinationId, facet, policy.minRelevantAreasPerFacet, relevant.length, qs));
        else limit('AREA_RELEVANCE', destinationId, facet, areaCandidates.length ? 'QUESTIONS_EXHAUSTED' : 'DISCOVERY_EMPTY');
      }
      for (const areaId of relevant) {
        const facts = snapshot.candidates[areaId];
        if (facts?.extent !== 'PROVIDER_BOUNDARY') { limit('PLACE_CANDIDATES', areaId, undefined, 'NO_BOUNDED_AREA'); continue; }
        boundedRelevant.add(areaId);
        if (!discoveryDone(snapshot, 'PLACE', areaId)) {
          if (!gaps.some((g) => g.type === 'PLACE_CANDIDATES' && g.scopeId === areaId)) gaps.push(gap('PLACE_CANDIDATES', 'DISCOVERY', areaId, undefined, 1, 0, []));
          continue;
        }
        const places = relevantPlaceIds(snapshot, destinationId, areaId, facet);
        if (places.length >= policy.minRelevantPlacesPerAreaFacet) continue;
        const ranked = rankByProminence(candidatesOf(snapshot, 'PLACE', areaId)).map((r) => r.id);
        const qs = questions(snapshot, ranked, 'NOTABLE_WITHIN', facet, K.places, policy, now, { areaId });
        if (qs.length) gaps.push(gap('PLACE_RELEVANCE', 'MEANING', areaId, facet, policy.minRelevantPlacesPerAreaFacet, places.length, qs));
        else limit('PLACE_RELEVANCE', areaId, facet, candidatesOf(snapshot, 'PLACE', areaId).length ? 'QUESTIONS_EXHAUSTED' : 'DISCOVERY_EMPTY');
      }
    }

    if (request.experienceFormatFacets.includes(WALKING_FORMAT_FACET)) {
      for (const areaId of [...boundedRelevant].sort()) {
        if (!discoveryDone(snapshot, 'ROUTE', areaId)) { gaps.push(gap('ROUTE_CANDIDATES', 'DISCOVERY', areaId, undefined, 1, 0, [])); continue; }
        if (corridorAssertionsInArea(snapshot, destinationId, areaId).length > 0) continue;
        const routes = candidatesOf(snapshot, 'ROUTE', areaId);
        const ranked = rankRoutes(snapshot, routes, relevantPlaceIds(snapshot, destinationId, areaId), policy.corridorRankBufferMeters).map((r) => r.id);
        const anchorIds = [areaId, ...candidatesOf(snapshot, 'PLACE', areaId).map((c) => c.geoEntityId).sort()];
        const qs = questions(snapshot, ranked, 'WALKING_CORRIDOR', WALKING_FORMAT_FACET, K.routes, policy, now, { areaId, anchorIds });
        if (qs.length) gaps.push(gap('WALKING_CORRIDOR_RELEVANCE', 'MEANING', areaId, WALKING_FORMAT_FACET, 1, 0, qs));
        else limit('WALKING_CORRIDOR_RELEVANCE', areaId, WALKING_FORMAT_FACET, routes.length ? 'QUESTIONS_EXHAUSTED' : 'DISCOVERY_EMPTY');
      }
    }

    if (gaps.length === 0 && input.capacityProbe) {
      const residual = await input.capacityProbe(snapshot, request);
      const meaningful = residual.filter((r) => r.meaningful);
      if (meaningful.length > 0) {
        const facetKey = facets.join('+');
        // Lineage: more places in bounded relevant areas first, then more areas.
        const placeQs = [...boundedRelevant].sort().flatMap((areaId) => {
          const ranked = rankByProminence(candidatesOf(snapshot, 'PLACE', areaId)).map((r) => r.id);
          return facets.flatMap((f) => questions(snapshot, ranked, 'NOTABLE_WITHIN', f, K.places, policy, now, { areaId }));
        });
        const areaQs = facets.flatMap((f) => questions(snapshot, rankedAreas, 'RELEVANT_FOR', f, K.areas, policy, now));
        const qs = (placeQs.length ? placeQs : areaQs).slice(0, Math.max(K.places, K.areas));
        if (qs.length) gaps.push(gap('SCHEDULE_CAPACITY', 'META', destinationId, facetKey, 0, meaningful.length, qs, placeQs.length ? 'PLACE_RELEVANCE_EXPANSION' : 'AREA_RELEVANCE_EXPANSION'));
        else limit('SCHEDULE_CAPACITY', destinationId, facetKey, 'QUESTIONS_EXHAUSTED');
      }
    }
  }

  gaps.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.key.localeCompare(b.key));
  if (gaps.length) return { verdict: 'GAPS', gaps, limitations, policyVersion: policy.version };
  if (limitations.length) return { verdict: 'INSUFFICIENT_KNOWLEDGE', limitations, policyVersion: policy.version };
  return { verdict: 'READY', limitations, policyVersion: policy.version };
}
