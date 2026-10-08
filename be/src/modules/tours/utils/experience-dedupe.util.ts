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
  /** Evidence channels (`ExperienceEvidence.source`, e.g. `web`). Ranking only. */
  provenance?: string[];
  /**
   * Source DOCUMENT identities: the evidence URLs this composition was
   * extracted from. The only source identity the catalog persists. Titles
   * and descriptions are never source identity.
   */
  sourceDocuments?: string[];
}

/**
 * Deterministic structural relation between two source-defined
 * compositions, derived only from their source members:
 *
 *  - EXACT_COMPOSITION: the same source-member set (a resolved member is
 *    its GeoEntity, an unresolved one its source wording), so a PARTIAL
 *    composition seen twice is exact without every member resolving;
 *  - SUBCOMPOSITION: one member set strictly contained in the other, with
 *    no conflicting evidenced order over the shared members;
 *  - PARTIAL_OVERLAP: they share at least one resolved GeoEntity but
 *    neither contains the other (or evidenced order conflicts);
 *  - DISJOINT: no shared resolved GeoEntity. Shared unresolved wording
 *    alone is never shared structure.
 *
 * Text (names, descriptions, themes) never enters this relation.
 */
export type StructuralCompositionRelation =
  | 'EXACT_COMPOSITION'
  | 'SUBCOMPOSITION'
  | 'PARTIAL_OVERLAP'
  | 'DISJOINT';

/** Which side of a SUBCOMPOSITION is the contained one. */
export type SubcompositionContainment =
  | 'INCOMING_WITHIN_EXISTING'
  | 'EXISTING_WITHIN_INCOMING';

/**
 * Source-document relation of two compositions, from evidence URLs only:
 * SAME_SOURCE when they share a source document, DIFFERENT_SOURCE when both
 * have source documents and share none, SOURCE_UNKNOWN otherwise.
 */
export type SourceProvenanceRelation =
  | 'SAME_SOURCE'
  | 'DIFFERENT_SOURCE'
  | 'SOURCE_UNKNOWN';

export interface StructuralCompositionEvidence {
  relation: StructuralCompositionRelation;
  containment: SubcompositionContainment | null;
  sharedResolvedGeoEntityIds: string[];
  sourceMemberCounts: { incoming: number; existing: number };
}

/**
 * The structural/provenance fact that decided a comparison. Never a
 * similarity score.
 */
export type DedupeDecisiveEvidence =
  | 'NO_EXISTING_CANDIDATES'
  | 'EXACT_COMPOSITION_IDENTITY_CONFIRMED'
  | 'EXACT_COMPOSITION_IDENTITY_UNCONFIRMED'
  | 'STRUCTURAL_OVERLAP_WITH_SIMILAR_NAME'
  | 'SIMILAR_NAME_WITHOUT_SHARED_STRUCTURE'
  | 'PARTIAL_OVERLAP_IDENTITY_UNRESOLVED'
  | 'PARTIAL_OVERLAP_INSUFFICIENT'
  | 'STANDALONE_COMPOSITE_MEMBERSHIP'
  | 'SUBCOMPOSITION_SAME_SOURCE_CONTAINMENT'
  | 'SUBCOMPOSITION_DIFFERENT_SOURCE'
  | 'SUBCOMPOSITION_SOURCE_UNKNOWN'
  | 'STRUCTURALLY_DISJOINT';

export interface DedupeEvidence {
  nameSimilarity: number;
  /**
   * Lexical token overlap of name + description + themes/intents/traits.
   * DIAGNOSTIC and candidate-ranking only: it never decides SAME,
   * AMBIGUOUS or NEW (identity spec §6.1). It is uncalibrated and depends
   * on which side carries persisted trait rows.
   */
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
  structure: StructuralCompositionEvidence;
  sourceRelation: SourceProvenanceRelation;
  /** Set on the evidence of a final decision; null on raw comparisons. */
  decisiveEvidence: DedupeDecisiveEvidence | null;
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
  // Ranking only orders candidates (which exact duplicate is canonical, which
  // conflicting ids are reported first). It never decides identity: every
  // candidate is judged by the same structural policy below.
  const judged = existing
    .filter(
      (candidate): candidate is DedupeExperienceFingerprint & { id: string } =>
        !!candidate.id,
    )
    .map((candidate) => {
      const evidence = compareFingerprints(incoming, candidate);
      return {
        candidate,
        evidence,
        verdict: judgeDedupeComparison(
          evidence,
          isStandaloneCompositeComparison(incoming, candidate),
        ),
      };
    })
    .sort((a, b) => evidenceScore(b.evidence) - evidenceScore(a.evidence));

  if (!judged.length) {
    return {
      decision: 'NEW',
      evidence: emptyEvidence(
        'no_existing_candidates',
        allSourceMembers(incoming).length,
      ),
    };
  }

  const decided = (
    entry: (typeof judged)[number],
    reason: string,
  ): DedupeEvidence => ({
    ...entry.evidence,
    decisiveEvidence: entry.verdict.decisiveEvidence,
    reasons: [...entry.evidence.reasons, reason],
  });

  const same = judged.find(({ verdict }) => verdict.identity === 'SAME');
  if (same) {
    return {
      decision: 'SAME',
      canonicalExperienceId: same.candidate.id,
      evidence: decided(same, 'exact_structure'),
    };
  }

  const ambiguous = judged.filter(
    ({ verdict }) => verdict.identity === 'AMBIGUOUS',
  );
  if (ambiguous.length) {
    return {
      decision: 'AMBIGUOUS',
      candidates: ambiguous.slice(0, 5).map(({ candidate }) => candidate.id),
      evidence: decided(
        ambiguous[0],
        'identity_signals_conflict_or_are_incomplete',
      ),
    };
  }

  return {
    decision: 'NEW',
    evidence: decided(judged[0], 'insufficient_identity_overlap'),
  };
}

interface DedupeComparisonVerdict {
  identity: 'SAME' | 'AMBIGUOUS' | 'DISTINCT';
  decisiveEvidence: DedupeDecisiveEvidence;
}

/**
 * THE Experience identity policy for one comparison: structural relation +
 * source provenance + the existing strong identity evidence. Text
 * similarity is never decisive on its own (identity spec §6.1):
 *
 * | relation          | outcome                                             |
 * | ----------------- | --------------------------------------------------- |
 * | EXACT_COMPOSITION | SAME when roles agree, the name is identical or the |
 * |                   | curated concept fully agrees, and evidenced order   |
 * |                   | does not conflict; else AMBIGUOUS                   |
 * | SUBCOMPOSITION    | never SAME. AMBIGUOUS only with a similar name;     |
 * |                   | else DISTINCT (coexist), whatever the source        |
 * |                   | relation (same-source containment is recorded, not  |
 * |                   | persisted: explicit CONTAINS relations are future   |
 * |                   | work)                                               |
 * | PARTIAL_OVERLAP   | AMBIGUOUS with a similar name, or composite-vs-     |
 * |                   | composite structural overlap; else DISTINCT         |
 * | DISJOINT          | AMBIGUOUS with a similar name; else DISTINCT        |
 *
 * The similar-name rule is the one remaining text-based AMBIGUOUS
 * authority. It is kept unchanged as explicit follow-up debt (the 0.72 cut
 * is uncalibrated, like the composite overlap cuts); removing it would flip
 * accepted same-name cases and is out of this milestone's scope. Lexical
 * semantic overlap has no decision authority at all. Shared membership
 * between a standalone Experience and a composite is never identity by
 * itself (§6.1).
 *
 * Every input is symmetric in the two sides, so the identity outcome does
 * not depend on which Experience was persisted first.
 */
function judgeDedupeComparison(
  evidence: DedupeEvidence,
  standaloneComposite: boolean,
): DedupeComparisonVerdict {
  // Uncalibrated cuts inherited from 57d2dfcf; explicit follow-up debt
  // (semantic-overlap forensic 2026-10-08 §12.7).
  const similarName = evidence.nameSimilarity >= 0.72;
  const compositeStructuralOverlap =
    !standaloneComposite &&
    (evidence.componentOverlap >= 0.5 ||
      evidence.roleAwareComponentOverlap >= 0.4);

  switch (evidence.structure.relation) {
    case 'EXACT_COMPOSITION': {
      // Hard invariants 7 and 8: neither the shared component set nor
      // text alone forces SAME. Roles must agree, the evidenced order must
      // not conflict, and an independent identity signal must agree:
      // identical normalized names, or full curated-concept agreement (a
      // shared generic facet or an empty/empty concept is not agreement).
      const identityConfirmed =
        evidence.roleAwareComponentOverlap === 1 &&
        (evidence.nameSimilarity === 1 || evidence.conceptOverlap === 1) &&
        !evidence.orderConflict;
      return identityConfirmed
        ? {
            identity: 'SAME',
            decisiveEvidence: 'EXACT_COMPOSITION_IDENTITY_CONFIRMED',
          }
        : {
            identity: 'AMBIGUOUS',
            decisiveEvidence: 'EXACT_COMPOSITION_IDENTITY_UNCONFIRMED',
          };
    }
    case 'SUBCOMPOSITION':
      if (similarName) {
        return {
          identity: 'AMBIGUOUS',
          decisiveEvidence: 'STRUCTURAL_OVERLAP_WITH_SIMILAR_NAME',
        };
      }
      return {
        identity: 'DISTINCT',
        decisiveEvidence: standaloneComposite
          ? 'STANDALONE_COMPOSITE_MEMBERSHIP'
          : evidence.sourceRelation === 'SAME_SOURCE'
            ? 'SUBCOMPOSITION_SAME_SOURCE_CONTAINMENT'
            : evidence.sourceRelation === 'DIFFERENT_SOURCE'
              ? 'SUBCOMPOSITION_DIFFERENT_SOURCE'
              : 'SUBCOMPOSITION_SOURCE_UNKNOWN',
      };
    case 'PARTIAL_OVERLAP':
      if (similarName) {
        return {
          identity: 'AMBIGUOUS',
          decisiveEvidence: 'STRUCTURAL_OVERLAP_WITH_SIMILAR_NAME',
        };
      }
      return compositeStructuralOverlap
        ? {
            identity: 'AMBIGUOUS',
            decisiveEvidence: 'PARTIAL_OVERLAP_IDENTITY_UNRESOLVED',
          }
        : {
            identity: 'DISTINCT',
            decisiveEvidence: standaloneComposite
              ? 'STANDALONE_COMPOSITE_MEMBERSHIP'
              : 'PARTIAL_OVERLAP_INSUFFICIENT',
          };
    case 'DISJOINT':
      return similarName
        ? {
            identity: 'AMBIGUOUS',
            decisiveEvidence: 'SIMILAR_NAME_WITHOUT_SHARED_STRUCTURE',
          }
        : { identity: 'DISTINCT', decisiveEvidence: 'STRUCTURALLY_DISJOINT' };
  }
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
  const incomingKeys = sourceMemberKeys(incoming, 'incoming');
  const existingKeys = sourceMemberKeys(existing, 'existing');
  const componentOverlap = setOverlap(
    new Set(incomingKeys.map(({ key }) => key)),
    new Set(existingKeys.map(({ key }) => key)),
  );
  const roleAwareComponentOverlap = setOverlap(
    new Set(incomingKeys.map(({ key, role }) => `${role}|${key}`)),
    new Set(existingKeys.map(({ key, role }) => `${role}|${key}`)),
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

  const structure = structuralCompositionRelation(
    incoming,
    existing,
    incomingKeys,
    existingKeys,
    orderConflict,
  );
  const sourceRelation = sourceProvenanceRelation(incoming, existing);

  const reasons: string[] = [];
  if (nameSimilarity === 1) reasons.push('same_normalized_name');
  else if (nameSimilarity >= 0.72) reasons.push('similar_name');
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
    structure,
    sourceRelation,
    decisiveEvidence: null,
    reasons,
  };
}

/**
 * Structural relation over source-member keys (see
 * `StructuralCompositionRelation`). Containment reads the member SET; the
 * only sequence semantics are the evidenced `order` ones (spec §9, no
 * manufactured order), so a conflicting evidenced order downgrades
 * containment to PARTIAL_OVERLAP.
 */
function structuralCompositionRelation(
  incoming: DedupeExperienceFingerprint,
  existing: DedupeExperienceFingerprint,
  incomingKeys: SourceMemberKey[],
  existingKeys: SourceMemberKey[],
  orderConflict: boolean,
): StructuralCompositionEvidence {
  const existingGeo = new Set(distinctResolvedGeoEntityIds(existing));
  const sharedResolvedGeoEntityIds = distinctResolvedGeoEntityIds(
    incoming,
  ).filter((id) => existingGeo.has(id));
  const sourceMemberCounts = {
    incoming: incomingKeys.length,
    existing: existingKeys.length,
  };
  const of = (
    relation: StructuralCompositionRelation,
    containment: SubcompositionContainment | null = null,
  ): StructuralCompositionEvidence => ({
    relation,
    containment,
    sharedResolvedGeoEntityIds,
    sourceMemberCounts,
  });

  if (!sharedResolvedGeoEntityIds.length) return of('DISJOINT');

  const incomingSet = new Set(incomingKeys.map(({ key }) => key));
  const existingSet = new Set(existingKeys.map(({ key }) => key));
  const incomingWithin = [...incomingSet].every((key) => existingSet.has(key));
  const existingWithin = [...existingSet].every((key) => incomingSet.has(key));

  if (incomingWithin && existingWithin) return of('EXACT_COMPOSITION');
  if (orderConflict) return of('PARTIAL_OVERLAP');
  if (incomingWithin) return of('SUBCOMPOSITION', 'INCOMING_WITHIN_EXISTING');
  if (existingWithin) return of('SUBCOMPOSITION', 'EXISTING_WITHIN_INCOMING');
  return of('PARTIAL_OVERLAP');
}

function sourceProvenanceRelation(
  incoming: DedupeExperienceFingerprint,
  existing: DedupeExperienceFingerprint,
): SourceProvenanceRelation {
  const incomingDocs = canonicalSourceDocuments(incoming);
  const existingDocs = canonicalSourceDocuments(existing);
  if (!incomingDocs.size || !existingDocs.size) return 'SOURCE_UNKNOWN';
  return [...incomingDocs].some((doc) => existingDocs.has(doc))
    ? 'SAME_SOURCE'
    : 'DIFFERENT_SOURCE';
}

/**
 * Evidence URL as a document identity: scheme and host case, a fragment and
 * a trailing slash do not change the document. A value that is not a URL is
 * compared trimmed.
 */
function canonicalSourceDocuments(
  fingerprint: DedupeExperienceFingerprint,
): Set<string> {
  return new Set(
    (fingerprint.sourceDocuments ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          const url = new URL(value);
          url.hash = '';
          return url.toString().replace(/\/$/, '');
        } catch {
          return value;
        }
      }),
  );
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

interface SourceMemberKey {
  key: string;
  role: string;
}

/**
 * Identity key of each source member inside a dedupe comparison, in source
 * order: its GeoEntity when resolved, else its normalized source wording.
 * Never a bare `null`; an unresolved member without wording gets a key no
 * other member can share, so it never becomes shared structure.
 */
function sourceMemberKeys(
  fingerprint: Pick<DedupeExperienceFingerprint, 'components'>,
  side: 'incoming' | 'existing',
): SourceMemberKey[] {
  return allSourceMembers(fingerprint).map((component, index) => {
    const wording = normalizeGeoName(component.sourceName ?? '');
    const key = isResolvedSourceMember(component)
      ? `geo:${component.geoEntityId}`
      : wording
        ? `source:${wording}`
        : `unnamed:${side}:${index}`;
    return { key, role: normalize(component.role ?? 'component') };
  });
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

function emptyEvidence(
  reason: string,
  incomingMemberCount: number,
): DedupeEvidence {
  return {
    nameSimilarity: 0,
    semanticSimilarity: 0,
    componentOverlap: 0,
    roleAwareComponentOverlap: 0,
    distanceKm: null,
    provenanceOverlap: 0,
    conceptOverlap: 0,
    orderConflict: false,
    structure: {
      relation: 'DISJOINT',
      containment: null,
      sharedResolvedGeoEntityIds: [],
      sourceMemberCounts: { incoming: incomingMemberCount, existing: 0 },
    },
    sourceRelation: 'SOURCE_UNKNOWN',
    decisiveEvidence: 'NO_EXISTING_CANDIDATES',
    reasons: [reason],
  };
}
