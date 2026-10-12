import {
  Assertion,
  FacetKey,
  GapType,
  InterpretedRequest,
  KnowledgeGap,
  LedgerEntry,
} from './contracts';
import { corridorLine } from './corridor';
import { WALKING_FORMAT_FACET } from './facets';
import { containsPoint } from './geometry';
import { gapKey } from './keys';
import { ReadinessPolicy } from './policy';
import { CatalogSnapshot } from './stores';

export interface PlannerResidual {
  dayNumber: number;
  availableMinutes: number;
  meaningful: boolean;
}

/**
 * Runs a PROVISIONAL plan over the reusable Experiences the snapshot offers
 * and returns planner residual capacity. Injected so readiness itself stays
 * a pure function of its inputs; the provisional plan is discarded.
 */
export type CapacityProbe = (snapshot: CatalogSnapshot, request: InterpretedRequest) => Promise<PlannerResidual[]>;

export interface KnownLimitation {
  gap: KnowledgeGap;
  ledger: LedgerEntry;
}

export type ReadinessVerdict =
  | { verdict: 'READY'; limitations: KnownLimitation[]; policyVersion: string }
  | { verdict: 'GAPS'; gaps: KnowledgeGap[]; limitations: KnownLimitation[]; policyVersion: string };

const TYPE_ORDER: GapType[] = ['AREA_RELEVANCE', 'NOTABLE_PLACES', 'WALKING_CORRIDOR', 'SCHEDULE_CAPACITY'];

function active(snapshot: CatalogSnapshot, destinationId: string): Assertion[] {
  return Object.values(snapshot.assertions)
    .filter((a) => a.status === 'ACTIVE' && a.destinationId === destinationId)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function relevantAreaIds(snapshot: CatalogSnapshot, destinationId: string, facet: FacetKey): string[] {
  return [
    ...new Set(
      active(snapshot, destinationId)
        .filter((a) => a.claimType === 'RELEVANT_FOR' && a.facetKey === facet && a.subject.kind === 'GEO_ENTITY')
        .map((a) => (a.subject.kind === 'GEO_ENTITY' ? a.subject.geoEntityId : ''))
        .filter((id) => snapshot.geoEntities[id]?.kind === 'AREA'),
    ),
  ].sort();
}

export function notablePlaceIds(snapshot: CatalogSnapshot, destinationId: string, areaId: string, facet: FacetKey): string[] {
  const area = snapshot.geoEntities[areaId];
  const ids = new Set<string>();
  for (const a of active(snapshot, destinationId)) {
    if (a.facetKey !== facet) continue;
    if (a.claimType === 'NOTABLE_WITHIN' && a.subject.kind === 'PLACE_IN_AREA' && a.subject.areaGeoEntityId === areaId) {
      ids.add(a.subject.placeGeoEntityId);
    }
    if (a.claimType === 'RELEVANT_FOR' && a.subject.kind === 'GEO_ENTITY') {
      const place = snapshot.geoEntities[a.subject.geoEntityId];
      if (place?.kind === 'PLACE' && area && containsPoint(area.geometry, place.centroid)) ids.add(place.id);
    }
  }
  return [...ids].sort();
}

export function corridorsInAreas(snapshot: CatalogSnapshot, destinationId: string, areaIds: string[]): string[] {
  const areas = areaIds.map((id) => snapshot.geoEntities[id]).filter(Boolean);
  return active(snapshot, destinationId)
    .filter((a) => a.claimType === 'WALKING_CORRIDOR' && a.subject.kind === 'CORRIDOR')
    .filter((a) => {
      if (a.subject.kind !== 'CORRIDOR') return false;
      const line = corridorLine(snapshot.geoEntities, a.subject.corridor);
      return line.status === 'OK' && areas.some((area) => line.line.some((p) => containsPoint(area.geometry, p)));
    })
    .map((a) => a.key);
}

function latestLedger(snapshot: CatalogSnapshot, key: string): LedgerEntry | undefined {
  const entries = snapshot.ledger[key];
  return entries?.[entries.length - 1];
}

function suppressedBy(entry: LedgerEntry | undefined, policy: ReadinessPolicy, now: Date): boolean {
  if (!entry) return false;
  if (entry.outcome !== 'INSUFFICIENT_EVIDENCE' && entry.outcome !== 'BUDGET_EXHAUSTED') return false;
  const ageDays = (now.getTime() - new Date(entry.at).getTime()) / 86_400_000;
  return ageDays <= policy.negativeOutcomeFreshnessDays;
}

function makeGap(
  type: GapType,
  scope: string,
  facets: FacetKey[],
  threshold: number,
  observed: number,
  knownAreaIds: string[],
  relevant: string[],
): KnowledgeGap {
  return {
    key: gapKey(type, scope, facets),
    type,
    scopeGeoEntityId: scope,
    facetKey: [...new Set(facets)].sort().join('+'),
    threshold,
    observed,
    knownAreaIds,
    relevantAreaIds: relevant,
  };
}

/**
 * Deterministic readiness evaluation (spec `knowledge-readiness`). No
 * language model participates. Same snapshot + request + policy (+ probe
 * output) -> same verdict.
 */
export async function evaluateReadiness(input: {
  snapshot: CatalogSnapshot;
  request: InterpretedRequest;
  destinationId: string;
  policy: ReadinessPolicy;
  now: Date;
  capacityProbe?: CapacityProbe;
}): Promise<ReadinessVerdict> {
  const { snapshot, request, destinationId, policy, now } = input;
  const facets = [...request.thematicFacets].sort();
  const knownAreas = [...new Set(facets.flatMap((f) => relevantAreaIds(snapshot, destinationId, f)))].sort();
  const candidates: KnowledgeGap[] = [];

  for (const facet of facets) {
    const areas = relevantAreaIds(snapshot, destinationId, facet);
    if (areas.length < policy.minRelevantAreasPerFacet) {
      candidates.push(makeGap('AREA_RELEVANCE', destinationId, [facet], policy.minRelevantAreasPerFacet, areas.length, knownAreas, knownAreas));
    }
    for (const areaId of areas) {
      const places = notablePlaceIds(snapshot, destinationId, areaId, facet);
      if (places.length < policy.minNotablePlacesPerAreaFacet) {
        candidates.push(makeGap('NOTABLE_PLACES', areaId, [facet], policy.minNotablePlacesPerAreaFacet, places.length, knownAreas, [areaId]));
      }
    }
  }

  if (request.experienceFormatFacets.includes(WALKING_FORMAT_FACET)) {
    const corridors = corridorsInAreas(snapshot, destinationId, knownAreas);
    if (corridors.length < 1) {
      candidates.push(makeGap('WALKING_CORRIDOR', destinationId, [WALKING_FORMAT_FACET], 1, corridors.length, knownAreas, knownAreas));
    }
  }

  const limitations: KnownLimitation[] = [];
  const emitted: KnowledgeGap[] = [];
  for (const gap of candidates) {
    const ledger = latestLedger(snapshot, gap.key);
    if (suppressedBy(ledger, policy, now)) limitations.push({ gap, ledger: ledger as LedgerEntry });
    else emitted.push(gap);
  }

  if (emitted.length === 0 && input.capacityProbe) {
    const residual = await input.capacityProbe(snapshot, request);
    const meaningful = residual.filter((r) => r.meaningful);
    if (meaningful.length > 0) {
      const gap = makeGap('SCHEDULE_CAPACITY', destinationId, facets, 0, meaningful.length, knownAreas, knownAreas);
      const ledger = latestLedger(snapshot, gap.key);
      if (suppressedBy(ledger, policy, now)) limitations.push({ gap, ledger: ledger as LedgerEntry });
      else emitted.push(gap);
    }
  }

  emitted.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.key.localeCompare(b.key));
  return emitted.length === 0
    ? { verdict: 'READY', limitations, policyVersion: policy.version }
    : { verdict: 'GAPS', gaps: emitted, limitations, policyVersion: policy.version };
}
