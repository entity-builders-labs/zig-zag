import { Injectable, Logger } from '@nestjs/common';
import { ActivityKind } from '@prisma/client';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { ActivityProposal } from '../interfaces/activity-discovery.interface';
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
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import {
  coherenceMetrics,
  distanceMeters,
} from '../utils/geographic-coherence.util';

const PROPOSAL_KIND_TO_ACTIVITY_KIND: Record<
  ActivityProposal['kind'],
  ActivityKind
> = {
  POI: ActivityKind.POI,
  AREA: ActivityKind.AREA,
  NEIGHBORHOOD_WALK: ActivityKind.NEIGHBORHOOD_WALK,
  ROUTE: ActivityKind.ROUTE,
  EXPERIENCE: ActivityKind.EXPERIENCE,
};

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
    destinationBoundary: OsmCandidate,
  ): GeographicValidationResult {
    const { proposal, resolvedEntities } = resolvedProposal;
    const kind = PROPOSAL_KIND_TO_ACTIVITY_KIND[proposal.kind];
    const resolved = resolvedEntities.filter(
      (entity) => entity.status === 'resolved',
    );
    const withCoordinates = resolved.filter(
      (entity) =>
        Number.isFinite(entity.latitude) && Number.isFinite(entity.longitude),
    );
    const groundedEvidenceKeys = Array.from(new Set(proposal.evidenceKeys));

    let result: GeographicValidationResult;
    switch (kind) {
      case ActivityKind.POI:
      case ActivityKind.AREA:
        result = this.validateCanonical(
          proposal.name,
          kind,
          resolved,
          withCoordinates,
          destinationBoundary,
          groundedEvidenceKeys,
        );
        break;
      case ActivityKind.NEIGHBORHOOD_WALK:
        result = this.validateNeighborhoodWalk(
          resolvedProposal,
          withCoordinates,
          destinationBoundary,
          groundedEvidenceKeys,
        );
        break;
      case ActivityKind.ROUTE:
        result = this.validateRoute(
          resolvedProposal,
          withCoordinates,
          destinationBoundary,
          groundedEvidenceKeys,
        );
        break;
      case ActivityKind.EXPERIENCE:
        result = this.validateExperience(
          resolvedProposal,
          withCoordinates,
          destinationBoundary,
          groundedEvidenceKeys,
        );
        break;
      default:
        result = this.rejected(proposal.name, kind, [], groundedEvidenceKeys, [
          'no_resolved_entities',
        ]);
    }

    this.logger.log(
      JSON.stringify({
        event: 'geographic_validation',
        proposalName: proposal.name,
        activityKind: kind,
        proposedHintCount: proposal.entityHints.length,
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

  private validateCanonical(
    proposalName: string,
    kind: ActivityKind,
    resolved: ResolvedGeoEntity[],
    withCoordinates: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    if (resolved.length === 0) {
      return this.rejected(proposalName, kind, [], evidenceKeys, [
        'no_resolved_entities',
      ]);
    }
    if (withCoordinates.length === 0) {
      return this.rejected(proposalName, kind, resolved, evidenceKeys, [
        'missing_coordinates',
      ]);
    }
    const canonicalEntity = withCoordinates[0];
    if (!this.isInsideDestination(canonicalEntity, destinationBoundary)) {
      return this.rejected(
        proposalName,
        kind,
        [canonicalEntity],
        evidenceKeys,
        ['destination_mismatch'],
      );
    }
    return {
      proposalName,
      kind,
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: 'canonical_entity',
      canonicalEntity,
      anchors: [canonicalEntity],
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  private validateNeighborhoodWalk(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposalName = resolvedProposal.proposal.name;
    const kind = ActivityKind.NEIGHBORHOOD_WALK;
    const canonicalArea = withCoordinates.find(
      (entity) => entity.role === 'area' && entity.geometry,
    );
    if (canonicalArea) {
      if (!this.isInsideDestination(canonicalArea, destinationBoundary)) {
        return this.rejected(
          proposalName,
          kind,
          [canonicalArea],
          evidenceKeys,
          ['destination_mismatch'],
        );
      }
      return {
        proposalName,
        kind,
        status: 'GEO_VERIFIED',
        accepted: true,
        strategy: 'canonical_area',
        canonicalEntity: canonicalArea,
        anchors: [canonicalArea],
        groundedEvidenceKeys: evidenceKeys,
        rejectionReasons: [],
        validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
      };
    }

    const anchors = this.dedupeEntities(
      withCoordinates.filter(
        (entity) => entity.role === 'waypoint' || entity.role === 'venue',
      ),
    );
    if (anchors.length < this.thresholds.neighborhoodWalk.minAnchors) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'insufficient_resolved_entities',
      ]);
    }
    if (this.destinationMismatch(anchors, destinationBoundary, true)) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'destination_mismatch',
      ]);
    }
    const coherence = coherenceMetrics(this.pointsOf(anchors));
    if (
      coherence.radiusMeters >
        this.thresholds.neighborhoodWalk.maxRadiusMeters ||
      coherence.maxPairwiseDistanceMeters >
        this.thresholds.neighborhoodWalk.maxPairwiseDistanceMeters
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
      strategy: 'compact_anchors',
      anchors,
      coherence,
      groundedEvidenceKeys: evidenceKeys,
      rejectionReasons: [],
      validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
    };
  }

  private validateRoute(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposalName = resolvedProposal.proposal.name;
    const kind = ActivityKind.ROUTE;
    const canonicalRoute = withCoordinates.find(
      (entity) => entity.role === 'route' && entity.geometry,
    );
    if (canonicalRoute) {
      if (
        this.routeDestinationMismatch([canonicalRoute], destinationBoundary)
      ) {
        return this.rejected(
          proposalName,
          kind,
          [canonicalRoute],
          evidenceKeys,
          ['destination_mismatch'],
        );
      }
      return {
        proposalName,
        kind,
        status: 'GEO_VERIFIED',
        accepted: true,
        strategy: 'canonical_geometry',
        canonicalEntity: canonicalRoute,
        anchors: [canonicalRoute],
        groundedEvidenceKeys: evidenceKeys,
        rejectionReasons: [],
        validatorVersion: GEOGRAPHIC_VALIDATOR_VERSION,
      };
    }

    const anchors = this.dedupeEntities(
      withCoordinates.filter((entity) => entity.role !== 'area'),
    );
    if (anchors.length < this.thresholds.route.minAnchors) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'insufficient_resolved_entities',
      ]);
    }
    if (this.routeDestinationMismatch(anchors, destinationBoundary)) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'destination_mismatch',
      ]);
    }
    const coherence = coherenceMetrics(this.pointsOf(anchors));
    if (
      coherence.radiusMeters > this.thresholds.route.maxRadiusMeters ||
      coherence.maxPairwiseDistanceMeters >
        this.thresholds.route.maxPairwiseDistanceMeters
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

  private validateExperience(
    resolvedProposal: ResolvedExperienceCandidate,
    withCoordinates: ResolvedGeoEntity[],
    destinationBoundary: OsmCandidate,
    evidenceKeys: string[],
  ): GeographicValidationResult {
    const proposal = resolvedProposal.proposal;
    const proposalName = proposal.name;
    const kind = ActivityKind.EXPERIENCE;
    const requiredConcreteHints = proposal.entityHints.filter(
      (hint) => hint.required && hint.role !== 'area' && hint.role !== 'route',
    );
    const venueCentric =
      requiredConcreteHints.length === 1 &&
      requiredConcreteHints[0].role === 'venue';
    const anchors = this.dedupeEntities(
      withCoordinates.filter((entity) => entity.role !== 'area'),
    );

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
          return this.rejected(proposalName, kind, [venue], evidenceKeys, [
            'destination_mismatch',
          ]);
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
    if (anchors.length < this.thresholds.experience.minAnchors) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'insufficient_resolved_entities',
      ]);
    }
    if (this.destinationMismatch(anchors, destinationBoundary, false)) {
      return this.rejected(proposalName, kind, anchors, evidenceKeys, [
        'destination_mismatch',
      ]);
    }
    const coherence = coherenceMetrics(this.pointsOf(anchors));
    if (
      coherence.radiusMeters > this.thresholds.experience.maxRadiusMeters ||
      coherence.maxPairwiseDistanceMeters >
        this.thresholds.experience.maxPairwiseDistanceMeters
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
    kind: ActivityKind,
    anchors: ResolvedGeoEntity[],
    evidenceKeys: string[],
    rejectionReasons: GeographicValidationRejectionReason[],
    coherence?: ReturnType<typeof coherenceMetrics>,
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
