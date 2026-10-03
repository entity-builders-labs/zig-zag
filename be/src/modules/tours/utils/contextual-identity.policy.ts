import {
  CandidateStructuralKind,
  ComponentIdentityContext,
  ContextualPoolCoverage,
  ContextualPoolEvaluation,
  ContextualPoolMember,
  EnumeratedExtent,
} from '../interfaces/component-identity-context.interface';
import { ComponentPhysicalKind } from '../interfaces/experience-discovery.interface';
import {
  EntityCandidate,
  IdentityEvidence,
} from '../interfaces/experience-resolution.interface';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { classifyComponentAreaRelation } from './area-scope-membership-policy';
import { geometryBoundingBox } from './geometry-search-area.util';

/**
 * The single authority for comparing a component's grounded source context
 * with provider candidates. Pure: no acquisition, no ranking, no
 * persistence, and no numeric score. IdentityVerifier interprets the facts
 * it produces.
 */

export type KindCompatibility =
  | 'COMPATIBLE'
  | 'INCOMPATIBLE'
  | 'UNKNOWN'
  | 'NOT_ASSERTED';

export function kindCompatibility(
  asserted: ComponentPhysicalKind | undefined,
  candidate: CandidateStructuralKind | undefined,
): KindCompatibility {
  if (!asserted) return 'NOT_ASSERTED';
  if (!candidate || candidate === 'UNKNOWN') return 'UNKNOWN';
  if (asserted === 'ESTABLISHMENT') {
    return candidate === 'POINT_OF_INTEREST' ? 'COMPATIBLE' : 'INCOMPATIBLE';
  }
  return candidate === 'SETTLEMENT' ? 'COMPATIBLE' : 'INCOMPATIBLE';
}

export type LocalityRelation = 'INSIDE' | 'OUTSIDE' | 'UNDETERMINED';

export function localityRelation(
  context: ComponentIdentityContext,
  point: { latitude?: number | null; longitude?: number | null },
): LocalityRelation | undefined {
  if (context.locality?.status !== 'GROUNDED') return undefined;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return 'UNDETERMINED';
  }
  const relation = classifyComponentAreaRelation(
    context.locality.boundary.geometry,
    {
      role: 'venue',
      latitude: point.latitude as number,
      longitude: point.longitude as number,
    },
  ).relation;
  return relation === 'INSIDE'
    ? 'INSIDE'
    : relation === 'OUTSIDE'
      ? 'OUTSIDE'
      : 'UNDETERMINED';
}

/**
 * Evaluates every examined same-name member against the grounded locality
 * (and the asserted kind, when the source states one). Undefined when the
 * source asserts no grounded locality: there is no context to compare.
 *
 * A known competitor that is equally consistent always yields AMBIGUOUS,
 * whatever the coverage (an incomplete pool can only add competitors).
 * DISTINGUISHED additionally needs a comparison known to be complete for
 * the locality and, when the source states a kind, a member whose kind is
 * shown compatible.
 */
export function evaluateContextualPool(
  context: ComponentIdentityContext,
  members: readonly ContextualPoolMember[],
  coverage: ContextualPoolCoverage,
): ContextualPoolEvaluation | undefined {
  if (context.locality?.status !== 'GROUNDED') return undefined;
  const assertedKind = context.physicalKind?.kind;
  const consistent: ContextualPoolMember[] = [];
  const undetermined: string[] = [];
  for (const member of members) {
    const kind = kindCompatibility(assertedKind, member.structuralKind);
    if (kind === 'INCOMPATIBLE') continue;
    const relation = localityRelation(context, member);
    if (relation === 'INSIDE') consistent.push(member);
    else if (relation === 'UNDETERMINED') {
      undetermined.push(member.identityKey);
    }
  }
  const base = {
    assertion: 'LOCALITY' as const,
    locality: context.locality.assertion.locality,
    boundaryId: context.locality.boundary.externalId,
    coverage,
    memberCount: members.length,
    consistentIdentityKeys: consistent.map((member) => member.identityKey),
    undeterminedIdentityKeys: undetermined,
    ...(assertedKind ? { assertedKind } : {}),
  };
  if (consistent.length > 1) {
    return { ...base, outcome: 'AMBIGUOUS' };
  }
  if (consistent.length === 0) {
    return {
      ...base,
      outcome:
        undetermined.length > 0
          ? 'INCOMPLETE_COMPARISON'
          : 'NO_CONSISTENT_MEMBER',
    };
  }
  if (undetermined.length > 0 || coverage === 'NOT_ESTABLISHED') {
    return { ...base, outcome: 'INCOMPLETE_COMPARISON' };
  }
  if (
    kindCompatibility(assertedKind, consistent[0].structuralKind) === 'UNKNOWN'
  ) {
    return { ...base, outcome: 'KIND_UNESTABLISHED' };
  }
  return { ...base, outcome: 'DISTINGUISHED' };
}

/**
 * Whether a provider snapshot is a complete comparison for the component's
 * grounded locality: it enumerated the whole country (the grounder only
 * grounds inside the destination country), or a typed extent containing
 * the locality's boundary. Coverage is decided on the boundary's bounding
 * box, so an extent that merely overlaps the locality never covers it.
 */
export function enumeratedSnapshotLocalityCoverage(
  context: ComponentIdentityContext,
  snapshot: { completeCountry: boolean; extent?: EnumeratedExtent },
): ContextualPoolCoverage {
  if (context.locality?.status !== 'GROUNDED') return 'NOT_ESTABLISHED';
  if (snapshot.completeCountry) return 'COVERS_ASSERTED_LOCALITY';
  const extent = snapshot.extent;
  if (!extent) return 'NOT_ESTABLISHED';
  const locality = geometryBoundingBox(context.locality.boundary.geometry);
  return locality.west >= extent.west &&
    locality.east <= extent.east &&
    locality.south >= extent.south &&
    locality.north <= extent.north
    ? 'COVERS_ASSERTED_LOCALITY'
    : 'NOT_ESTABLISHED';
}

/**
 * The member a strategy should try: the one the source context
 * distinguishes, when there is one; otherwise the strategy's own ranking.
 * Proximity or provider rank never override a distinguished member.
 */
export function contextuallyDistinguishedKey(
  evaluation: ContextualPoolEvaluation | undefined,
): string | undefined {
  return evaluation?.outcome === 'DISTINGUISHED'
    ? evaluation.consistentIdentityKeys[0]
    : undefined;
}

export function candidateIdentityKey(candidate: {
  provider: string;
  externalId: string;
}): string {
  return `${candidate.provider}/${candidate.externalId}`;
}

export type GeographicCorrespondence = Extract<
  IdentityEvidence,
  { type: 'GEOGRAPHIC_CORRESPONDENCE' }
>;

/**
 * The geography this candidate's name uniqueness is counted in, and
 * whether it is grounded (RW4-ID-CORRESPONDENCE-1). A bounded admission
 * scope (the destination, an anchor, an owned area) is grounded by the
 * request. Beyond it, only a geography the SOURCE states is: the
 * component's grounded locality, or the AREA the source names for the
 * whole composition once that AREA is itself resolved and verified
 * (`sourceArea`). The destination country is an admission bound, not a
 * statement of where the source's place is. The candidate's own position
 * never grounds a geography for itself; it is only compared with the
 * source's.
 */
export function geographicCorrespondence(
  context: ComponentIdentityContext,
  candidate: { latitude?: number | null; longitude?: number | null },
  admission: 'BOUNDED' | 'BEYOND_DESTINATION',
  sourceArea?: GeoJsonGeometry,
): GeographicCorrespondence {
  const basis = (): GeographicCorrespondence['basis'] => {
    if (admission === 'BOUNDED') return 'BOUNDED_ADMISSION_SCOPE';
    if (localityRelation(context, candidate) === 'INSIDE') {
      return 'SOURCE_LOCALITY';
    }
    if (
      sourceArea &&
      Number.isFinite(candidate.latitude) &&
      Number.isFinite(candidate.longitude) &&
      classifyComponentAreaRelation(sourceArea, {
        role: 'venue',
        latitude: candidate.latitude as number,
        longitude: candidate.longitude as number,
      }).relation === 'INSIDE'
    ) {
      return 'SOURCE_AREA';
    }
    return 'ADMISSION_SCOPE_ONLY';
  };
  return { type: 'GEOGRAPHIC_CORRESPONDENCE', basis: basis() };
}

/**
 * Typed contextual evidence for ONE candidate: contradictions of the source
 * context by the candidate's own facts, and the pool evaluation it was
 * selected from, projected onto this candidate.
 */
export function contextualIdentityEvidence(
  context: ComponentIdentityContext,
  candidate: EntityCandidate,
): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];
  const relation = localityRelation(context, candidate);
  if (relation === 'OUTSIDE' && context.locality?.status === 'GROUNDED') {
    evidence.push({
      type: 'IDENTITY_CONTRADICTION',
      fact: 'LOCALITY',
      assertedLocality: context.locality.assertion.locality,
      boundaryId: context.locality.boundary.externalId,
    });
  }
  const assertedKind = context.physicalKind?.kind;
  if (
    assertedKind &&
    kindCompatibility(assertedKind, candidate.structuralKind) === 'INCOMPATIBLE'
  ) {
    evidence.push({
      type: 'IDENTITY_CONTRADICTION',
      fact: 'PHYSICAL_KIND',
      assertedKind,
      candidateKind: candidate.structuralKind as CandidateStructuralKind,
    });
  }
  const pool = candidate.contextualPool;
  if (pool && relation !== 'OUTSIDE') {
    const key = candidateIdentityKey(candidate);
    const outcome =
      pool.outcome === 'DISTINGUISHED' && pool.consistentIdentityKeys[0] !== key
        ? 'NO_CONSISTENT_MEMBER'
        : pool.outcome;
    evidence.push({
      type: 'CONTEXTUAL_CORRESPONDENCE',
      assertion: 'LOCALITY',
      locality: pool.locality,
      coverage: pool.coverage,
      memberCount: pool.memberCount,
      consistentCount: pool.consistentIdentityKeys.length,
      outcome,
    });
  }
  return evidence;
}
