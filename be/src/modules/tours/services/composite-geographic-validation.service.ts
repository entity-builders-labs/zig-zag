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
  mayExtendBeyondDestination,
  projectExperienceGeographicScope,
  scopeMembershipSemantics,
} from '../utils/experience-geographic-scope.policy';
import { evaluateSourceCompositionSupport } from '../utils/source-composition-support.policy';
import { MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS } from '../utils/acquisition-candidate-requirement.util';

/**
 * Composite geographic validation (spec 2026-10-02 Part II §P2-2 question B,
 * §P2-8, amended by §P2-18): is this source-backed composition
 * geographically valid?
 *
 * Five questions stay separate: IDENTITY (resolver + IdentityVerifier),
 * SOURCE COMPOSITION (extraction contract + one supporting record),
 * GEOGRAPHIC DESCRIPTION (facts: relation to the source-named scope and to
 * the destination), STRICT CONSTRAINTS (a user-named work-unit anchor; the
 * destination ceiling of a candidate that may not extend beyond it) and
 * TRIP FEASIBILITY (planner). Decided against the scope derived by the
 * single owner `deriveExperienceGeographicScope` — never against a circle
 * and never with a coherence radius:
 *  - CANDIDATE_AREA / CANDIDATE_ROUTE (S-b/S-c): DESCRIPTIVE source context;
 *    a member outside it is a recorded fact, judged only by the destination
 *    ceiling, one-record source support and evidence contradictions;
 *  - a regional WORK_UNIT_ANCHOR AREA: STRICT containment;
 *  - DESTINATION_AREA / DESTINATION_POINT_RADIUS (S-d/S-e): every component
 *    inside, unless the candidate may extend beyond the destination
 *    (ROUTE_LIKE, no strict anchor): then its geography is its verified
 *    components (`SOURCE_DEFINED_COMPONENTS`) — a missing canonical AREA is
 *    never by itself GEOGRAPHIC_SCOPE_UNKNOWN;
 *  - UNKNOWN: rejected (fail closed).
 * The work-unit anchor scope (S-a) is checked first, in conjunction. Source
 * composition completeness is checked before anything else: an unresolved
 * component is never dropped to make a composite valid, so identity stays
 * a separate, fail-closed blocker.
 *
 * The result carries the Experience scope (with its membership semantics)
 * and the trip-relative `destinationRelation` fact; a verified regional
 * Experience is accepted whatever that relation is (tour eligibility
 * consumes it later).
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
        mayExtendBeyondDestination(geographicAuthorization, validationScope),
      );
    }

    if (areaScopeMembership && !result.areaScopeMembership) {
      result = { ...result, areaScopeMembership };
    }
    if (routeScopeMembership && !result.routeScopeMembership) {
      result = { ...result, routeScopeMembership };
    }
    if (derived) {
      const derivedScope = derived.scope;
      result = {
        ...result,
        experienceScope:
          result.experienceScope ??
          projectExperienceGeographicScope(
            derived,
            derivedScope.kind === 'UNKNOWN' ||
              derivedScope.kind === 'SOURCE_DEFINED_COMPONENTS'
              ? undefined
              : {
                  semantics: scopeMembershipSemantics(
                    derivedScope,
                    mayExtendBeyondDestination(
                      geographicAuthorization,
                      validationScope,
                    ),
                  ),
                },
          ),
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

  /**
   * Dispatch on the single derived Experience scope (§P2-7) and its
   * membership semantics (§P2-18): a STRICT scope is a constraint, a
   * DESCRIPTIVE scope is source context whose mismatches are facts.
   */
  private validateAgainstScope(
    resolvedProposal: ResolvedExperienceCandidate,
    resolved: ResolvedGeoEntity[],
    withCoordinates: ResolvedGeoEntity[],
    derived: DerivedExperienceGeographicScope,
    destination: GeographicScope | undefined,
    evidenceKeys: string[],
    extendsBeyondDestination: boolean,
  ): GeographicValidationResult {
    const scope = derived.scope;
    switch (scope.kind) {
      case 'UNKNOWN':
      case 'SOURCE_DEFINED_COMPONENTS':
        // Derivation never yields SOURCE_DEFINED_COMPONENTS (it depends on
        // where the components were verified); treat it as no scope.
        return this.rejectUnknownScope(
          resolvedProposal.candidate.name,
          withCoordinates,
          evidenceKeys,
          withCoordinates,
        );
      case 'ROUTE':
      case 'AREA':
        if (scope.provenance === 'WORK_UNIT_ANCHOR') {
          return this.validateStrictAnchorArea(
            resolvedProposal,
            withCoordinates,
            scope,
            evidenceKeys,
          );
        }
        if (
          scope.provenance === 'CANDIDATE_AREA' ||
          scope.provenance === 'CANDIDATE_ROUTE'
        ) {
          return this.validateDescriptiveScope(
            resolvedProposal,
            resolved,
            withCoordinates,
            derived,
            scope,
            destination,
            evidenceKeys,
            extendsBeyondDestination,
          );
        }
        return this.validateDestinationLocal(
          resolvedProposal,
          withCoordinates,
          destination,
          evidenceKeys,
          extendsBeyondDestination,
        );
      case 'POINT_RADIUS':
        return this.validatePointRadiusDestination(
          resolvedProposal,
          withCoordinates,
          scope,
          evidenceKeys,
          extendsBeyondDestination,
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
   * S-b / S-c (§P2-18): the source's own canonical AREA or physical ROUTE is
   * DESCRIPTIVE context, not a containment boundary. Each member's relation
   * to it (AREA: a point INSIDE / a line entering it; ROUTE: anchor, on the
   * route, or sharing an enclosing source AREA with it) is a recorded fact.
   * A member outside it is judged by what actually constrains or contradicts
   * the composition — never by how far outside it lies:
   *  - the destination ceiling: unless the candidate may extend beyond the
   *    destination (`mayExtendBeyondDestination`: ROUTE_LIKE, no strict
   *    user anchor), a member outside the scope must still lie in the
   *    destination — `OUTSIDE_DESTINATION_BOUNDARY`;
   *  - a member that may extend beyond, outside both the scope and the
   *    destination, is a
   *    member only because the source says so: ONE source record must
   *    support every member — `COMPOSITION_NOT_SUPPORTED_BY_ONE_SOURCE`;
   *  - evidence contradictions: components in different countries
   *    (`COUNTRY_CONFLICT`), or, for a source-named AREA, a member outside
   *    it whose verified admin region contradicts the AREA's own region
   *    evidence (`REGION_CONFLICT`).
   */
  private validateDescriptiveScope(
    resolvedProposal: ResolvedExperienceCandidate,
    resolved: ResolvedGeoEntity[],
    withCoordinates: ResolvedGeoEntity[],
    derived: DerivedExperienceGeographicScope,
    /** A CANDIDATE_AREA (S-b) or CANDIDATE_ROUTE (S-c) scope. */
    scope: Extract<ExperienceGeographicScope, { kind: 'AREA' | 'ROUTE' }>,
    destination: GeographicScope | undefined,
    evidenceKeys: string[],
    extendsBeyondDestination: boolean,
  ): GeographicValidationResult {
    const proposalName = resolvedProposal.candidate.name;
    const isArea = scope.kind === 'AREA';
    const kind = isArea ? 'EXPERIENCE' : 'ROUTE';
    const scopeEntity = isArea
      ? resolved.find(
          (entity) =>
            entity.role === 'area' &&
            (!scope.geoEntityId || entity.geoEntityId === scope.geoEntityId) &&
            entity.geometry === scope.geometry,
        )
      : withCoordinates.find(
          (entity) =>
            isCanonicalPhysicalRouteComponent(entity) &&
            (!scope.geoEntityId || entity.geoEntityId === scope.geoEntityId),
        );
    const members = withCoordinates.filter((entity) =>
      isArea ? entity.role !== 'area' : entity !== scopeEntity,
    );
    const evaluated = scopeEntity ? [scopeEntity, ...members] : members;

    let routeScopeMembership: RouteScopeMembershipAudit | undefined;
    let relatedToScope: (entity: ResolvedGeoEntity) => boolean;
    if (isArea) {
      relatedToScope = (entity) =>
        relationSupportsMembership(
          classifyComponentAreaRelation(scope.geometry, componentFact(entity)),
        );
    } else {
      const decision = evaluateRouteScopeMembership(
        {
          anchorName: scope.name ?? '',
          geoEntityId: scope.geoEntityId,
          geometry: scope.geometry,
        },
        evaluated.map(componentFact),
        destination?.kind === 'AREA_BOUNDARY'
          ? destination.boundary
          : undefined,
      );
      routeScopeMembership = {
        decision,
        routeGeometryPresent: true,
        evaluatedComponentCount: evaluated.length,
      };
      relatedToScope = (entity) =>
        decision.components.some(
          (component) =>
            component.hintKey === entity.hintKey &&
            (component.relation === 'ANCHOR_COMPONENT' ||
              component.relation === 'ON_ROUTE' ||
              component.relation === 'SAME_LOCAL_SCOPE'),
        );
    }

    const outsideScope = members.filter((entity) => !relatedToScope(entity));
    // The single destination-relation owner judges the members the scope
    // does not place: positively OUTSIDE, or UNDETERMINED (a structural
    // ROUTE/AREA without its own geometry — a representative point is never
    // trusted, and an unknown relation never counts as inside).
    const destinationFacts = evaluateExperienceDestinationRelation(
      outsideScope.map(componentFact),
      destination,
    );
    const beyondDestination = outsideScope.filter(
      (entity) =>
        destinationFacts.outsideComponentKeys.includes(entity.hintKey) ||
        destinationFacts.undeterminedComponentKeys.includes(entity.hintKey),
    );
    const reject = (
      reasons: GeographicValidationRejectionReason[],
      offending: ResolvedGeoEntity[],
      reason: GeographicDecisionReason,
      boundary?: GeoJsonGeometry,
    ) =>
      this.rejected(
        proposalName,
        kind,
        evaluated,
        evidenceKeys,
        reasons,
        undefined,
        offending,
        evaluated,
        undefined,
        reason,
        boundary,
        routeScopeMembership,
      );

    if (beyondDestination.length > 0) {
      if (!extendsBeyondDestination) {
        const positivelyOutside =
          destinationFacts.outsideComponentKeys.length > 0;
        return reject(
          positivelyOutside
            ? ['destination_mismatch']
            : ['geographic_scope_unknown'],
          beyondDestination,
          positivelyOutside
            ? 'OUTSIDE_DESTINATION_BOUNDARY'
            : 'GEOGRAPHIC_SCOPE_UNKNOWN',
          destination?.kind === 'AREA_BOUNDARY'
            ? destination.boundary.geometry
            : undefined,
        );
      }
      if (
        !evaluateSourceCompositionSupport(resolvedProposal.candidate).supported
      ) {
        return reject(
          ['source_composition_unsupported'],
          beyondDestination,
          'COMPOSITION_NOT_SUPPORTED_BY_ONE_SOURCE',
        );
      }
    }

    const conflict =
      this.countryConflict(members) ??
      (isArea
        ? this.areaRegionContradiction(
            scopeEntity,
            members.filter((entity) => !outsideScope.includes(entity)),
            outsideScope,
          )
        : undefined);
    if (conflict) {
      return reject(
        ['geographic_incoherence'],
        conflict.offendingEntities,
        conflict.reason,
      );
    }
    return {
      proposalName,
      kind,
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: isArea ? 'canonical_area' : 'canonical_geometry',
      canonicalEntity: scopeEntity,
      anchors: evaluated,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      ...(routeScopeMembership ? { routeScopeMembership } : {}),
      experienceScope: projectExperienceGeographicScope(derived, {
        semantics: 'DESCRIPTIVE',
        outsideScopeComponentKeys: outsideScope.map((entity) => entity.hintKey),
      }),
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * A user-named regional AREA anchor acting as the Experience scope (S-a,
   * ROUTE_LIKE only): STRICT — the request asked for an Experience of that
   * area, so every member must relate to it through the single
   * area-membership authority (a point INSIDE, a real line entering it).
   */
  private validateStrictAnchorArea(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    scope: Extract<ExperienceGeographicScope, { kind: 'AREA' | 'ROUTE' }>,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposalName = resolvedProposal.candidate.name;
    const members = withCoordinates.filter((entity) => entity.role !== 'area');
    const outsideArea = members.filter(
      (entity) =>
        !relationSupportsMembership(
          classifyComponentAreaRelation(scope.geometry, componentFact(entity)),
        ),
    );
    if (outsideArea.length > 0) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        members,
        evidenceKeys,
        ['outside_experience_scope'],
        undefined,
        outsideArea,
        members,
        undefined,
        'OUTSIDE_CANONICAL_AREA_BOUNDARY',
        scope.geometry,
      );
    }
    const conflict = this.countryConflict(members);
    if (conflict) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        members,
        evidenceKeys,
        ['geographic_incoherence'],
        undefined,
        conflict.offendingEntities,
        members,
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
      anchors: members,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * S-d: a destination-local Experience. A single venue must carry grounded
   * evidence and lie inside the destination; a composite needs the
   * composition contract's minimum of distinct resolved components. For a
   * DEFAULT/WALK candidate the destination is its authorization ceiling:
   * every component inside it. A ROUTE_LIKE composite whose verified
   * components extend beyond it with no enclosing canonical scope is judged
   * on its source-defined component geography (§P2-18), never rejected
   * merely because no polygon encloses it. Dispersion is planning
   * feasibility, not validity (no coherence radius).
   */
  private validateDestinationLocal(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    destination: GeographicScope | undefined,
    evidenceKeys: string[],
    extendsBeyondDestination: boolean,
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
      return extendsBeyondDestination
        ? this.validateSourceDefinedComposition(
            resolvedProposal,
            anchors,
            outside,
            evidenceKeys,
          )
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
    const conflict = this.countryConflict(anchors);
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
   * §P2-18 (amended PD2): UNKNOWN CANONICAL AREA does not imply UNKNOWN
   * SOURCE-DEFINED COMPOSITION. A ROUTE_LIKE composition whose every
   * component already has a VERIFIED identity and canonical geography
   * (composition completeness is checked before any scope) is represented
   * by those components themselves — no AREA, ROUTE, centroid or radius is
   * manufactured. Membership then rests on the source alone, so ONE source
   * record must support every member; components positively placed in
   * different countries contradict it. Its relation to the trip destination
   * is the separate `destinationRelation` fact, consumed by tour
   * eligibility, and reaching it is planning feasibility.
   */
  private validateSourceDefinedComposition(
    resolvedProposal: ResolvedExperienceCandidate,
    anchors: ResolvedGeoEntity[],
    beyondDestination: ResolvedGeoEntity[],
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposalName = resolvedProposal.candidate.name;
    const support = evaluateSourceCompositionSupport(
      resolvedProposal.candidate,
    );
    if (support.supported === false) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        anchors,
        evidenceKeys,
        ['source_composition_unsupported'],
        undefined,
        beyondDestination,
        anchors,
        undefined,
        'COMPOSITION_NOT_SUPPORTED_BY_ONE_SOURCE',
      );
    }
    const conflict = this.countryConflict(anchors);
    if (conflict) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        anchors,
        evidenceKeys,
        ['geographic_incoherence'],
        undefined,
        conflict.offendingEntities,
        anchors,
        undefined,
        conflict.reason,
      );
    }
    return {
      proposalName,
      kind: 'EXPERIENCE',
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: 'source_defined_components',
      anchors,
      // Observability only: dispersion is never a validity threshold.
      coherence: coherenceMetrics(this.pointsOf(anchors)),
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      experienceScope: projectExperienceGeographicScope({
        scope: {
          kind: 'SOURCE_DEFINED_COMPONENTS',
          provenance: 'SOURCE_COMPOSITION',
          supportingEvidenceKeys: support.supportingEvidenceKeys,
        },
      }),
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * S-e: a point destination's explicit point-radius scope (the radius is
   * the destination's own scope input, PD3 deferred — never borrowed for a
   * regional Experience). STRICT for DEFAULT/WALK; a ROUTE_LIKE composite
   * extending beyond it is source-defined (§P2-18).
   */
  private validatePointRadiusDestination(
    resolvedProposal: ResolvedExperienceCandidate,
    entities: ResolvedGeoEntity[],
    scope: Extract<ExperienceGeographicScope, { kind: 'POINT_RADIUS' }>,
    evidenceKeys: string[],
    extendsBeyondDestination: boolean,
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
      const members = entities.filter((entity) => entity.role !== 'area');
      return extendsBeyondDestination &&
        members.length >= MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS
        ? this.validateSourceDefinedComposition(
            resolvedProposal,
            members,
            outside,
            evidenceKeys,
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
   * Evidence-based contradiction: components positively placed in
   * different countries. Missing admin metadata never counts as a conflict.
   */
  private countryConflict(anchors: ResolvedGeoEntity[]):
    | {
        reason: GeographicDecisionReason;
        offendingEntities: ResolvedGeoEntity[];
      }
    | undefined {
    return this.distinctAdminValues(anchors, 'country').size > 1
      ? {
          reason: 'COUNTRY_CONFLICT',
          offendingEntities: anchors.filter((e) => e.adminContext?.country),
        }
      : undefined;
  }

  /**
   * §P2-18: a source-named AREA is the source's claim that the composition
   * takes place there. Its region evidence is the AREA's own verified admin
   * region, else the single region its INSIDE members agree on. A member
   * OUTSIDE the AREA whose verified region differs contradicts that claim.
   * Region diversity among members alone, inside members, and members or
   * areas without region evidence are never a contradiction (an AREA may
   * straddle a boundary; unknown stays unknown).
   */
  private areaRegionContradiction(
    areaEntity: ResolvedGeoEntity | undefined,
    insideMembers: ResolvedGeoEntity[],
    outsideMembers: ResolvedGeoEntity[],
  ):
    | {
        reason: GeographicDecisionReason;
        offendingEntities: ResolvedGeoEntity[];
      }
    | undefined {
    const areaRegions = areaEntity?.adminContext?.region
      ? new Set([this.normalize(areaEntity.adminContext.region)])
      : this.distinctAdminValues(insideMembers, 'region');
    if (areaRegions.size !== 1) return undefined;
    const [areaRegion] = [...areaRegions];
    const offending = outsideMembers.filter(
      (entity) =>
        !!entity.adminContext?.region &&
        this.normalize(entity.adminContext.region) !== areaRegion,
    );
    return offending.length > 0
      ? { reason: 'REGION_CONFLICT', offendingEntities: offending }
      : undefined;
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
