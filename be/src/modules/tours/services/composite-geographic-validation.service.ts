import { Injectable, Logger } from '@nestjs/common';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS,
  GEOGRAPHIC_VALIDATOR_VERSION,
  GeographicPoint,
  GeographicValidationBatchResult,
  GeographicValidationRejectionReason,
  GeographicValidationResult,
  GeographicValidationThresholds,
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
import { distancePointToLineStringMeters } from '../utils/route-geometry.util';

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

    const externalScopeValidation = validationScope
      ? this.rejectIfExternalScopeViolated(
          resolvedProposal,
          withCoordinates,
          validationScope,
          groundedEvidenceKeys,
        )
      : undefined;

    let result: GeographicValidationResult;
    if (externalScopeValidation?.accepted === false) {
      result = externalScopeValidation;
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
            );
    }

    if (!result.decisionEntities) {
      result.decisionEntities = withCoordinates.map((entity) => ({
        geoEntityId: entity.geoEntityId,
        hintKey: entity.hintKey,
        relation: 'evaluated' as const,
      }));
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
    const outside = entities.find(
      (entity) =>
        !geometryContainsPoint(
          geometry,
          entity.longitude as number,
          entity.latitude as number,
        ),
    );
    return outside
      ? this.rejected(
          resolvedProposal.candidate.name,
          'EXPERIENCE',
          [outside],
          evidenceKeys,
          ['external_scope_mismatch'],
          undefined,
          [outside],
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
    const outside = entities.find(
      (entity) =>
        distanceMeters(
          {
            latitude: entity.latitude as number,
            longitude: entity.longitude as number,
          },
          { latitude: scope.latitude, longitude: scope.longitude },
        ) > scope.radiusMeters,
    );
    return outside
      ? this.rejected(
          resolvedProposal.candidate.name,
          'EXPERIENCE',
          [outside],
          evidenceKeys,
          ['external_scope_mismatch'],
          undefined,
          [outside],
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
    withCoordinates: ResolvedGeoEntity[],
    validationScope: ExperienceValidationScope,
    evidenceKeys: string[],
  ): GeographicValidationResult | undefined {
    const proposalName = resolvedProposal.candidate.name;
    const requiredHints = resolvedProposal.candidate.componentHints.filter(
      (hint) => hint.required,
    );

    const unresolvedRequired = requiredHints.some(
      (hint) => !withCoordinates.some((entity) => entity.hintKey === hint.key),
    );
    if (unresolvedRequired) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        withCoordinates,
        evidenceKeys,
        ['unresolved_required_component'],
      );
    }

    const requiredEntities = withCoordinates.filter((entity) =>
      requiredHints.some((hint) => hint.key === entity.hintKey),
    );

    // The scope geometry's own SHAPE must be usable for its declared kind,
    // checked independently of candidate composition — a malformed/wrong-
    // shaped geometry must fail closed even when there happen to be no
    // required point-like entities to run through the per-entity checks
    // below (e.g. a route_like candidate with only a route-role required
    // hint would otherwise let `requiredPointLikeEntities` be empty,
    // vacuously passing `.find()` on an empty array regardless of whether
    // `validationScope.geometry` is real).
    if (
      validationScope.kind !== 'POINT_RADIUS' &&
      !this.isUsableScopeGeometry(
        validationScope.kind,
        validationScope.geometry,
      )
    ) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        requiredEntities,
        evidenceKeys,
        ['external_scope_mismatch'],
      );
    }

    if (validationScope.kind === 'AREA') {
      const outside = requiredEntities.find(
        (entity) =>
          !geometryContainsPoint(
            validationScope.geometry,
            entity.longitude as number,
            entity.latitude as number,
          ),
      );
      if (outside) {
        return this.rejected(
          proposalName,
          'EXPERIENCE',
          [outside],
          evidenceKeys,
          ['external_scope_mismatch'],
          undefined,
          [outside],
          requiredEntities,
        );
      }
      return undefined;
    }

    // ROUTE: real corridor-membership check via distancePointToLineStringMeters
    // (NOT routeDestinationMismatch's regional destination-centroid/radius
    // approximation — that policy still runs afterward, unchanged, as an
    // additional regional-coherence guard once corridor membership passes).
    // Applied ONLY to required point-like (venue/waypoint) components, NEVER
    // to the canonical ROUTE entity itself — its own representative/centroid
    // coordinate is not guaranteed to lie on its own LineString, and its
    // identity is already validationScope.geoEntityId + geometry.
    const requiredPointLikeEntities = requiredEntities.filter(
      (entity) => entity.role !== 'route',
    );
    const tooFar = requiredPointLikeEntities.find(
      (entity) =>
        distancePointToLineStringMeters(
          {
            latitude: entity.latitude as number,
            longitude: entity.longitude as number,
          },
          validationScope.geometry,
        ) > this.thresholds.route.maxComponentDistanceFromRouteMeters,
    );
    if (tooFar) {
      return this.rejected(
        proposalName,
        'EXPERIENCE',
        [tooFar],
        evidenceKeys,
        ['external_scope_mismatch'],
        undefined,
        [tooFar],
      );
    }
    return undefined;
  }

  /**
   * Independent shape validity check for an `ExperienceValidationScope`'s
   * own geometry — a malformed/wrong-kind geometry must fail closed
   * regardless of candidate composition (see call site). AREA needs a
   * real polygonal shape (Polygon/MultiPolygon); ROUTE needs a real
   * LineString with enough coordinates to define a segment.
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
      if (
        this.routeDestinationMismatch([canonicalRoute], destinationBoundary)
      ) {
        return this.rejected(
          proposalName,
          'ROUTE',
          [canonicalRoute],
          evidenceKeys,
          ['destination_mismatch'],
        );
      }
      // Task B5 (correctness point 10): validate every OTHER required
      // component too, not just the one canonical ROUTE entity.
      const requiredHints = resolvedProposal.candidate.componentHints.filter(
        (hint) => hint.required,
      );
      const requiredNonRouteHints = requiredHints.filter(
        (hint) => hint.role !== 'route',
      );
      const unresolvedRequiredNonRoute = requiredNonRouteHints.some(
        (hint) =>
          !withCoordinates.some((entity) => entity.hintKey === hint.key),
      );
      if (unresolvedRequiredNonRoute) {
        return this.rejected(
          proposalName,
          'ROUTE',
          [canonicalRoute],
          evidenceKeys,
          ['unresolved_required_component'],
        );
      }
      const requiredNonRouteEntities = withCoordinates.filter(
        (entity) =>
          entity.role !== 'route' &&
          requiredNonRouteHints.some((hint) => hint.key === entity.hintKey),
      );
      const fullRequiredSet = [canonicalRoute, ...requiredNonRouteEntities];
      if (this.routeDestinationMismatch(fullRequiredSet, destinationBoundary)) {
        return this.rejected(
          proposalName,
          'ROUTE',
          fullRequiredSet,
          evidenceKeys,
          ['destination_mismatch'],
        );
      }
      return {
        proposalName,
        kind: 'ROUTE',
        status: 'GEO_VERIFIED',
        accepted: true,
        strategy: 'canonical_geometry',
        canonicalEntity: canonicalRoute,
        anchors: fullRequiredSet,
        groundedEvidenceKeys: evidenceKeys,
        rejectionReasons: [],
        validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
      };
    }

    // Task B5 (correctness point 14): the canonical-area shortcut applies
    // ONLY when there is EXACTLY ONE required AREA hint — zero required
    // AREA hints means no shortcut at all; two or more means a genuine
    // multi-area Experience that must fall through to validateExperience's
    // destination+coherence path instead of being forced into one area's
    // containment. An optional (non-required) AREA hint never triggers
    // this shortcut on its own.
    const requiredAreaHints = resolvedProposal.candidate.componentHints.filter(
      (hint) => hint.required && hint.role === 'area',
    );
    const hasWaypointHint = resolvedProposal.candidate.componentHints.some(
      (hint) => hint.role === 'waypoint' || hint.role === 'venue',
    );
    if (requiredAreaHints.length === 1 && hasWaypointHint) {
      const canonicalArea = withCoordinates.find(
        (entity) =>
          entity.role === 'area' &&
          entity.hintKey === requiredAreaHints[0].key &&
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
          );
        }
        // Task B5 (correctness point 10): validate every OTHER required
        // (non-area) component too, not just the canonical AREA entity.
        const requiredNonAreaHints =
          resolvedProposal.candidate.componentHints.filter(
            (hint) => hint.required && hint.role !== 'area',
          );
        const unresolvedRequiredNonArea = requiredNonAreaHints.some(
          (hint) =>
            !withCoordinates.some((entity) => entity.hintKey === hint.key),
        );
        if (unresolvedRequiredNonArea) {
          return this.rejected(
            proposalName,
            'EXPERIENCE',
            [canonicalArea],
            evidenceKeys,
            ['unresolved_required_component'],
          );
        }
        const requiredNonAreaEntities = withCoordinates.filter(
          (entity) =>
            entity.role !== 'area' &&
            requiredNonAreaHints.some((hint) => hint.key === entity.hintKey),
        );
        const outsideArea = requiredNonAreaEntities.find(
          (entity) =>
            !geometryContainsPoint(
              canonicalArea.geometry as GeoJsonGeometry,
              entity.longitude as number,
              entity.latitude as number,
            ),
        );
        if (outsideArea) {
          return this.rejected(
            proposalName,
            'EXPERIENCE',
            [canonicalArea, outsideArea],
            evidenceKeys,
            ['destination_mismatch'],
            undefined,
            [outsideArea],
          );
        }
        return {
          proposalName,
          kind: 'EXPERIENCE',
          status: 'GEO_VERIFIED',
          accepted: true,
          strategy: 'canonical_area',
          canonicalEntity: canonicalArea,
          anchors: [canonicalArea, ...requiredNonAreaEntities],
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
    const requiredConcreteHints = proposal.componentHints.filter(
      (hint) => hint.required,
    );
    const venueCentric =
      requiredConcreteHints.length === 1 &&
      requiredConcreteHints[0].role === 'venue';
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
        return this.rejected(proposalName, kind, anchors, evidenceKeys, [
          'grounded_evidence_missing',
        ]);
      }
      const venue = anchors.find(
        (entity) => entity.hintKey === requiredConcreteHints[0].key,
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

    const unresolvedRequired = requiredConcreteHints.some(
      (hint) =>
        !resolvedProposal.resolvedEntities.some(
          (entity) =>
            entity.hintKey === hint.key && entity.status === 'resolved',
        ),
    );
    if (unresolvedRequired) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'unresolved_required_component',
      ]);
    }
    if (
      anchors.length < (routeScale ? 1 : this.thresholds.experience.minAnchors)
    ) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'insufficient_resolved_entities',
      ]);
    }
    if (
      routeScale
        ? this.routeDestinationMismatch(anchors, destinationBoundary)
        : this.destinationMismatch(anchors, destinationBoundary, false)
    ) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'destination_mismatch',
      ]);
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
  ): boolean {
    if (
      anchors.some(
        (entity) => !this.isInsideDestination(entity, destinationBoundary),
      )
    ) {
      return true;
    }

    const countries = this.distinctAdminValues(anchors, 'country');
    if (countries.size > 1) return true;

    if (requireSameLocality) {
      const localities = new Set<string>();
      for (const entity of anchors) {
        const locality =
          entity.adminContext?.locality ?? entity.adminContext?.municipality;
        if (locality) localities.add(this.normalize(locality));
      }
      if (localities.size > 1) return true;
    }
    return false;
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
  ): boolean {
    const countries = this.distinctAdminValues(anchors, 'country');
    if (countries.size > 1) return true;
    const regions = this.distinctAdminValues(anchors, 'region');
    if (regions.size > 1) return true;

    const destinationCenter = this.centroidOfGeometry(
      destinationBoundary.geometry,
    );
    return anchors.some((entity) => {
      if (this.isInsideDestination(entity, destinationBoundary)) return false;
      if (
        !Number.isFinite(entity.latitude) ||
        !Number.isFinite(entity.longitude)
      ) {
        return true;
      }
      return (
        distanceMeters(destinationCenter, {
          latitude: entity.latitude as number,
          longitude: entity.longitude as number,
        }) > this.thresholds.route.maxRadiusMeters
      );
    });
  }

  private isInsideDestination(
    entity: ResolvedGeoEntity,
    destinationBoundary: OsmCandidate,
  ): boolean {
    if (
      !Number.isFinite(entity.latitude) ||
      !Number.isFinite(entity.longitude)
    ) {
      return false;
    }
    return geometryContainsPoint(
      destinationBoundary.geometry,
      entity.longitude as number,
      entity.latitude as number,
    );
  }

  private centroidOfGeometry(geometry: GeoJsonGeometry): GeographicPoint {
    if (geometry.type === 'Point') {
      return {
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0],
      };
    }
    const ring: [number, number][] =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.coordinates[0][0];
    return {
      latitude: ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length,
      longitude: ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length,
    };
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
    coherence?: ReturnType<typeof coherenceMetrics>,
    offendingEntities: ResolvedGeoEntity[] = [],
    evaluatedEntities: ResolvedGeoEntity[] = anchors,
  ): GeographicValidationResult {
    return {
      proposalName,
      kind,
      status: 'REJECTED',
      accepted: false,
      anchors,
      coherence,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons,
      decisionEntities: evaluatedEntities.map((entity) => ({
        geoEntityId: entity.geoEntityId,
        hintKey: entity.hintKey,
        relation: offendingEntities.some(
          (offending) => offending.hintKey === entity.hintKey,
        )
          ? 'offending'
          : 'evaluated',
      })),
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
