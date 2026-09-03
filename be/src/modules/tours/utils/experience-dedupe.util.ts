export interface DedupeComponentFingerprint {
  geoEntityId: string;
  role?: string | null;
  required?: boolean | null;
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
  const exactStructure =
    best.evidence.nameSimilarity === 1 &&
    best.evidence.roleAwareComponentOverlap === 1 &&
    best.evidence.componentOverlap === 1;
  const strongConsistentIdentity =
    best.evidence.nameSimilarity >= 0.86 &&
    best.evidence.semanticSimilarity >= 0.72 &&
    best.evidence.roleAwareComponentOverlap >= 0.8 &&
    (best.evidence.distanceKm == null || best.evidence.distanceKm <= 1.5);

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

  return {
    nameSimilarity,
    semanticSimilarity,
    componentOverlap,
    roleAwareComponentOverlap,
    distanceKm,
    provenanceOverlap,
    reasons,
  };
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
    reasons: [reason],
  };
}
