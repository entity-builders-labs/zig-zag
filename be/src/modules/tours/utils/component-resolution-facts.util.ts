import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  ComponentAreaRelationFact,
  AreaScopeComponentFact,
} from '../interfaces/area-scope-membership.interface';
import {
  ComponentDeficitClassification,
  ComponentDeficitReason,
  ComponentGeographicScope,
  ComponentIdentityStatus,
  ComponentResolutionAudit,
  ComponentResolutionFact,
  CompositeComponentResolution,
  CompositeResolutionCoverage,
  ExperienceGeographicValidationResult,
  ExperienceValidationScope,
  GeographicScope,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import {
  classifyComponentAreaRelation,
  classifyComponentPointRadiusRelation,
} from './area-scope-membership-policy';

/**
 * Builds the per-component truth of one source-backed candidate: identity
 * status for EVERY source component hint, a geographic relation for every
 * RESOLVED component (from the single area-scope membership policy), and
 * the composition's coverage. Pure: consumes what resolution already did,
 * never calls a provider, never decides admission beyond the fact
 * `sourceCompositionComplete`.
 */
export function buildCompositeComponentResolution(input: {
  candidate: ExperienceCandidate;
  entities: ResolvedGeoEntity[];
  componentAudits: ComponentResolutionAudit[];
  validationScope?: ExperienceValidationScope;
  geographicScope?: GeographicScope;
}): CompositeComponentResolution {
  const relationScope = componentRelationScope(
    input.validationScope,
    input.geographicScope,
  );
  const hints = input.candidate.componentHints ?? [];
  const components = hints.map((hint, index): ComponentResolutionFact => {
    const entity = input.entities.find((item) => item.hintKey === hint.key);
    const audit = input.componentAudits.find(
      (item) => item.hintKey === hint.key,
    );
    const identityStatus = componentIdentityStatus(entity, audit);
    const base = {
      hintKey: hint.key,
      hintName: hint.name,
      role: hint.role,
      expectedKind: hint.expectedKind,
      evidenceKeys: [...hint.evidenceKeys],
      sourceOrder: input.candidate.orderedByEvidence ? index + 1 : null,
      identityStatus,
    };
    if (identityStatus !== 'RESOLVED' || !entity) {
      const reason = componentDeficitReason(entity, audit);
      return {
        ...base,
        deficit: { reason, classification: deficitClassification(reason) },
      };
    }
    const relation = relationScope.relate({
      hintKey: hint.key,
      role: entity.role,
      kind: entity.kind,
      latitude: entity.latitude,
      longitude: entity.longitude,
      geometry: entity.geometry,
    });
    return {
      ...base,
      resolved: {
        ...(entity.geoEntityId ? { geoEntityId: entity.geoEntityId } : {}),
        ...(entity.kind ? { geoEntityKind: entity.kind } : {}),
        canonicalGeometry: relation.basis,
        geographicRelation: relation.relation,
        ...(relation.distanceToBoundaryMeters !== undefined
          ? { distanceToBoundaryMeters: relation.distanceToBoundaryMeters }
          : {}),
      },
    };
  });

  const count = (status: ComponentIdentityStatus) =>
    components.filter((component) => component.identityStatus === status)
      .length;
  const identityResolvedComponents = count('RESOLVED');
  return {
    scope: relationScope.scope,
    components,
    coverage: {
      totalComponents: components.length,
      identityResolvedComponents,
      geographicallyAcceptedComponents: components.filter(
        (component) =>
          component.resolved?.geographicRelation === 'INSIDE' ||
          component.resolved?.geographicRelation === 'INTERSECTS',
      ).length,
      unresolvedComponents: count('UNRESOLVED'),
      ambiguousComponents: count('AMBIGUOUS'),
      conflictedComponents: count('CONFLICTED'),
      resolutionRatio:
        components.length === 0
          ? 0
          : identityResolvedComponents / components.length,
      openResearchDeficits: components
        .filter(
          (component) =>
            component.deficit?.classification === 'KNOWLEDGE_DEFICIT',
        )
        .map((component) => component.hintKey),
      sourceCompositionComplete:
        components.length > 0 &&
        identityResolvedComponents === components.length,
    },
  };
}

/**
 * The request scope a component relation is computed against: the
 * request-level validation AREA when one was resolved, else the destination
 * boundary, else the destination's point radius.
 */
function componentRelationScope(
  validationScope: ExperienceValidationScope | undefined,
  geographicScope: GeographicScope | undefined,
): {
  scope: ComponentGeographicScope;
  relate: (fact: AreaScopeComponentFact) => ComponentAreaRelationFact;
} {
  if (validationScope && isPolygonal(validationScope.geometry)) {
    return {
      scope: { kind: 'VALIDATION_AREA', name: validationScope.anchorName },
      relate: (fact) =>
        classifyComponentAreaRelation(validationScope.geometry, fact),
    };
  }
  if (
    geographicScope?.kind === 'AREA_BOUNDARY' &&
    isPolygonal(geographicScope.boundary.geometry)
  ) {
    return {
      scope: {
        kind: 'DESTINATION_AREA',
        ...(geographicScope.boundary.name
          ? { name: geographicScope.boundary.name }
          : {}),
      },
      relate: (fact) =>
        classifyComponentAreaRelation(geographicScope.boundary.geometry, fact),
    };
  }
  if (geographicScope?.kind === 'POINT_RADIUS') {
    return {
      scope: {
        kind: 'POINT_RADIUS',
        radiusMeters: geographicScope.radiusMeters,
      },
      relate: (fact) =>
        classifyComponentPointRadiusRelation(geographicScope, fact),
    };
  }
  return {
    scope: { kind: 'UNAVAILABLE' },
    relate: (fact) => classifyComponentAreaRelation(undefined, fact),
  };
}

function isPolygonal(geometry: GeoJsonGeometry | undefined): boolean {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

function componentIdentityStatus(
  entity: ResolvedGeoEntity | undefined,
  audit: ComponentResolutionAudit | undefined,
): ComponentIdentityStatus {
  if (entity?.status === 'resolved') return 'RESOLVED';
  if (entity?.reason === 'IDENTITY_CONFLICT') return 'CONFLICTED';
  if (
    entity?.reason === 'AMBIGUOUS' ||
    audit?.attempts.some(
      (attempt) => attempt.verificationDecision === 'AMBIGUOUS',
    )
  ) {
    return 'AMBIGUOUS';
  }
  return 'UNRESOLVED';
}

function componentDeficitReason(
  entity: ResolvedGeoEntity | undefined,
  audit: ComponentResolutionAudit | undefined,
): ComponentDeficitReason {
  const attempts = audit?.attempts ?? [];
  if (entity?.reason === 'IDENTITY_CONFLICT') return 'IDENTITY_CONFLICT';
  if (
    entity?.reason === 'AMBIGUOUS' ||
    attempts.some((attempt) => attempt.verificationDecision === 'AMBIGUOUS')
  ) {
    return 'AMBIGUOUS_CANDIDATES';
  }
  if (entity?.reason === 'DESTINATION_INCOMPATIBLE') {
    return 'DESTINATION_INCOMPATIBLE';
  }
  if (entity?.reason === 'DESTINATION_COMPATIBILITY_UNKNOWN') {
    return 'DESTINATION_COMPATIBILITY_UNKNOWN';
  }
  const verdicts = attempts
    .filter((attempt) => attempt.candidateAcquired)
    .map((attempt) => attempt.verificationDecision)
    .filter((verdict) => verdict !== undefined);
  // Contradicted only when IdentityVerifier REJECTED every acquired candidate
  // it judged; any not-corroborated verdict keeps the component UNCONFIRMED.
  if (
    verdicts.length > 0 &&
    verdicts.every((verdict) => verdict === 'REJECTED')
  ) {
    return 'CANDIDATE_REJECTED';
  }
  if (attempts.some((attempt) => attempt.candidateAcquired)) {
    return 'CANDIDATE_UNCONFIRMED';
  }
  if (
    entity?.reason === 'OSM_PROVIDER_FAILED' ||
    attempts.some((attempt) => attempt.executionStatus === 'failed')
  ) {
    return 'PROVIDER_FAILURE';
  }
  return 'NO_CANDIDATE_ACQUIRED';
}

function deficitClassification(
  reason: ComponentDeficitReason,
): ComponentDeficitClassification {
  if (reason === 'AMBIGUOUS_CANDIDATES') return 'KNOWLEDGE_DEFICIT';
  if (reason === 'PROVIDER_FAILURE') return 'OPERATIONAL_FAILURE';
  return 'PENDING_CLASSIFICATION';
}

export interface CompositeOutcome {
  coverage?: CompositeResolutionCoverage;
  geographicDecision:
    | {
        status: 'NOT_EVALUATED';
        reason: 'INCOMPLETE_SOURCE_COMPOSITION' | 'NO_VALIDATION_RESULT';
      }
    | { status: 'ACCEPTED'; strategy?: string }
    | { status: 'REJECTED'; reasons: string[] };
  persistence:
    | {
        status: 'PERSISTED';
        experienceId: string;
        dedupeDecision?: 'SAME' | 'NEW' | 'AMBIGUOUS';
      }
    | {
        status: 'NOT_PERSISTED';
        reasons: string[];
        dedupe?: {
          conflictingExperienceIds: string[];
          evidence?: {
            nameSimilarity: number;
            semanticSimilarity: number;
            componentOverlap: number;
            roleAwareComponentOverlap: number;
            reasons: string[];
          };
        };
      };
  plannerEligible: boolean;
}

export function buildCompositeOutcome(
  entry: ResolvedExperienceCandidate,
  validation: ExperienceGeographicValidationResult | undefined,
): CompositeOutcome {
  const coverage = entry.componentResolution?.coverage;
  const complete = coverage?.sourceCompositionComplete ?? false;
  const geographicDecision: CompositeOutcome['geographicDecision'] = !complete
    ? { status: 'NOT_EVALUATED', reason: 'INCOMPLETE_SOURCE_COMPOSITION' }
    : !validation
      ? { status: 'NOT_EVALUATED', reason: 'NO_VALIDATION_RESULT' }
      : validation.accepted
        ? {
            status: 'ACCEPTED',
            ...(validation.strategy ? { strategy: validation.strategy } : {}),
          }
        : { status: 'REJECTED', reasons: [...validation.rejectionReasons] };
  const persisted = entry.status === 'accepted' && Boolean(entry.experienceId);
  return {
    ...(coverage ? { coverage } : {}),
    geographicDecision,
    persistence: persisted
      ? {
          status: 'PERSISTED',
          experienceId: entry.experienceId as string,
          ...(entry.dedupeDecision
            ? { dedupeDecision: entry.dedupeDecision }
            : {}),
        }
      : {
          status: 'NOT_PERSISTED',
          reasons: [...entry.rejectionReasons],
          ...(entry.dedupeDecision === 'AMBIGUOUS' ||
          entry.rejectionReasons.includes('AMBIGUOUS_DEDUPE')
            ? {
                dedupe: {
                  conflictingExperienceIds: [...(entry.dedupeCandidates ?? [])],
                  ...(entry.dedupeEvidence
                    ? {
                        evidence: {
                          nameSimilarity: entry.dedupeEvidence.nameSimilarity,
                          semanticSimilarity:
                            entry.dedupeEvidence.semanticSimilarity,
                          componentOverlap:
                            entry.dedupeEvidence.componentOverlap,
                          roleAwareComponentOverlap:
                            entry.dedupeEvidence.roleAwareComponentOverlap,
                          reasons: [...entry.dedupeEvidence.reasons],
                        },
                      }
                    : {}),
                },
              }
            : {}),
        },
    plannerEligible: persisted,
  };
}

export function describeComponentFact(fact: ComponentResolutionFact): string {
  if (fact.resolved) {
    const distance =
      fact.resolved.distanceToBoundaryMeters !== undefined
        ? ` ${Math.round(fact.resolved.distanceToBoundaryMeters)}m`
        : '';
    return `${fact.hintName}=${fact.identityStatus}/${fact.resolved.geographicRelation}${distance}`;
  }
  return fact.deficit
    ? `${fact.hintName}=${fact.identityStatus}/${fact.deficit.reason}(${fact.deficit.classification})`
    : `${fact.hintName}=${fact.identityStatus}`;
}

export function describeComponentResolution(
  resolution: CompositeComponentResolution | undefined,
): string {
  if (!resolution?.components.length) return '';
  const { coverage } = resolution;
  return (
    ` [resueltos ${coverage.identityResolvedComponents}/${coverage.totalComponents}: ` +
    `${resolution.components.map(describeComponentFact).join(', ')}]`
  );
}

export function describeCompositeOutcome(
  name: string,
  outcome: CompositeOutcome,
): string {
  const coverage = outcome.coverage;
  const counts = coverage
    ? `${coverage.identityResolvedComponents}/${coverage.totalComponents} componentes resueltos, composición ${coverage.sourceCompositionComplete ? 'completa' : 'incompleta'}`
    : 'sin cobertura registrada';
  const geography =
    outcome.geographicDecision.status === 'NOT_EVALUATED'
      ? 'no evaluada geográficamente'
      : outcome.geographicDecision.status === 'ACCEPTED'
        ? 'geografía ACCEPTED'
        : `geografía REJECTED (${outcome.geographicDecision.reasons.join(', ')})`;
  const persistence =
    outcome.persistence.status === 'PERSISTED' ? 'persistida' : 'no persistida';
  const planner = outcome.plannerEligible
    ? 'elegible para planner'
    : 'no elegible para planner';
  return `${name}: ${counts} → ${geography}, ${persistence}, ${planner}`;
}
