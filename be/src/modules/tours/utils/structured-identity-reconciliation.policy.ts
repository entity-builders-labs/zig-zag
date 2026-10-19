/**
 * Structured identity reconciliation (design C8). Merges canonical provider
 * records that represent one physical identity, using strong/supporting
 * evidence tiers, fail-closed ambiguity and a deterministic survivor.
 * Embeddings and name/coordinate *similarity* never establish identity —
 * only exact canonical-name equality, geometry correspondence and compatible
 * canonical classes (supporting), or a strong evidence tier.
 */

export type ReconciliationOsmType = 'node' | 'way' | 'relation';
export const STRUCTURED_IDENTITY_RECONCILIATION_VERSION =
  'structured-identity-v1';

export type ReconciliationGeometry =
  | { kind: 'POINT'; latitude: number; longitude: number }
  | { kind: 'AREA'; west: number; south: number; east: number; north: number };

export interface ReconciliationRecord {
  id: string;
  /** Provider-native id (e.g. `osm:node:3348573778`). Identical ids merge. */
  providerId?: string;
  osmType?: ReconciliationOsmType;
  qid?: string;
  /** Canonically normalized primary names and aliases (equality, not similarity). */
  names: string[];
  geometry?: ReconciliationGeometry;
  canonicalClass?: string;
  /** Provider-native ids of the way/relation records this node is a member of. */
  memberOfIds?: string[];
  /** Explicit provider cross-links to other records' provider-native ids. */
  crossLinkIds?: string[];
}

export type MergeBasis =
  | 'IDENTICAL_PROVIDER_ID'
  | 'SHARED_QID'
  | 'STRUCTURAL_RELATIONSHIP'
  | 'EXPLICIT_CROSS_LINK'
  | 'STRUCTURAL_CORRESPONDENCE';

export interface MergeRecord {
  kept: string;
  merged: string[];
  basis: MergeBasis;
  evidence: string[];
}

export type PossibleDuplicateReason =
  | 'NO_STRONG_EVIDENCE'
  | 'CONFLICTING_QID'
  | 'AMBIGUOUS_MATCH'
  | 'NAME_ONLY'
  | 'GEOMETRY_ONLY';

export interface PossibleDuplicateRecord {
  left: string;
  right: string;
  reason: PossibleDuplicateReason;
}

export interface StructuredReconciliationResult {
  canonical: string[];
  merges: MergeRecord[];
  possibleDuplicates: PossibleDuplicateRecord[];
}

function namesOverlap(
  a: ReconciliationRecord,
  b: ReconciliationRecord,
): boolean {
  return a.names.some((name) => b.names.includes(name));
}

function pointInArea(
  point: Extract<ReconciliationGeometry, { kind: 'POINT' }>,
  area: Extract<ReconciliationGeometry, { kind: 'AREA' }>,
): boolean {
  return (
    point.longitude >= area.west &&
    point.longitude <= area.east &&
    point.latitude >= area.south &&
    point.latitude <= area.north
  );
}

function geometryCorresponds(
  a: ReconciliationGeometry | undefined,
  b: ReconciliationGeometry | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.kind === 'POINT' && b.kind === 'AREA') return pointInArea(a, b);
  if (a.kind === 'AREA' && b.kind === 'POINT') return pointInArea(b, a);
  return false;
}

function classesCompatible(
  a: ReconciliationRecord,
  b: ReconciliationRecord,
): boolean {
  return a.canonicalClass === b.canonicalClass;
}

function conflictingQid(
  a: ReconciliationRecord,
  b: ReconciliationRecord,
): boolean {
  return a.qid !== undefined && b.qid !== undefined && a.qid !== b.qid;
}

/** A small deterministic union-find over record indices. */
class DisjointSet {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function survivorRank(record: ReconciliationRecord): number {
  // way/relation over node; then provider id order.
  return record.osmType === 'node' ? 1 : 0;
}

export function reconcileStructuredRecords(
  records: readonly ReconciliationRecord[],
): StructuredReconciliationResult {
  const items = [...records];
  const n = items.length;
  const byProviderId = new Map<string, number[]>();
  const byQid = new Map<string, number[]>();
  const indexByProviderId = new Map<string, number>();

  items.forEach((record, i) => {
    if (record.providerId) {
      const list = byProviderId.get(record.providerId) ?? [];
      list.push(i);
      byProviderId.set(record.providerId, list);
      indexByProviderId.set(record.providerId, i);
    }
    if (record.qid) {
      const list = byQid.get(record.qid) ?? [];
      list.push(i);
      byQid.set(record.qid, list);
    }
  });

  const set = new DisjointSet(n);
  const mergeBasis = new Map<
    number,
    { basis: MergeBasis; evidence: string[] }
  >();

  const recordMerge = (
    a: number,
    b: number,
    basis: MergeBasis,
    evidence: string[],
  ) => {
    set.union(a, b);
    const root = set.find(a);
    const existing = mergeBasis.get(root);
    if (!existing) {
      mergeBasis.set(root, { basis, evidence });
    } else {
      mergeBasis.set(root, {
        basis,
        evidence: [...new Set([...existing.evidence, ...evidence])],
      });
    }
  };

  // Strong: identical provider-native id.
  for (const [, idxs] of byProviderId) {
    for (let i = 1; i < idxs.length; i++) {
      recordMerge(idxs[0], idxs[i], 'IDENTICAL_PROVIDER_ID', [
        items[idxs[i]].providerId!,
      ]);
    }
  }

  // Strong: shared Wikidata QID.
  for (const [qid, idxs] of byQid) {
    for (let i = 1; i < idxs.length; i++) {
      recordMerge(idxs[0], idxs[i], 'SHARED_QID', [qid]);
    }
  }

  // Strong: OSM structural relationship (node member of a way/relation).
  for (let i = 0; i < n; i++) {
    const record = items[i];
    for (const memberOf of record.memberOfIds ?? []) {
      const j = indexByProviderId.get(memberOf);
      if (j !== undefined && !conflictingQid(record, items[j])) {
        recordMerge(i, j, 'STRUCTURAL_RELATIONSHIP', [memberOf]);
      }
    }
  }

  // Strong: explicit provider cross-link.
  for (let i = 0; i < n; i++) {
    const record = items[i];
    for (const crossLink of record.crossLinkIds ?? []) {
      const j = indexByProviderId.get(crossLink);
      if (j !== undefined && !conflictingQid(record, items[j])) {
        recordMerge(i, j, 'EXPLICIT_CROSS_LINK', [crossLink]);
      }
    }
  }

  // Supporting: structural correspondence (exact name + geometry + class,
  // exactly one match, no conflicting QIDs/provider ids).
  const possibleDuplicates: PossibleDuplicateRecord[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (set.find(i) === set.find(j)) continue;
      const a = items[i];
      const b = items[j];
      const nameMatch = namesOverlap(a, b);
      const geometryMatch = geometryCorresponds(a.geometry, b.geometry);
      if (!nameMatch && !geometryMatch) continue;

      if (conflictingQid(a, b)) {
        possibleDuplicates.push({
          left: a.id,
          right: b.id,
          reason: 'CONFLICTING_QID',
        });
        continue;
      }
      if (nameMatch && geometryMatch) {
        if (!classesCompatible(a, b)) {
          possibleDuplicates.push({
            left: a.id,
            right: b.id,
            reason: 'NO_STRONG_EVIDENCE',
          });
          continue;
        }
        const others = items.filter(
          (c, k) =>
            k !== i &&
            k !== j &&
            namesOverlap(a, c) &&
            geometryCorresponds(a.geometry, c.geometry),
        );
        if (others.length > 0) {
          possibleDuplicates.push({
            left: a.id,
            right: b.id,
            reason: 'AMBIGUOUS_MATCH',
          });
        } else {
          recordMerge(i, j, 'STRUCTURAL_CORRESPONDENCE', [
            ...new Set([...a.names, ...b.names]),
          ]);
        }
      } else if (nameMatch) {
        possibleDuplicates.push({
          left: a.id,
          right: b.id,
          reason: 'NAME_ONLY',
        });
      } else {
        possibleDuplicates.push({
          left: a.id,
          right: b.id,
          reason: 'GEOMETRY_ONLY',
        });
      }
    }
  }

  // Group by root; deterministic survivor; canonicalized fields.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = set.find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  const merges: MergeRecord[] = [];
  const canonical: string[] = [];
  for (const [root, idxs] of groups) {
    const sorted = [...idxs].sort((a, b) => {
      const rank = survivorRank(items[a]) - survivorRank(items[b]);
      if (rank !== 0) return rank;
      return (items[a].providerId ?? items[a].id).localeCompare(
        items[b].providerId ?? items[b].id,
      );
    });
    const kept = items[sorted[0]].id;
    canonical.push(kept);
    if (sorted.length > 1) {
      const basisInfo = mergeBasis.get(root);
      merges.push({
        kept,
        merged: sorted.slice(1).map((i) => items[i].id),
        basis: basisInfo?.basis ?? 'STRUCTURAL_CORRESPONDENCE',
        evidence: basisInfo?.evidence ?? [],
      });
    }
  }

  return { canonical: canonical.sort(), merges, possibleDuplicates };
}
