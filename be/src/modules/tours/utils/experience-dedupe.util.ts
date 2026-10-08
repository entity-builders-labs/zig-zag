import { normalizeGeoName } from './nominatim-match.util';
import {
  SourceMemberShape,
  allSourceMembers,
  distinctResolvedGeoEntityIds,
  isResolvedSourceMember,
  resolvedSourceMembers,
} from './experience-source-membership.policy';

/**
 * One SOURCE MEMBER of a composition. A resolved member is identified by its
 * GeoEntity; an unresolved member (no GeoEntity) only by its source wording.
 * The source-defined composition is part of composite identity: a PARTIAL
 * A-B-C-D-E-F whose only resolved members are A and B is not the COMPLETE
 * A-B composition, and an unresolved member never becomes a shared `null`.
 */
export interface DedupeComponentFingerprint extends SourceMemberShape {
  geoEntityId: string | null;
  /** Source wording; the identity of an UNRESOLVED member. */
  sourceName?: string | null;
  role?: string | null;
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
  /**
   * The curated tourism CONCEPT (`metadata.themes` + `metadata.intents`),
   * as distinct real identity evidence from `canonicalName`/`semanticTerms`.
   * Free text (a title, a description) naturally shares generic
   * location/type words across genuinely different real Experiences over
   * the same real stops ("San Telmo Historical Walk" vs "San Telmo Food
   * Walk" both legitimately contain "San Telmo" and "Walk") -- that lexical
   * overlap reflects shared geography/format, not shared identity. Themes/
   * intents are curated category labels naming the actual concept, so a
   * real overlap here is compatible-identity evidence in a way raw word
   * overlap is not.
   */
  conceptTerms?: string[];
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
   * Overlap of curated `conceptTerms` (themes + intents) -- see
   * `DedupeExperienceFingerprint.conceptTerms`. Only FULL agreement
   * (`=== 1`) is ever treated as identity-compatible evidence — a
   * classification facet (theme/intent) is not identity, so a PARTIAL
   * match (e.g. sharing only a generic `intent: walk` while themes
   * differ) must never "upgrade" a structural match to SAME either;
   * unlike every other `setOverlap`-based signal in this file, both sides
   * being empty scores 0 here, not a vacuous 1 — themes/intents are
   * routinely absent pre-classification, and absence of concept data on
   * both sides is absence of evidence, never evidence of agreement.
   */
  conceptOverlap: number;
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
  // requires (a) no explicit evidenced-order conflict, AND (b) real
  // compatible IDENTITY evidence, not merely any shared word or shared
  // classification facet. Neither partial name overlap NOR partial (or
  // even any) concept/classification overlap is, by itself, that
  // evidence:
  //   - Two independently evidenced Experiences over the exact same real
  //     stops can legitimately share generic location/format words in
  //     their names ("San Telmo Historical Walk" vs "San Telmo Food Walk"
  //     both truthfully contain "San Telmo" and "Walk").
  //   - `theme`/`intent` are CLASSIFICATION facets, not identity: two
  //     genuinely different real Experiences over the identical stops can
  //     legitimately share an intent ("multiple distinct Experiences with
  //     intent=walk in the same scope" is explicitly valid design) or a
  //     theme label independently of whether they are the same physical
  //     composition. A classification facet therefore can never be the
  //     thing that "upgrades" a structural match to SAME, whether the
  //     overlap is partial (one shared intent, differing theme) OR total
  //     absence on both sides (silently treating "no one classified
  //     either side" as agreement is not identity evidence either --
  //     `conceptOverlap` special-cases empty/empty to 0, unlike every
  //     other overlap signal in this file).
  // Compatible identity evidence is therefore either of:
  //   - the two names being IDENTICAL after normalization
  //     (nameSimilarity === 1) -- on its own already a very strong,
  //     unambiguous textual identity signal, independent of concept; or
  //   - the two sides' curated CONCEPT being IN FULL AGREEMENT
  //     (conceptOverlap === 1 -- every theme/intent token on one side is
  //     matched by the other, real non-vacuous data on both sides). Full
  //     agreement across the WHOLE curated concept is meaningfully
  //     different from "shares one generic facet" -- it is two
  //     independent sources converging on the SAME complete
  //     classification, not merely both happening to be tagged `walk`.
  // Neither is a tuned magic threshold: both are the same "===1, full
  // agreement, not partial" pattern already required of
  // componentOverlap/roleAwareComponentOverlap above. Absent one of
  // these, a perfect component match alone resolves to AMBIGUOUS below,
  // exactly like the partial-overlap case -- never a confident NEW, never
  // a silent SAME.
  const exactStructure =
    best.evidence.roleAwareComponentOverlap === 1 &&
    best.evidence.componentOverlap === 1 &&
    (best.evidence.nameSimilarity === 1 ||
      best.evidence.conceptOverlap === 1) &&
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

  const ambiguous = ranked.filter(({ candidate, evidence }) => {
    // Canonical domain rule: a standalone Experience and a source-backed
    // composite may legitimately point at the SAME GeoEntity (§16 of the
    // component-resolution amendment). In that 1-vs-many shape, shared
    // component membership is expected catalog structure, not identity
    // ambiguity. Keep measuring the structural overlap for audit/ranking,
    // but do not let component overlap ALONE fail-close either Experience.
    //
    // Independent identity signals still apply: the same/similar name or
    // strong semantic overlap may still make the pair AMBIGUOUS. And
    // composite-vs-composite overlap keeps the existing conservative policy.
    const standaloneComposite = isStandaloneCompositeComparison(
      incoming,
      candidate,
    );
    return (
      evidence.nameSimilarity >= 0.72 ||
      evidence.semanticSimilarity >= 0.58 ||
      (!standaloneComposite &&
        (evidence.componentOverlap >= 0.5 ||
          evidence.roleAwareComponentOverlap >= 0.4))
    );
  });

  if (ambiguous.length) {
    const bestAmbiguous = ambiguous[0];
    return {
      decision: 'AMBIGUOUS',
      candidates: ambiguous.slice(0, 5).map(({ candidate }) => candidate.id),
      evidence: {
        ...bestAmbiguous.evidence,
        reasons: [
          ...bestAmbiguous.evidence.reasons,
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
  const incomingIds = new Set(sourceMemberKeys(incoming));
  const existingIds = new Set(sourceMemberKeys(existing));
  const componentOverlap = setOverlap(incomingIds, existingIds);

  const incomingRoleKeys = new Set(
    allSourceMembers(incoming).map(
      (component) =>
        `${normalize(component.role ?? 'component')}|${sourceMemberKey(component)}`,
    ),
  );
  const existingRoleKeys = new Set(
    allSourceMembers(existing).map(
      (component) =>
        `${normalize(component.role ?? 'component')}|${sourceMemberKey(component)}`,
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
  const conceptOverlap = conceptOverlapScore(
    conceptTokenSet(incoming),
    conceptTokenSet(existing),
  );
  const distanceKm = haversineKm(incoming, existing);
  const orderConflict = hasConflictingEvidencedOrder(
    resolvedSourceMembers(incoming),
    resolvedSourceMembers(existing),
  );

  const reasons: string[] = [];
  if (nameSimilarity === 1) reasons.push('same_normalized_name');
  else if (nameSimilarity >= 0.72) reasons.push('similar_name');
  if (semanticSimilarity >= 0.72) reasons.push('strong_semantic_overlap');
  else if (semanticSimilarity >= 0.58) reasons.push('partial_semantic_overlap');
  if (componentOverlap > 0) reasons.push('shared_geo_entities');
  if (
    componentOverlap > 0 &&
    isStandaloneCompositeComparison(incoming, existing)
  ) {
    reasons.push('standalone_composite_shared_membership');
  }
  if (roleAwareComponentOverlap > 0)
    reasons.push('shared_role_aware_components');
  if (distanceKm != null && distanceKm <= 1.5)
    reasons.push('geographically_close');
  if (provenanceOverlap > 0) reasons.push('shared_provenance');
  if (conceptOverlap > 0) reasons.push('shared_concept_evidence');
  if (orderConflict) reasons.push('conflicting_evidenced_order');

  return {
    nameSimilarity,
    semanticSimilarity,
    componentOverlap,
    roleAwareComponentOverlap,
    distanceKm,
    provenanceOverlap,
    conceptOverlap,
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

/**
 * Identity key of one source member inside a dedupe comparison: its
 * GeoEntity when resolved, else its normalized source wording. Never a bare
 * `null`, so two unrelated PARTIAL Experiences never share a fake member.
 */
function sourceMemberKey(component: DedupeComponentFingerprint): string {
  const resolved: boolean = isResolvedSourceMember(component);
  return resolved
    ? `geo:${component.geoEntityId}`
    : `source:${normalizeGeoName(component.sourceName ?? '')}`;
}

function sourceMemberKeys(
  fingerprint: Pick<DedupeExperienceFingerprint, 'components'>,
): string[] {
  return allSourceMembers(fingerprint).map(sourceMemberKey);
}

/**
 * A canonical standalone Experience has one DISTINCT resolved GeoEntity; a
 * composite has more than one. Array length is intentionally not used:
 * duplicate rows for the same GeoEntity, and unresolved members, must never
 * manufacture composite identity semantics.
 */
function isStandaloneCompositeComparison(
  left: Pick<DedupeExperienceFingerprint, 'components'>,
  right: Pick<DedupeExperienceFingerprint, 'components'>,
): boolean {
  const leftCount = distinctResolvedGeoEntityIds(left).length;
  const rightCount = distinctResolvedGeoEntityIds(right).length;
  return (
    (leftCount === 1 && rightCount > 1) || (rightCount === 1 && leftCount > 1)
  );
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

function conceptTokenSet(
  fingerprint: DedupeExperienceFingerprint,
): Set<string> {
  return new Set(
    (fingerprint.conceptTerms ?? [])
      .flatMap((value) => normalize(value).split(' '))
      .filter(Boolean),
  );
}

/**
 * Deliberately NOT the generic `setOverlap` convention: every other
 * overlap signal in this file treats an empty/empty pair as vacuous full
 * agreement (1), which is harmless for signals that are always populated
 * in practice (components, canonicalName). `conceptTerms` is themes/
 * intents, which are routinely EMPTY (pre-classification, e.g. before B2/
 * B6 run) -- two totally unrelated, unclassified Experiences must not be
 * treated as agreeing on concept merely because neither has been
 * classified yet. Absence of concept evidence on both sides is absence
 * of evidence, not evidence of compatibility, so it scores 0 here, never
 * 1.
 */
function conceptOverlapScore(left: Set<string>, right: Set<string>): number {
  if (!left.size && !right.size) return 0;
  return setOverlap(left, right);
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
    conceptOverlap: 0,
    orderConflict: false,
    reasons: [reason],
  };
}
