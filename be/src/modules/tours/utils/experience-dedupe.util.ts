export interface DedupeComponentFingerprint {
  geoEntityId: string;
  role?: string | null;
  required?: boolean | null;
  /**
   * `ExperienceComponent.order` — identity-relevant ONLY when real,
   * persisted evidence establishes a genuine visiting sequence (spec: "no
   * manufactured order when order is null"). `null`/absent means no
   * intrinsic sequence evidence exists and must never participate in an
   * order comparison.
   */
  order?: number | null;
}

export interface DedupeExperienceFingerprint {
  id?: string;
  canonicalName: string;
  semanticTerms?: string[];
  latitude?: number | null;
  longitude?: number | null;
  components: DedupeComponentFingerprint[];
  provenance?: string[];
}

export interface DedupeEvidence {
  nameSimilarity: number;
  semanticSimilarity: number;
  componentOverlap: number;
  roleAwareComponentOverlap: number;
  distanceKm: number | null;
  provenanceOverlap: number;
  /**
   * True only when BOTH sides carry a real (non-null) evidenced order for
   * at least 2 of the same real components, AND those two evidenced
   * sequences genuinely disagree. A perfect component/role match must
   * never become SAME when this is true — two sources describing the
   * same real stops in explicitly conflicting sequences are, at best, an
   * open identity question, never an automatic match.
   */
  orderConflict: boolean;
  reasons: string[];
}

export type DedupeDecision =
  | {
      decision: 'SAME';
      canonicalExperienceId: string;
      evidence: DedupeEvidence;
    }
  | {
      decision: 'NEW';
      evidence: DedupeEvidence;
    }
  | {
      decision: 'AMBIGUOUS';
      candidates: string[];
      evidence: DedupeEvidence;
    };

export function decideExperienceDedupe(
  incoming: DedupeExperienceFingerprint,
  existing: DedupeExperienceFingerprint[],
): DedupeDecision {
  const ranked = existing
    .filter(
      (candidate): candidate is DedupeExperienceFingerprint & { id: string } =>
        !!candidate.id,
    )
    .map((candidate) => ({
      candidate,
      evidence: compareFingerprints(incoming, candidate),
    }))
    .sort((a, b) => evidenceScore(b.evidence) - evidenceScore(a.evidence));

  if (!ranked.length) {
    return {
      decision: 'NEW',
      evidence: emptyEvidence('no_existing_candidates'),
    };
  }

  const best = ranked[0];
  // A COMPLETE, role-consistent match of the real component set (every
  // required real place, in the same role, on both sides -- not a
  // partial/threshold overlap) is a very strong identity signal: two
  // sources describing literally the same real physical composition.
  // Display-name wording legitimately varies across independent sources
  // ("San Telmo Historical Walking Tour" vs "Historical Walk through San
  // Telmo" for the identical real stops), so byte-identical names must
  // never be required. But it is NOT unilateral identity authority
  // (hard invariant 7: "component overlap alone cannot force SAME") --
  // two independently evidenced Experiences can legitimately share the
  // exact same real stops/roles while representing different tourism
  // concepts, or describe the same component set in explicitly
  // conflicting sequences. `exactStructure` therefore additionally
  // requires: (a) at least SOME real textual/identity relationship
  // between the two sources (nameSimilarity > 0 -- not a tuned
  // threshold, the natural floor between "no lexical connection at all"
  // and "some"), and (b) no explicit evidenced-order conflict. Absent
  // that minimal compatibility, a perfect component match alone resolves
  // to AMBIGUOUS below, exactly like the partial-overlap case -- never a
  // confident NEW, never a silent SAME.
  const exactStructure =
    best.evidence.roleAwareComponentOverlap === 1 &&
    best.evidence.componentOverlap === 1 &&
    best.evidence.nameSimilarity > 0 &&
    !best.evidence.orderConflict;
  const strongConsistentIdentity =
    best.evidence.nameSimilarity >= 0.86 &&
    best.evidence.semanticSimilarity >= 0.72 &&
    best.evidence.roleAwareComponentOverlap >= 0.8 &&
    (best.evidence.distanceKm == null || best.evidence.distanceKm <= 1.5) &&
    !best.evidence.orderConflict;

  if (exactStructure || strongConsistentIdentity) {
    return {
      decision: 'SAME',
      canonicalExperienceId: best.candidate.id,
      evidence: {
        ...best.evidence,
        reasons: [
          ...best.evidence.reasons,
          exactStructure ? 'exact_structure' : 'strong_consistent_identity',
        ],
      },
    };
  }

  const ambiguous = ranked.filter(
    ({ evidence }) =>
      evidence.nameSimilarity >= 0.72 ||
      evidence.semanticSimilarity >= 0.58 ||
      evidence.componentOverlap >= 0.5 ||
      evidence.roleAwareComponentOverlap >= 0.4,
  );

  if (ambiguous.length) {
    return {
      decision: 'AMBIGUOUS',
      candidates: ambiguous.slice(0, 5).map(({ candidate }) => candidate.id),
      evidence: {
        ...best.evidence,
        reasons: [
          ...best.evidence.reasons,
          'identity_signals_conflict_or_are_incomplete',
        ],
      },
    };
  }

  return {
    decision: 'NEW',
    evidence: {
      ...best.evidence,
      reasons: [...best.evidence.reasons, 'insufficient_identity_overlap'],
    },
  };
}

export function compareFingerprints(
  incoming: DedupeExperienceFingerprint,
  existing: DedupeExperienceFingerprint,
): DedupeEvidence {
  const nameSimilarity = tokenJaccard(
    incoming.canonicalName,
    existing.canonicalName,
  );
  const semanticSimilarity = setOverlap(
    semanticTokenSet(incoming),
    semanticTokenSet(existing),
  );
  const incomingIds = new Set(
    incoming.components.map((component) => component.geoEntityId),
  );
  const existingIds = new Set(
    existing.components.map((component) => component.geoEntityId),
  );
  const componentOverlap = setOverlap(incomingIds, existingIds);

  const incomingRoleKeys = new Set(
    incoming.components.map(
      (component) =>
        `${normalize(component.role ?? 'component')}|${component.geoEntityId}`,
    ),
  );
  const existingRoleKeys = new Set(
    existing.components.map(
      (component) =>
        `${normalize(component.role ?? 'component')}|${component.geoEntityId}`,
    ),
  );
  const roleAwareComponentOverlap = setOverlap(
    incomingRoleKeys,
    existingRoleKeys,
  );

  const incomingProvenance = new Set(
    (incoming.provenance ?? []).map(normalize),
  );
  const existingProvenance = new Set(
    (existing.provenance ?? []).map(normalize),
  );
  const provenanceOverlap = setOverlap(incomingProvenance, existingProvenance);
  const distanceKm = haversineKm(incoming, existing);
  const orderConflict = hasConflictingEvidencedOrder(
    incoming.components,
    existing.components,
  );

  const reasons: string[] = [];
  if (nameSimilarity === 1) reasons.push('same_normalized_name');
  else if (nameSimilarity >= 0.72) reasons.push('similar_name');
  if (semanticSimilarity >= 0.72) reasons.push('strong_semantic_overlap');
  else if (semanticSimilarity >= 0.58) reasons.push('partial_semantic_overlap');
  if (componentOverlap > 0) reasons.push('shared_geo_entities');
  if (roleAwareComponentOverlap > 0)
    reasons.push('shared_role_aware_components');
  if (distanceKm != null && distanceKm <= 1.5)
    reasons.push('geographically_close');
  if (provenanceOverlap > 0) reasons.push('shared_provenance');
  if (orderConflict) reasons.push('conflicting_evidenced_order');

  return {
    nameSimilarity,
    semanticSimilarity,
    componentOverlap,
    roleAwareComponentOverlap,
    distanceKm,
    provenanceOverlap,
    orderConflict,
    reasons,
  };
}

/**
 * True only when BOTH sides carry a real, persisted evidenced order
 * (`order != null`) for at least two of the SAME real components, and the
 * relative sequence those two evidenced orders induce over that shared
 * subset genuinely disagrees. A component with no evidenced order on
 * either side never participates -- "no manufactured order when order is
 * null" (spec §9). Two proposals sharing every real stop but describing
 * them in explicitly conflicting sequences (A->B->C->D vs D->C->B->A) is
 * real identity-relevant evidence AGAINST a confident SAME, independent
 * of how similar their names/themes otherwise look.
 */
function hasConflictingEvidencedOrder(
  incoming: DedupeComponentFingerprint[],
  existing: DedupeComponentFingerprint[],
): boolean {
  const existingOrderById = new Map(
    existing
      .filter((component) => component.order != null)
      .map((component) => [component.geoEntityId, component.order as number]),
  );
  const sharedOrderedIncoming = incoming
    .filter(
      (component) =>
        component.order != null && existingOrderById.has(component.geoEntityId),
    )
    .sort((a, b) => (a.order as number) - (b.order as number));

  if (sharedOrderedIncoming.length < 2) return false;

  const incomingSequence = sharedOrderedIncoming.map(
    (component) => component.geoEntityId,
  );
  const existingSequence = [...sharedOrderedIncoming]
    .sort(
      (a, b) =>
        existingOrderById.get(a.geoEntityId)! -
        existingOrderById.get(b.geoEntityId)!,
    )
    .map((component) => component.geoEntityId);

  return incomingSequence.join('|') !== existingSequence.join('|');
}

function evidenceScore(evidence: DedupeEvidence): number {
  const distanceBonus =
    evidence.distanceKm == null
      ? 0
      : evidence.distanceKm <= 0.5
        ? 0.08
        : evidence.distanceKm <= 1.5
          ? 0.04
          : 0;
  return (
    evidence.nameSimilarity * 0.22 +
    evidence.semanticSimilarity * 0.2 +
    evidence.componentOverlap * 0.15 +
    evidence.roleAwareComponentOverlap * 0.3 +
    evidence.provenanceOverlap * 0.05 +
    distanceBonus
  );
}

function semanticTokenSet(
  fingerprint: DedupeExperienceFingerprint,
): Set<string> {
  return new Set(
    [fingerprint.canonicalName, ...(fingerprint.semanticTerms ?? [])]
      .flatMap((value) => normalize(value).split(' '))
      .filter(Boolean),
  );
}

function tokenJaccard(left: string, right: string): number {
  const a = new Set(normalize(left).split(' ').filter(Boolean));
  const b = new Set(normalize(right).split(' ').filter(Boolean));
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function setOverlap<T>(left: Set<T>, right: Set<T>): number {
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / Math.max(left.size, right.size);
}

function haversineKm(
  left: Pick<DedupeExperienceFingerprint, 'latitude' | 'longitude'>,
  right: Pick<DedupeExperienceFingerprint, 'latitude' | 'longitude'>,
): number | null {
  if (
    !Number.isFinite(left.latitude) ||
    !Number.isFinite(left.longitude) ||
    !Number.isFinite(right.latitude) ||
    !Number.isFinite(right.longitude)
  ) {
    return null;
  }
  const toRad = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRad(left.latitude as number);
  const lat2 = toRad(right.latitude as number);
  const deltaLat = toRad(
    (right.latitude as number) - (left.latitude as number),
  );
  const deltaLon = toRad(
    (right.longitude as number) - (left.longitude as number),
  );
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function emptyEvidence(reason: string): DedupeEvidence {
  return {
    nameSimilarity: 0,
    semanticSimilarity: 0,
    componentOverlap: 0,
    roleAwareComponentOverlap: 0,
    distanceKm: null,
    provenanceOverlap: 0,
    orderConflict: false,
    reasons: [reason],
  };
}
