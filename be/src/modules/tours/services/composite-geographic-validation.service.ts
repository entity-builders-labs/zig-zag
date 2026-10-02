import { Injectable, Logger } from '@nestjs/common';
import {
  evaluateDestinationCompatibility,
  evaluateExperienceDestinationRelation,
} from '../utils/destination-compatibility.policy';
import { distancePointToPolygonBoundaryMeters } from '@integrations/osm/utils/geojson-containment.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  GEOGRAPHIC_VALIDATOR_VERSION,
  GeographicValidationDecisionEntity,
  GeographicValidationRejectionReason,
  GeographicValidationResult,
  GeographicDecisionReason,
} from '../interfaces/geographic-validation.interface';
import {
  GeographicScope,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import {
  ExperienceGeographicScope,
  GeographicScopeUnknownReason,
  WorkUnitAnchorScope,
} from '../interfaces/experience-geographic-scope.interface';
import {
  coherenceMetrics,
  distanceMeters,
} from '../utils/geographic-coherence.util';
import {
  classifyComponentAreaRelation,
  evaluateAreaScopeMembership,
} from '../utils/area-scope-membership-policy';
import {
  AreaScopeComponentFact,
  AreaScopeMembershipAudit,
  AreaScopeMembershipPolicy,
  ComponentAreaRelationFact,
} from '../interfaces/area-scope-membership.interface';
import {
  RouteScopeComponentFact,
  RouteScopeMembershipAudit,
} from '../interfaces/route-scope-membership.interface';
import { evaluateRouteScopeMembership } from '../utils/route-scope-membership-policy';
import { isUsableRouteGeometry } from '../utils/route-geometry.util';
import { GeographicValidationAuthorization } from '../interfaces/geographic-validation-authorization.interface';
import {
  authorizesAnchoredAreaMembership,
  DEFAULT_GEOGRAPHIC_AUTHORIZATION,
} from '../utils/geographic-validation-authorization.util';
import {
  deriveExperienceGeographicScope,
  DerivedExperienceGeographicScope,
  isCanonicalPhysicalRouteComponent,
  projectExperienceGeographicScope,
} from '../utils/experience-geographic-scope.policy';
import { MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS } from '../utils/acquisition-candidate-requirement.util';

/**
 * Composite geographic validation (spec 2026-10-02 Part II §P2-2 question B,
 * §P2-8): do the components form ONE physically coherent Experience?
 *
 * Answered against the Experience's own real geography — the scope derived
 * by the single owner `deriveExperienceGeographicScope` — never against a
 * circle around the destination centroid and never with a coherence radius:
 *  - CANDIDATE_AREA (S-b): every member component relates to the verified
 *    canonical AREA (point INSIDE, line entering it);
 *  - CANDIDATE_ROUTE (S-c): topological route-scope membership;
 *  - DESTINATION_AREA / DESTINATION_POINT_RADIUS (S-d/S-e): every
 *    component lies in the destination; a ROUTE_LIKE candidate whose
 *    components leave it without a verified scope is GEOGRAPHIC_SCOPE_UNKNOWN;
 *  - UNKNOWN: rejected (PD2, fail closed).
 * The work-unit anchor scope (S-a) is checked first, in conjunction.
 * Admin-context contradictions (COUNTRY/REGION) still reject. Source
 * composition completeness is checked before anything else: an unresolved
 * component is never dropped to make a composite valid.
 *
 * The result carries the Experience scope and the trip-relative
 * `destinationRelation` fact; a verified regional Experience is accepted
 * whatever that relation is (tour eligibility consumes it later).
 */
@Injectable()
export class CompositeGeographicValidationService {
  private readonly logger = new Logger(
    CompositeGeographicValidationService.name,
  );

  validate(
    resolvedProposal: ResolvedExperienceCandidate,
    destinationBoundary: OsmCandidate | undefined,
    validationScope?: WorkUnitAnchorScope,
    geographicAuthorization: GeographicValidationAuthorization = DEFAULT_GEOGRAPHIC_AUTHORIZATION,
    geographicScope?: GeographicScope,
  ): GeographicValidationResult {
    const { candidate, resolvedEntities } = resolvedProposal;
    const resolved = resolvedEntities.filter(
      (entity) => entity.status === 'resolved',
    );
    const withCoordinates = resolved.filter(
      (entity) =>
        Number.isFinite(entity.latitude) && Number.isFinite(entity.longitude),
    );
    const groundedEvidenceKeys = Array.from(new Set(candidate.evidenceKeys));
    const destination: GeographicScope | undefined =
      geographicScope ??
      (destinationBoundary
        ? { kind: 'AREA_BOUNDARY', boundary: destinationBoundary }
        : undefined);

    const compositionViolation = this.rejectIfSourceCompositionIncomplete(
      resolvedProposal,
      resolved,
      withCoordinates,
      groundedEvidenceKeys,
    );
    const externalScopeValidation =
      !compositionViolation && validationScope
        ? this.rejectIfExternalScopeViolated(
            resolvedProposal,
            resolved,
            withCoordinates,
            validationScope,
            groundedEvidenceKeys,
            geographicAuthorization,
            destinationBoundary,
          )
        : undefined;

    const areaScopeMembership = externalScopeValidation?.areaScopeMembership;
    const routeScopeMembership = externalScopeValidation?.routeScopeMembership;
    const derived = compositionViolation
      ? undefined
      : deriveExperienceGeographicScope({
          candidate,
          resolvedEntities: resolved,
          authorization: geographicAuthorization,
          destination,
          workUnitScope: validationScope,
        });
    let result: GeographicValidationResult;
    if (compositionViolation) {
      result = compositionViolation;
    } else if (externalScopeValidation?.result?.accepted === false) {
      result = externalScopeValidation.result;
    } else {
      result = this.validateAgainstScope(
        resolvedProposal,
        resolved,
        withCoordinates,
        derived!,
        destination,
        groundedEvidenceKeys,
      );
    }

    if (areaScopeMembership && !result.areaScopeMembership) {
      result = { ...result, areaScopeMembership };
    }
    if (routeScopeMembership && !result.routeScopeMembership) {
      result = { ...result, routeScopeMembership };
    }
    if (derived) {
      result = {
        ...result,
        experienceScope: projectExperienceGeographicScope(derived),
        destinationRelation: evaluateExperienceDestinationRelation(
          resolved.map(componentFact),
          destination,
        ),
      };
    }

    if (!result.decisionEntities) {
      const routeAudit = result.routeScopeMembership ?? routeScopeMembership;
      result.decisionEntities = withCoordinates.map((entity) => {
        const routeFact = routeAudit?.decision.components.find(
          (c) => c.hintKey === entity.hintKey,
        );
        return {
          geoEntityId: entity.geoEntityId,
          hintKey: entity.hintKey,
          relation: 'evaluated' as const,
          ...(routeFact?.distanceFromRouteMeters !== undefined
            ? { distanceFromRouteMeters: routeFact.distanceFromRouteMeters }
            : {}),
        };
      });
    }

    this.logger.log(
      JSON.stringify({
        event: 'geographic_validation',
        proposalName: candidate.name,
        experienceKind: 'EXPERIENCE',
        proposedHintCount: candidate.componentHints.length,
        resolvedEntityCount: resolved.length,
        entitiesWithCoordinates: withCoordinates.length,
        validationStatus: result.status,
        strategy: result.strategy,
        rejectionReasons: result.rejectionReasons,
        experienceScope: result.experienceScope,
        destinationRelation: result.destinationRelation?.relation,
      }),
    );
    return result;
  }

  /** Dispatch on the single derived Experience scope (§P2-7). */
  private validateAgainstScope(
    resolvedProposal: ResolvedExperienceCandidate,
    resolved: ResolvedGeoEntity[],
    withCoordinates: ResolvedGeoEntity[],
    derived: DerivedExperienceGeographicScope,
    destination: GeographicScope | undefined,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const scope = derived.scope;
    switch (scope.kind) {
      case 'UNKNOWN':
        return this.rejectUnknownScope(
          resolvedProposal.candidate.name,
          withCoordinates,
          evidenceKeys,
          withCoordinates,
        );
      case 'ROUTE':
        return this.validateCandidateRoute(
          resolvedProposal,
          withCoordinates,
          scope,
          destination,
          evidenceKeys,
        );
      case 'POINT_RADIUS':
        return this.validatePointRadiusDestination(
          resolvedProposal,
          withCoordinates,
          scope,
          derived.unknownWhenBeyondDestination,
          evidenceKeys,
        );
      case 'AREA':
        return scope.provenance === 'CANDIDATE_AREA' ||
          scope.provenance === 'WORK_UNIT_ANCHOR'
          ? this.validateCandidateArea(
              resolvedProposal,
              resolved,
              withCoordinates,
              scope,
              evidenceKeys,
            )
          : this.validateDestinationLocal(
              resolvedProposal,
              withCoordinates,
              destination,
              derived.unknownWhenBeyondDestination,
              evidenceKeys,
            );
    }
  }

  private rejectUnknownScope(
    proposalName: string,
    anchors: ResolvedGeoEntity[],
    evidenceKeys: string[],
    offending: ResolvedGeoEntity[],
  ): GeographicValidationResult {
    return this.rejected(
      proposalName,
      'EXPERIENCE',
      anchors,
      evidenceKeys,
      ['geographic_scope_unknown'],
      undefined,
      offending.length > 0 ? offending : anchors,
      anchors,
      undefined,
      'GEOGRAPHIC_SCOPE_UNKNOWN',
    );
  }

  /**
   * S-c: the candidate's own resolved canonical physical ROUTE. Membership is
   * topological (`evaluateRouteScopeMembership`): the route itself, areal
   * components crossing it, components sharing an enclosing source AREA
   * with it, or destination-compatible extensions. A component with none of
   * those relations is outside the Experience scope — no corridor width, no
   * radius.
   */
  private validateCandidateRoute(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    scope: Extract<ExperienceGeographicScope, { kind: 'ROUTE' }>,
    destination: GeographicScope | undefined,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposalName = resolvedProposal.candidate.name;
    const canonicalRoute = withCoordinates.find(
      (entity) =>
        isCanonicalPhysicalRouteComponent(entity) &&
        (!scope.geoEntityId || entity.geoEntityId === scope.geoEntityId),
    );
    const fullSet = canonicalRoute
      ? [
          canonicalRoute,
          ...withCoordinates.filter((entity) => entity !== canonicalRoute),
        ]
      : withCoordinates;
    const decision = evaluateRouteScopeMembership(
      {
        anchorName: scope.name ?? '',
        geoEntityId: scope.geoEntityId,
        geometry: scope.geometry,
      },
      fullSet.map(componentFact),
      destination?.kind === 'AREA_BOUNDARY' ? destination.boundary : undefined,
    );
    const routeScopeMembership: RouteScopeMembershipAudit = {
      decision,
      routeGeometryPresent: true,
      evaluatedComponentCount: fullSet.length,
    };
    if (!decision.passes) {
      const offending = fullSet.filter((entity) =>
        decision.components.some(
          (c) =>
            c.hintKey === entity.hintKey &&
            (c.relation === 'OUTSIDE_DESTINATION' ||
              c.relation === 'NO_MATERIAL_ANCHOR_RELATION'),
        ),
      );
      return this.rejected(
        proposalName,
        'ROUTE',
        fullSet,
        evidenceKeys,
        ['outside_experience_scope'],
        undefined,
        offending.length > 0 ? offending : fullSet,
        fullSet,
        undefined,
        'OUTSIDE_EXPERIENCE_ROUTE_SCOPE',
        undefined,
        routeScopeMembership,
      );
    }
    const conflict = this.adminContextConflict(fullSet, true);
    if (conflict) {
      return this.rejected(
        proposalName,
        'ROUTE',
        fullSet,
        evidenceKeys,
        ['geographic_incoherence'],
        undefined,
        conflict.offendingEntities,
        fullSet,
        undefined,
        conflict.reason,
        undefined,
        routeScopeMembership,
      );
    }
    return {
      proposalName,
      kind: 'ROUTE',
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: 'canonical_geometry',
      canonicalEntity: canonicalRoute,
      anchors: fullSet,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      routeScopeMembership,
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * S-b (and a regional S-a AREA anchor acting as the Experience scope): the
   * candidate's own verified canonical AREA (exactly one
   * source-backed `area` component with polygon geometry, alongside member
   * components). Every OTHER source component must relate to it through the
   * single area-membership authority: a point INSIDE, a real line entering
   * it. Destination distance plays no part.
   */
  private validateCandidateArea(
    resolvedProposal: ResolvedExperienceCandidate,
    resolved: ResolvedGeoEntity[],
    withCoordinates: ResolvedGeoEntity[],
    scope: Extract<ExperienceGeographicScope, { kind: 'AREA' }>,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposalName = resolvedProposal.candidate.name;
    const canonicalArea = resolved.find(
      (entity) =>
        entity.role === 'area' &&
        (!scope.geoEntityId || entity.geoEntityId === scope.geoEntityId) &&
        entity.geometry === scope.geometry,
    );
    const members = withCoordinates.filter((entity) => entity.role !== 'area');
    const outsideArea = members.filter(
      (entity) =>
        !relationSupportsMembership(
          classifyComponentAreaRelation(scope.geometry, componentFact(entity)),
        ),
    );
    const evaluated = canonicalArea ? [canonicalArea, ...members] : members;
    if (outsideArea.length > 0) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        evaluated,
        evidenceKeys,
        ['outside_experience_scope'],
        undefined,
        outsideArea,
        evaluated,
        undefined,
        'OUTSIDE_CANONICAL_AREA_BOUNDARY',
        scope.geometry,
      );
    }
    const conflict = this.adminContextConflict(members, true);
    if (conflict) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        evaluated,
        evidenceKeys,
        ['geographic_incoherence'],
        undefined,
        conflict.offendingEntities,
        evaluated,
        undefined,
        conflict.reason,
      );
    }
    return {
      proposalName,
      kind: 'EXPERIENCE',
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: 'canonical_area',
      canonicalEntity: canonicalArea,
      anchors: evaluated,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * S-d: a destination-local Experience. A single venue must carry grounded
   * evidence and lie inside the destination; a composite needs the
   * composition contract's minimum of distinct resolved components, every
   * one inside the destination polygon, and no country contradiction.
   * Dispersion inside a large destination is planning feasibility, not
   * validity (no coherence radius).
   */
  private validateDestinationLocal(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    destination: GeographicScope | undefined,
    unknownWhenBeyondDestination: GeographicScopeUnknownReason | undefined,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposal = resolvedProposal.candidate;
    const proposalName = proposal.name;
    const kind = 'EXPERIENCE';
    const destinationGeometry =
      destination?.kind === 'AREA_BOUNDARY'
        ? destination.boundary.geometry
        : undefined;
    const venueCentric =
      proposal.componentHints.length === 1 &&
      proposal.componentHints[0].role === 'venue';
    const anchors = this.dedupeEntities(
      withCoordinates.filter((entity) => entity.role !== 'area'),
    );

    if (venueCentric) {
      if (evidenceKeys.length === 0) {
        return this.rejected(
          proposalName,
          kind,
          anchors,
          evidenceKeys,
          ['grounded_evidence_missing'],
          undefined,
          anchors,
          anchors,
        );
      }
      const venue = anchors.find(
        (entity) => entity.hintKey === proposal.componentHints[0].key,
      );
      if (venue) {
        if (!this.isInsideDestination(venue, destination)) {
          return this.rejected(
            proposalName,
            kind,
            [venue],
            evidenceKeys,
            ['destination_mismatch'],
            undefined,
            [venue],
            [venue],
            undefined,
            'OUTSIDE_DESTINATION_BOUNDARY',
            destinationGeometry,
          );
        }
        return {
          proposalName,
          kind,
          status: 'GEO_VERIFIED',
          accepted: true,
          strategy: 'venue_centric',
          canonicalEntity: venue,
          anchors: [venue],
          groundedEvidenceKeys: evidenceKeys,
          rejectionReasons: [],
          validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
        };
      }
    }

    if (anchors.length < MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS) {
      return this.rejected(
        proposalName,
        kind,
        anchors,
        evidenceKeys,
        ['insufficient_resolved_entities'],
        undefined,
        anchors,
        anchors,
      );
    }
    const outside = anchors.filter(
      (entity) => !this.isInsideDestination(entity, destination),
    );
    if (outside.length > 0) {
      return unknownWhenBeyondDestination
        ? this.rejectUnknownScope(proposalName, anchors, evidenceKeys, outside)
        : this.rejected(
            proposalName,
            kind,
            anchors,
            evidenceKeys,
            ['destination_mismatch'],
            undefined,
            outside,
            anchors,
            undefined,
            'OUTSIDE_DESTINATION_BOUNDARY',
            destinationGeometry,
          );
    }
    const conflict = this.adminContextConflict(anchors, false);
    if (conflict) {
      return this.rejected(
        proposalName,
        kind,
        anchors,
        evidenceKeys,
        ['destination_mismatch'],
        undefined,
        conflict.offendingEntities,
        anchors,
        undefined,
        conflict.reason,
        destinationGeometry,
      );
    }
    return {
      proposalName,
      kind,
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: 'component_defined',
      anchors,
      // Observability only: dispersion is never a validity threshold.
      coherence: coherenceMetrics(this.pointsOf(anchors)),
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * S-e: a point destination's explicit point-radius scope (the radius is
   * the destination's own scope input, PD3 deferred — never borrowed for a
   * regional Experience).
   */
  private validatePointRadiusDestination(
    resolvedProposal: ResolvedExperienceCandidate,
    entities: ResolvedGeoEntity[],
    scope: Extract<ExperienceGeographicScope, { kind: 'POINT_RADIUS' }>,
    unknownWhenBeyondDestination: GeographicScopeUnknownReason | undefined,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const outside = entities.filter(
      (entity) =>
        distanceMeters(
          {
            latitude: entity.latitude as number,
            longitude: entity.longitude as number,
          },
          scope.center,
        ) > scope.radiusMeters,
    );
    if (outside.length > 0) {
      return unknownWhenBeyondDestination
        ? this.rejectUnknownScope(
            resolvedProposal.candidate.name,
            entities,
            evidenceKeys,
            outside,
          )
        : this.rejected(
            resolvedProposal.candidate.name,
            'EXPERIENCE',
            outside,
            evidenceKeys,
            ['external_scope_mismatch'],
            undefined,
            outside,
            entities,
            undefined,
            'OUTSIDE_POINT_RADIUS_SCOPE',
          );
    }
    return {
      proposalName: resolvedProposal.candidate.name,
      kind: 'EXPERIENCE',
      status: 'AUTHORITATIVELY_VERIFIED',
      accepted: true,
      strategy: 'canonical_entity',
      anchors: entities,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * Evidence-based administrative contradictions between components:
   * COUNTRY always; REGION too for a candidate-owned scope (one real AREA or
   * ROUTE cannot contain components positively placed in different
   * regions). Missing admin metadata never counts as a conflict.
   */
  private adminContextConflict(
    anchors: ResolvedGeoEntity[],
    includeRegion: boolean,
  ):
    | {
        reason: GeographicDecisionReason;
        offendingEntities: ResolvedGeoEntity[];
      }
    | undefined {
    if (this.distinctAdminValues(anchors, 'country').size > 1) {
      return {
        reason: 'COUNTRY_CONFLICT',
        offendingEntities: anchors.filter((e) => e.adminContext?.country),
      };
    }
    if (includeRegion && this.distinctAdminValues(anchors, 'region').size > 1) {
      return {
        reason: 'REGION_CONFLICT',
        offendingEntities: anchors.filter((e) => e.adminContext?.region),
      };
    }
    return undefined;
  }

  /**
   * Destination scope is owned by the single destination-compatibility
   * policy; this validator only asks it. UNKNOWN is never treated as inside.
   */
  private isInsideDestination(
    entity: ResolvedGeoEntity,
    destination: GeographicScope | undefined,
  ): boolean {
    return (
      evaluateDestinationCompatibility(
        {
          probePoints: [
            {
              latitude: entity.latitude as number,
              longitude: entity.longitude as number,
            },
          ],
        },
        destination,
      ).verdict === 'COMPATIBLE'
    );
  }

  /**
   * Composite coherence is only defined over the FULL source composition.
   * Every source-backed component hint must have a resolved canonical
   * identity, and every resolved component must carry some canonical
   * geography: an unresolved component is never silently dropped from the
   * set (that would validate, and later persist, a trimmed composite), and
   * unknown geography is never treated as coherent.
   */
  private rejectIfSourceCompositionIncomplete(
    resolvedProposal: ResolvedExperienceCandidate,
    resolved: ResolvedGeoEntity[],
    withCoordinates: ResolvedGeoEntity[],
    evidenceKeys: string[],
  ): GeographicValidationResult | undefined {
    const proposalName = resolvedProposal.candidate.name;
    const incomplete = resolvedProposal.candidate.componentHints.some(
      (hint) => !resolved.some((entity) => entity.hintKey === hint.key),
    );
    if (incomplete) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        withCoordinates,
        evidenceKeys,
        ['incomplete_source_composition'],
        undefined,
        withCoordinates,
        withCoordinates,
      );
    }
    const withoutGeography = resolved.filter(
      (entity) =>
        !entity.geometry &&
        !(
          Number.isFinite(entity.latitude) && Number.isFinite(entity.longitude)
        ),
    );
    if (withoutGeography.length > 0) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        withoutGeography,
        evidenceKeys,
        ['missing_coordinates'],
        undefined,
        withoutGeography,
        resolved,
      );
    }
    return undefined;
  }

  /**
   * Task B5: a request-level scope resolved BEFORE acquisition even ran
   * (a real AREA polygon or ROUTE geometry the caller already knows about)
   * gates persistence regardless of whether THIS candidate's own
   * componentHints happen to include a matching AREA/ROUTE hint. Runs
   * BEFORE `tryCanonicalGeometry`/`validateExperience` — a violation here
   * rejects immediately, never falling through to the ordinary checks.
   * Returns undefined (no rejection) when the scope is satisfied, letting
   * the existing candidate-owned checks run unchanged afterward.
   */
  private rejectIfExternalScopeViolated(
    resolvedProposal: ResolvedExperienceCandidate,
    resolved: ResolvedGeoEntity[],
    withCoordinates: ResolvedGeoEntity[],
    validationScope: WorkUnitAnchorScope,
    evidenceKeys: string[],
    geographicAuthorization: GeographicValidationAuthorization,
    destinationBoundary?: OsmCandidate,
  ): {
    result?: GeographicValidationResult;
    areaScopeMembership?: AreaScopeMembershipAudit;
    routeScopeMembership?: RouteScopeMembershipAudit;
  } {
    const proposalName = resolvedProposal.candidate.name;
    // The source composition is complete here (see
    // rejectIfSourceCompositionIncomplete): every resolved component is
    // evaluated, none is hidden from the scope policy.

    // The scope geometry's own SHAPE must be usable for its declared kind,
    // checked independently of candidate composition — a malformed/wrong-
    // shaped geometry must fail closed even when there happen to be no
    // point-like entities to run through the per-entity checks
    // below (e.g. a route_like candidate with only a route-role
    // hint would otherwise let `pointLikeEntities` be empty,
    // vacuously passing `.find()` on an empty array regardless of whether
    // `validationScope.geometry` is real).
    if (
      !this.isUsableScopeGeometry(
        validationScope.kind,
        validationScope.geometry,
      )
    ) {
      const reason =
        validationScope.kind === 'ROUTE'
          ? 'EXTERNAL_ROUTE_SCOPE_MISMATCH'
          : 'EXTERNAL_AREA_SCOPE_MISMATCH';
      return {
        result: this.rejected(
          proposalName,
          'EXPERIENCE',
          resolved,
          evidenceKeys,
          ['external_scope_mismatch'],
          undefined,
          resolved,
          resolved,
          undefined,
          reason,
        ),
      };
    }

    if (validationScope.kind === 'AREA') {
      const policy: AreaScopeMembershipPolicy =
        authorizesAnchoredAreaMembership(geographicAuthorization)
          ? 'AREA_ANCHORED_ROUTE'
          : 'AREA_CONTAINED';
      const decision = evaluateAreaScopeMembership(
        validationScope.geometry,
        resolved.map(componentFact),
        policy,
      );
      const areaScopeMembership: AreaScopeMembershipAudit = {
        policy,
        decision,
        routeGeometryPresent: decision.components.some(
          (component) => component.basis === 'LINE',
        ),
        evaluatedComponentCount: resolved.length,
      };
      if (!decision.passes) {
        // The components the failed policy could not place: under strict
        // containment every non-INSIDE component; under anchored-route
        // semantics every non-area component without membership support.
        const outside = resolved.filter((entity) =>
          decision.components.some(
            (component) =>
              component.hintKey === entity.hintKey &&
              (policy === 'AREA_CONTAINED'
                ? component.relation !== 'INSIDE'
                : component.role !== 'area' &&
                  !relationSupportsMembership(component)),
          ),
        );
        return {
          result: this.rejected(
            proposalName,
            'EXPERIENCE',
            outside.length > 0 ? outside : resolved,
            evidenceKeys,
            ['external_scope_mismatch'],
            undefined,
            outside.length > 0 ? outside : resolved,
            resolved,
            areaScopeMembership,
            'EXTERNAL_AREA_SCOPE_MISMATCH',
            validationScope.geometry,
          ),
          areaScopeMembership,
        };
      }
      return { areaScopeMembership };
    }

    if (validationScope.kind === 'ROUTE') {
      const decision = evaluateRouteScopeMembership(
        {
          anchorName: validationScope.anchorName,
          geoEntityId: validationScope.geoEntityId,
          geometry: validationScope.geometry,
        },
        resolved.map(componentFact),
        destinationBoundary,
      );

      const routeScopeMembership: RouteScopeMembershipAudit = {
        decision,
        routeGeometryPresent: true,
        evaluatedComponentCount: resolved.length,
      };

      if (!decision.passes) {
        const offending = resolved.filter((entity) =>
          decision.components.some(
            (c) =>
              c.hintKey === entity.hintKey &&
              (c.relation === 'OUTSIDE_DESTINATION' ||
                c.relation === 'NO_MATERIAL_ANCHOR_RELATION'),
          ),
        );

        const mismatchReason: GeographicDecisionReason =
          decision.rejectionReason ?? 'EXTERNAL_ROUTE_SCOPE_MISMATCH';

        const rejectionReasons: GeographicValidationRejectionReason[] =
          mismatchReason === 'OUTSIDE_DESTINATION_BOUNDARY'
            ? ['destination_mismatch', 'external_scope_mismatch']
            : ['external_scope_mismatch'];

        return {
          result: this.rejected(
            proposalName,
            'EXPERIENCE',
            offending.length > 0 ? offending : resolved,
            evidenceKeys,
            rejectionReasons,
            undefined,
            offending.length > 0 ? offending : resolved,
            resolved,
            undefined,
            mismatchReason,
            destinationBoundary?.geometry,
            routeScopeMembership,
          ),
          routeScopeMembership,
        };
      }

      return { routeScopeMembership };
    }

    return {};
  }

  /**
   * Independent shape validity check for an `WorkUnitAnchorScope`'s
   * own geometry — a malformed/wrong-kind geometry must fail closed
   * regardless of candidate composition (see call site). AREA needs a
   * real polygonal shape (Polygon/MultiPolygon); ROUTE needs a real
   * LineString, or a MultiLineString of real segments, with at least one
   * line long enough to define a segment.
   */
  private isUsableScopeGeometry(
    kind: 'AREA' | 'ROUTE',
    geometry: GeoJsonGeometry | undefined,
  ): boolean {
    if (!geometry) return false;
    if (kind === 'AREA') {
      return (
        (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length > 0
      );
    }
    return isUsableRouteGeometry(geometry);
  }

  private distinctAdminValues(
    anchors: ResolvedGeoEntity[],
    key: 'country' | 'region',
  ): Set<string> {
    return new Set(
      anchors
        .map((entity) => entity.adminContext?.[key])
        .filter((value): value is string => Boolean(value))
        .map((value) => this.normalize(value)),
    );
  }

  private pointsOf(entities: ResolvedGeoEntity[]) {
    return entities.map((entity) => ({
      latitude: entity.latitude as number,
      longitude: entity.longitude as number,
    }));
  }

  private dedupeEntities(entities: ResolvedGeoEntity[]): ResolvedGeoEntity[] {
    const seen = new Set<string>();
    return entities.filter((entity) => {
      const key =
        entity.externalId ??
        `${entity.provider ?? 'unknown'}:${entity.latitude}:${entity.longitude}:${this.normalize(entity.canonicalName ?? entity.hintName)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private rejected(
    proposalName: string,
    kind: string,
    anchors: ResolvedGeoEntity[],
    evidenceKeys: string[],
    rejectionReasons: GeographicValidationRejectionReason[],
    coherence: ReturnType<typeof coherenceMetrics> | undefined,
    offendingEntities: ResolvedGeoEntity[] = [],
    evaluatedEntities: ResolvedGeoEntity[] = anchors,
    areaScopeMembership?: AreaScopeMembershipAudit,
    mismatchReason?: GeographicDecisionReason,
    distanceBoundaryGeometry?: GeoJsonGeometry,
    routeScopeMembership?: RouteScopeMembershipAudit,
  ): GeographicValidationResult {
    const decisionEntities: GeographicValidationDecisionEntity[] =
      evaluatedEntities.map((entity) => {
        const isOffending = offendingEntities.some(
          (offending) => offending.hintKey === entity.hintKey,
        );
        const baseEntity: GeographicValidationDecisionEntity = {
          geoEntityId: entity.geoEntityId,
          hintKey: entity.hintKey,
          relation: isOffending ? 'offending' : 'evaluated',
        };

        if (isOffending && mismatchReason) {
          baseEntity.decisionReason = mismatchReason;
          if (
            distanceBoundaryGeometry &&
            (mismatchReason === 'OUTSIDE_DESTINATION_BOUNDARY' ||
              mismatchReason === 'OUTSIDE_CANONICAL_AREA_BOUNDARY') &&
            Number.isFinite(entity.latitude) &&
            Number.isFinite(entity.longitude)
          ) {
            const distance = distancePointToPolygonBoundaryMeters(
              distanceBoundaryGeometry,
              entity.longitude as number,
              entity.latitude as number,
            );
            if (Number.isFinite(distance)) {
              baseEntity.distanceToBoundaryMeters = distance;
            }
          }
        }

        if (routeScopeMembership) {
          const compFact = routeScopeMembership.decision.components.find(
            (c) => c.hintKey === entity.hintKey,
          );
          if (compFact?.distanceFromRouteMeters !== undefined) {
            baseEntity.distanceFromRouteMeters =
              compFact.distanceFromRouteMeters;
          }
        }

        return baseEntity;
      });

    return {
      proposalName,
      kind,
      status: 'REJECTED',
      accepted: false,
      anchors,
      coherence,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons,
      areaScopeMembership,
      routeScopeMembership,
      decisionEntities,
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  private normalize(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}

function componentFact(
  entity: ResolvedGeoEntity,
): AreaScopeComponentFact & RouteScopeComponentFact {
  return {
    hintKey: entity.hintKey,
    hintName: entity.hintName,
    canonicalName: entity.canonicalName,
    role: entity.role,
    kind: entity.kind,
    geoEntityId: entity.geoEntityId,
    externalId: entity.externalId,
    latitude: entity.latitude,
    longitude: entity.longitude,
    geometry: entity.geometry,
    adminContext: entity.adminContext,
  };
}

/**
 * Whether a component relation supports area membership: a point/polygon
 * must be INSIDE; a real line geometry only has to enter the area.
 * UNDETERMINED never supports membership.
 */
function relationSupportsMembership(
  component: ComponentAreaRelationFact,
): boolean {
  return (
    component.relation === 'INSIDE' ||
    (component.basis === 'LINE' && component.relation === 'INTERSECTS')
  );
}
