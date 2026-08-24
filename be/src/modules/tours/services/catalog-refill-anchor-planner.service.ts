import { Injectable } from '@nestjs/common';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { calculateDistance } from '@shared/utils/distance.utils';
import { DestinationResolution } from './destination-resolution.service';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';

export interface CatalogRefillAnchor {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  source: 'destination_point' | 'child_area_center' | 'boundary';
}

export interface CatalogRefillAnchorPlanInput {
  destinationResolution: DestinationResolution;
  destinationPoint: { latitude: number; longitude: number };
  pointRadiusMeters: number;
  coverageAreas?: OsmCandidate[];
}

const MAX_ANCHORS = 8;
const MAX_ANCHOR_RADIUS_METERS = 5_000;
const MIN_ANCHOR_RADIUS_METERS = 1_000;
const DEFAULT_CHILD_AREA_RADIUS_METERS = 2_500;

/**
 * Plans transient origins for point-based catalog acquisition. For an area
 * destination, bounded farthest-first k-center spreads the available real
 * child-area centers across the authoritative destination geometry. This is
 * geographic coverage only: it neither ranks tourism relevance nor selects
 * an area for composite generation.
 */
@Injectable()
export class CatalogRefillAnchorPlanner {
  plan(input: CatalogRefillAnchorPlanInput): CatalogRefillAnchor[] {
    if (input.destinationResolution.scale === 'point') {
      return [this.destinationPointAnchor(input)];
    }

    const boundary = input.destinationResolution.boundary.geometry;
    const anchors: CatalogRefillAnchor[] = [];
    if (
      geometryContainsPoint(
        boundary,
        input.destinationPoint.longitude,
        input.destinationPoint.latitude,
      )
    ) {
      anchors.push(this.destinationPointAnchor(input));
    } else {
      const boundaryPoint = this.representativePoint(boundary);
      if (
        boundaryPoint &&
        geometryContainsPoint(
          boundary,
          boundaryPoint.longitude,
          boundaryPoint.latitude,
        )
      ) {
        anchors.push({
          id: input.destinationResolution.boundary.id,
          label: input.destinationResolution.boundary.name,
          ...boundaryPoint,
          radiusMeters: this.radiusForGeometry(boundary),
          source: 'boundary',
        });
      }
    }

    const candidates = this.toCoverageCandidates(
      input.coverageAreas ?? [],
      boundary,
      anchors,
    );
    this.addFarthestFirst(anchors, candidates, input.destinationPoint);

    return this.deduplicateCoordinates(anchors).slice(0, MAX_ANCHORS);
  }

  private destinationPointAnchor(
    input: CatalogRefillAnchorPlanInput,
  ): CatalogRefillAnchor {
    return {
      id: 'destination-point',
      label:
        input.destinationResolution.scale === 'area'
          ? input.destinationResolution.boundary.name
          : 'Destination point',
      latitude: input.destinationPoint.latitude,
      longitude: input.destinationPoint.longitude,
      radiusMeters: this.clampRadius(input.pointRadiusMeters),
      source: 'destination_point',
    };
  }

  private toCoverageCandidates(
    coverageAreas: OsmCandidate[],
    boundary: GeoJsonGeometry,
    existingAnchors: CatalogRefillAnchor[],
  ): CatalogRefillAnchor[] {
    const uniqueAreas = new Map<string, OsmCandidate>();
    for (const area of coverageAreas) {
      if (!uniqueAreas.has(area.id)) uniqueAreas.set(area.id, area);
    }

    const seenCoordinates = new Set(
      existingAnchors.map((anchor) => this.coordinateKey(anchor)),
    );
    return [...uniqueAreas.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap((area) => {
        const point = this.representativePoint(area.geometry);
        if (
          !point ||
          !Number.isFinite(point.latitude) ||
          !Number.isFinite(point.longitude) ||
          !geometryContainsPoint(boundary, point.longitude, point.latitude) ||
          seenCoordinates.has(this.coordinateKey(point))
        ) {
          return [];
        }
        seenCoordinates.add(this.coordinateKey(point));
        return [
          {
            id: area.id,
            label: area.name,
            ...point,
            radiusMeters: this.radiusForGeometry(area.geometry),
            source: 'child_area_center' as const,
          },
        ];
      });
  }

  private addFarthestFirst(
    anchors: CatalogRefillAnchor[],
    candidates: CatalogRefillAnchor[],
    destinationPoint: { latitude: number; longitude: number },
  ): void {
    const remaining = [...candidates];
    if (anchors.length === 0 && remaining.length > 0) {
      remaining.sort(
        (a, b) =>
          calculateDistance(a, destinationPoint) -
            calculateDistance(b, destinationPoint) || a.id.localeCompare(b.id),
      );
      anchors.push(remaining.shift()!);
    }

    while (anchors.length < MAX_ANCHORS && remaining.length > 0) {
      remaining.sort((a, b) => {
        const distanceDifference =
          this.distanceToClosestAnchor(b, anchors) -
          this.distanceToClosestAnchor(a, anchors);
        return distanceDifference || a.id.localeCompare(b.id);
      });
      anchors.push(remaining.shift()!);
    }
  }

  private distanceToClosestAnchor(
    candidate: CatalogRefillAnchor,
    anchors: CatalogRefillAnchor[],
  ): number {
    return Math.min(
      ...anchors.map((anchor) => calculateDistance(candidate, anchor)),
    );
  }

  private representativePoint(
    geometry: GeoJsonGeometry,
  ): { latitude: number; longitude: number } | null {
    if (geometry.type === 'Point') {
      return {
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1],
      };
    }

    const searchArea = boundingBoxToCenterRadius(geometry);
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      if (
        geometryContainsPoint(
          geometry,
          searchArea.longitude,
          searchArea.latitude,
        )
      ) {
        return {
          latitude: searchArea.latitude,
          longitude: searchArea.longitude,
        };
      }

      const first =
        geometry.type === 'Polygon'
          ? geometry.coordinates[0]?.[0]
          : geometry.coordinates[0]?.[0]?.[0];
      return first ? { longitude: first[0], latitude: first[1] } : null;
    }

    return {
      latitude: searchArea.latitude,
      longitude: searchArea.longitude,
    };
  }

  private radiusForGeometry(geometry: GeoJsonGeometry): number {
    if (geometry.type === 'Point') return DEFAULT_CHILD_AREA_RADIUS_METERS;
    return this.clampRadius(boundingBoxToCenterRadius(geometry).radiusMeters);
  }

  private clampRadius(radiusMeters: number): number {
    return Math.min(
      MAX_ANCHOR_RADIUS_METERS,
      Math.max(MIN_ANCHOR_RADIUS_METERS, radiusMeters),
    );
  }

  private deduplicateCoordinates(
    anchors: CatalogRefillAnchor[],
  ): CatalogRefillAnchor[] {
    const seen = new Set<string>();
    return anchors.filter((anchor) => {
      const key = this.coordinateKey(anchor);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private coordinateKey(point: {
    latitude: number;
    longitude: number;
  }): string {
    return `${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`;
  }
}
