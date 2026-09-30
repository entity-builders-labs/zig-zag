import { Injectable, Logger } from '@nestjs/common';
import { evaluateDestinationCompatibility } from '../utils/destination-compatibility.policy';
import {
  geometryContainsPoint,
  distancePointToPolygonBoundaryMeters,
} from '@integrations/osm/utils/geojson-containment.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS,
  GEOGRAPHIC_VALIDATOR_VERSION,
  GeographicValidationBatchResult,
  GeographicValidationDecisionEntity,
  GeographicValidationRejectionReason,
  GeographicValidationResult,
  GeographicValidationThresholds,
  GeographicDecisionReason,
} from '../interfaces/geographic-validation.interface';
import {
  ExperienceGeographicValidationBatchResult,
  ExperienceValidationScope,
  GeographicScope,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
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

@Injectable()
export class CompositeGeographicValidationService {
  private readonly logger = new Logger(
    CompositeGeographicValidationService.name,
  );

  constructor(
    private readonly thresholds: GeographicValidationThresholds = DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS,
  ) {}

  validateBatch(
    resolution: ExperienceGeographicValidationBatchResult,
    destinationBoundary: OsmCandidate,
  ): GeographicValidationBatchResult {
    const results = resolution.resolved.map((resolved) =>
      this.validate(resolved, destinationBoundary),
    );
    return {
      results,
      acceptedCount: results.filter((result) => result.accepted).length,
      rejectedCount: results.filter((result) => !result.accepted).length,
    };
  }

  validate(
    resolvedProposal: ResolvedExperienceCandidate,
    destinationBoundary: OsmCandidate | undefined,
    validationScope?: ExperienceValidationScope,
    validationIntent?: 'walk' | 'route_like',
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
            validationIntent,
            destinationBoundary,
          )
        : undefined;

    const areaScopeMembership = externalScopeValidation?.areaScopeMembership;
    const routeScopeMembership = externalScopeValidation?.routeScopeMembership;
    let result: GeographicValidationResult;
    if (compositionViolation) {
      result = compositionViolation;
    } else if (externalScopeValidation?.result?.accepted === false) {
      result = externalScopeValidation.result;
    } else if (geographicScope?.kind === 'POINT_RADIUS') {
      result = this.validatePointRadiusCoordinates(
        resolvedProposal,
        withCoordinates,
        geographicScope,
        groundedEvidenceKeys,
      );
    } else if (validationScope?.kind === 'POINT_RADIUS') {
      result = this.validatePointRadiusScope(
        resolvedProposal,
        withCoordinates,
        validationScope.geometry,
        groundedEvidenceKeys,
      );
    } else {
      const canonicalValidation = this.tryCanonicalGeometry(
        resolvedProposal,
        withCoordinates,
        destinationBoundary,
        groundedEvidenceKeys,
      );
      result = canonicalValidation
        ? canonicalValidation
        : destinationBoundary
          ? this.validateExperience(
              resolvedProposal,
              withCoordinates,
              destinationBoundary,
              groundedEvidenceKeys,
              validationIntent,
            )
          : this.rejected(
              candidate.name,
              'EXPERIENCE',
              withCoordinates,
              groundedEvidenceKeys,
              ['destination_mismatch'],
              undefined,
              withCoordinates,
              withCoordinates,
              undefined,
              undefined,
              undefined,
            );
    }

    if (areaScopeMembership && !result.areaScopeMembership) {
      result = { ...result, areaScopeMembership };
    }
    if (routeScopeMembership && !result.routeScopeMembership) {
      result = { ...result, routeScopeMembership };
    }

    if (!result.decisionEntities) {
      result.decisionEntities = withCoordinates.map((entity) => {
        const routeFact = routeScopeMembership?.decision.components.find(
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
        radiusMeters: result.coherence?.radiusMeters,
        maxPairwiseDistanceMeters: result.coherence?.maxPairwiseDistanceMeters,
      }),
    );
    return result;
  }

  private validatePointRadiusScope(
    resolvedProposal: ResolvedExperienceCandidate,
    entities: ResolvedGeoEntity[],
    geometry: GeoJsonGeometry,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const outside = entities.filter(
      (entity) =>
        !geometryContainsPoint(
          geometry,
          entity.longitude as number,
          entity.latitude as number,
        ),
    );
    return outside.length > 0
      ? this.rejected(
          resolvedProposal.candidate.name,
          'EXPERIENCE',
          outside,
          evidenceKeys,
          ['external_scope_mismatch'],
          undefined,
          outside,
          entities,
          undefined,
          'EXTERNAL_AREA_SCOPE_MISMATCH',
          geometry,
        )
      : {
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

  private validatePointRadiusCoordinates(
    resolvedProposal: ResolvedExperienceCandidate,
    entities: ResolvedGeoEntity[],
    scope: Extract<GeographicScope, { kind: 'POINT_RADIUS' }>,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const outside = entities.filter(
      (entity) =>
        distanceMeters(
          {
            latitude: entity.latitude as number,
            longitude: entity.longitude as number,
          },
          { latitude: scope.latitude, longitude: scope.longitude },
        ) > scope.radiusMeters,
    );
    return outside.length > 0
      ? this.rejected(
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
        )
      : {
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
    validationScope: ExperienceValidationScope,
    evidenceKeys: string[],
    validationIntent?: 'walk' | 'route_like',
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
      validationScope.kind !== 'POINT_RADIUS' &&
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
        validationIntent === 'walk' || validationIntent === 'route_like'
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
   * Independent shape validity check for an `ExperienceValidationScope`'s
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
    if (geometry.type === 'MultiLineString') {
      return (
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.some(
          (line) => Array.isArray(line) && line.length >= 2,
        )
      );
    }
    return (
      geometry.type === 'LineString' &&
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length >= 2
    );
  }

  /**
   * A resolved GeoEntity with real canonical geometry (a ROUTE linestring
   * matching a `route`-role hint, or an AREA polygon matching an `area`-role
   * hint alongside at least one waypoint/venue hint) is authoritative —
   * accept immediately rather than falling through to the anchor-count/
   * coherence heuristics `validateExperience` uses for candidates that never
   * had real geometry to begin with. `validateExperience` already filters
   * out `role === 'area'` entities entirely (never treating an area as a
   * valid anchor on its own) and has no equivalent short-circuit for a
   * resolved ROUTE geometry either, so without this a genuinely well-evidenced
   * route/area candidate could be rejected as `insufficient_resolved_entities`
   * purely because its one strong anchor doesn't count as one.
   * Returns undefined (no short-circuit) for every other case, in which case
   * the caller falls through to `validateExperience` unchanged.
   */
  private tryCanonicalGeometry(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
    evidenceKeys: string[],
  ): GeographicValidationResult | undefined {
    const proposalName = resolvedProposal.candidate.name;

    const canonicalRoute = withCoordinates.find(
      (entity) => entity.role === 'route' && entity.geometry,
    );
    if (canonicalRoute) {
      const routeMismatch = this.routeDestinationMismatch(
        [canonicalRoute],
        destinationBoundary,
      );
      if (routeMismatch.mismatch) {
        return this.rejected(
          proposalName,
          'ROUTE',
          [canonicalRoute],
          evidenceKeys,
          ['destination_mismatch'],
          undefined,
          routeMismatch.offendingEntities,
          [canonicalRoute],
          undefined,
          routeMismatch.reason,
          destinationBoundary.geometry,
        );
      }
      // Task B5 (correctness point 10): validate every OTHER source
      // component too, not just the one canonical ROUTE entity (the
      // composition is complete here, see rejectIfSourceCompositionIncomplete).
      const nonRouteEntities = withCoordinates.filter(
        (entity) => entity.role !== 'route',
      );
      const fullSet = [canonicalRoute, ...nonRouteEntities];
      const fullMismatch = this.routeDestinationMismatch(
        fullSet,
        destinationBoundary,
      );
      if (fullMismatch.mismatch) {
        return this.rejected(
          proposalName,
          'ROUTE',
          fullSet,
          evidenceKeys,
          ['destination_mismatch'],
          undefined,
          fullMismatch.offendingEntities,
          fullSet,
          undefined,
          fullMismatch.reason,
          destinationBoundary.geometry,
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
        validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
      };
    }

    // Task B5 (correctness point 14): the canonical-area shortcut applies
    // ONLY when there is EXACTLY ONE source AREA component — zero AREA
    // components means no shortcut at all; two or more means a genuine
    // multi-area Experience that must fall through to validateExperience's
    // destination+coherence path instead of being forced into one area's
    // containment.
    const areaHints = resolvedProposal.candidate.componentHints.filter(
      (hint) => hint.role === 'area',
    );
    const hasWaypointHint = resolvedProposal.candidate.componentHints.some(
      (hint) => hint.role === 'waypoint' || hint.role === 'venue',
    );
    if (areaHints.length === 1 && hasWaypointHint) {
      const canonicalArea = withCoordinates.find(
        (entity) =>
          entity.role === 'area' &&
          entity.hintKey === areaHints[0].key &&
          entity.geometry,
      );
      if (canonicalArea) {
        if (!this.isInsideDestination(canonicalArea, destinationBoundary)) {
          return this.rejected(
            proposalName,
            'EXPERIENCE',
            [canonicalArea],
            evidenceKeys,
            ['destination_mismatch'],
            undefined,
            [canonicalArea],
            [canonicalArea],
            undefined,
            'OUTSIDE_DESTINATION_BOUNDARY',
            destinationBoundary.geometry,
          );
        }
        // Task B5 (correctness point 10): validate every OTHER (non-area)
        // source component too, not just the canonical AREA entity, through
        // the single area-membership authority: a point must be INSIDE, a
        // real street/route geometry must enter the area.
        const nonAreaEntities = withCoordinates.filter(
          (entity) => entity.role !== 'area',
        );
        const outsideArea = nonAreaEntities.filter(
          (entity) =>
            !relationSupportsMembership(
              classifyComponentAreaRelation(
                canonicalArea.geometry as GeoJsonGeometry,
                componentFact(entity),
              ),
            ),
        );
        if (outsideArea.length > 0) {
          // For outsideArea, the mismatch is against the canonicalArea geometry, not the destinationBoundary
          // We need to calculate distance to the canonicalArea polygon
          return this.rejected(
            proposalName,
            'EXPERIENCE',
            [canonicalArea, ...outsideArea],
            evidenceKeys,
            ['destination_mismatch'],
            undefined,
            outsideArea,
            [canonicalArea, ...outsideArea],
            undefined,
            'OUTSIDE_CANONICAL_AREA_BOUNDARY',
            canonicalArea.geometry as GeoJsonGeometry,
          );
        }
        return {
          proposalName,
          kind: 'EXPERIENCE',
          status: 'GEO_VERIFIED',
          accepted: true,
          strategy: 'canonical_area',
          canonicalEntity: canonicalArea,
          anchors: [canonicalArea, ...nonAreaEntities],
          groundedEvidenceKeys: evidenceKeys,
          rejectionReasons: [],
          validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
        };
      }
    }

    return undefined;
  }

  private validateExperience(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
    evidenceKeys: string[],
    validationIntent?: 'walk' | 'route_like',
  ): GeographicValidationResult {
    const proposal = resolvedProposal.candidate;
    const proposalName = proposal.name;
    const kind = 'EXPERIENCE';
    const venueCentric =
      proposal.componentHints.length === 1 &&
      proposal.componentHints[0].role === 'venue';
    const anchors = this.dedupeEntities(
      withCoordinates.filter((entity) => entity.role !== 'area'),
    );
    const hasCanonicalRouteComponent = anchors.some(
      (entity) => entity.role === 'route',
    );
    // Task B5 (correctness points 15/19): route-scale geographic policy
    // applies to a real route_like tourism Experience with NO canonical
    // ROUTE component too -- sourced ONLY from the request's own
    // `validationIntent`, NEVER from `proposal.intents`/`themes`/`traits`
    // (discovery-extraction fields that are not authoritative and, post-B6,
    // are not even populated). This does not mean `route_like == ROUTE`;
    // it only widens which threshold set applies below.
    const routeScale =
      hasCanonicalRouteComponent || validationIntent === 'route_like';

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
        if (!this.isInsideDestination(venue, destinationBoundary)) {
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
            destinationBoundary.geometry,
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

    if (
      anchors.length < (routeScale ? 1 : this.thresholds.experience.minAnchors)
    ) {
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
    const mismatch = routeScale
      ? this.routeDestinationMismatch(anchors, destinationBoundary)
      : this.destinationMismatch(anchors, destinationBoundary, false);
    if (mismatch.mismatch) {
      return this.rejected(
        proposalName,
        kind,
        anchors,
        evidenceKeys,
        ['destination_mismatch'],
        undefined,
        mismatch.offendingEntities,
        anchors,
        undefined,
        mismatch.reason,
        destinationBoundary.geometry,
      );
    }
    const coherence = coherenceMetrics(this.pointsOf(anchors));
    if (
      coherence.radiusMeters >
        (routeScale
          ? this.thresholds.route.maxRadiusMeters
          : this.thresholds.experience.maxRadiusMeters) ||
      coherence.maxPairwiseDistanceMeters >
        (routeScale
          ? this.thresholds.route.maxPairwiseDistanceMeters
          : this.thresholds.experience.maxPairwiseDistanceMeters)
    ) {
      return this.rejected(
        proposalName,
        kind,
        anchors,
        evidenceKeys,
        ['geographic_incoherence'],
        coherence,
        anchors,
        anchors,
      );
    }
    return {
      proposalName,
      kind,
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: 'component_defined',
      anchors,
      coherence,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  /**
   * Walks and ordinary experiences are destination-local and therefore every
   * component must remain inside the resolved destination boundary. ROUTE has
   * a separate policy because a real regional route can legitimately leave a
   * city polygon (for example wineries in Maipú/Luján de Cuyo for Mendoza).
   */
  private destinationMismatch(
    anchors: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
    requireSameLocality: boolean,
  ): {
    mismatch: boolean;
    reason?: GeographicDecisionReason;
    offendingEntities: ResolvedGeoEntity[];
  } {
    // Check polygon containment
    const outsidePolygon = anchors.filter(
      (entity) => !this.isInsideDestination(entity, destinationBoundary),
    );
    if (outsidePolygon.length > 0) {
      return {
        mismatch: true,
        reason: 'OUTSIDE_DESTINATION_BOUNDARY',
        offendingEntities: outsidePolygon,
      };
    }

    const countries = this.distinctAdminValues(anchors, 'country');
    if (countries.size > 1) {
      return {
        mismatch: true,
        reason: 'COUNTRY_CONFLICT',
        offendingEntities: anchors.filter((e) => e.adminContext?.country),
      };
    }

    if (requireSameLocality) {
      const localities = new Set<string>();
      const localityEntities: ResolvedGeoEntity[] = [];
      for (const entity of anchors) {
        const locality =
          entity.adminContext?.locality ?? entity.adminContext?.municipality;
        if (locality) {
          localities.add(this.normalize(locality));
          localityEntities.push(entity);
        }
      }
      if (localities.size > 1) {
        return {
          mismatch: true,
          reason: 'LOCALITY_CONFLICT',
          offendingEntities: localityEntities,
        };
      }
    }
    return { mismatch: false, offendingEntities: [] };
  }

  /**
   * A component-defined ROUTE is validated against the broader destination
   * context rather than the city polygon alone. Administrative contradictions
   * are authoritative when metadata exists; otherwise coordinates may extend
   * outside the polygon only within the route-scale threshold from the
   * destination centroid. This keeps regional routes possible without turning
   * an unrelated distant cluster into a valid route.
   */
  private routeDestinationMismatch(
    anchors: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
  ): {
    mismatch: boolean;
    reason?: GeographicDecisionReason;
    offendingEntities: ResolvedGeoEntity[];
  } {
    const countries = this.distinctAdminValues(anchors, 'country');
    if (countries.size > 1) {
      return {
        mismatch: true,
        reason: 'COUNTRY_CONFLICT',
        offendingEntities: anchors.filter((e) => e.adminContext?.country),
      };
    }
    const regions = this.distinctAdminValues(anchors, 'region');
    if (regions.size > 1) {
      return {
        mismatch: true,
        reason: 'REGION_CONFLICT',
        offendingEntities: anchors.filter((e) => e.adminContext?.region),
      };
    }

    const outsideRadius = anchors.filter((entity) => {
      if (
        !Number.isFinite(entity.latitude) ||
        !Number.isFinite(entity.longitude)
      ) {
        return true;
      }
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
          { kind: 'AREA_BOUNDARY', boundary: destinationBoundary },
          {
            routeScale: true,
          },
        ).verdict !== 'COMPATIBLE'
      );
    });
    if (outsideRadius.length > 0) {
      return {
        mismatch: true,
        reason: 'OUTSIDE_ROUTE_DESTINATION_RADIUS',
        offendingEntities: outsideRadius,
      };
    }
    return { mismatch: false, offendingEntities: [] };
  }

  /**
   * Destination scope is owned by the single destination-compatibility
   * policy; this validator only asks it. UNKNOWN is never treated as inside.
   */
  private isInsideDestination(
    entity: ResolvedGeoEntity,
    destinationBoundary: OsmCandidate,
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
        { kind: 'AREA_BOUNDARY', boundary: destinationBoundary },
      ).verdict === 'COMPATIBLE'
    );
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
