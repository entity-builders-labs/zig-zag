import { Injectable } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
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
 * Plans transient origins for point-based catalog acquisition.
 *
 * For an area destination, anchors are ordered by:
 *  1. POI density (number of existing catalog POIs inside the candidate's
 *     bounding box) — highest first, so dense central barrios like Palermo,
 *     Recoleta, San Telmo are naturally selected before peripheral barrios.
 *  2. Proximity to the destination center (tie-break within equal density).
 *  3. Alphabetical ID (stable last-resort tie-break).
 *
 * This replaces the earlier farthest-first k-center approach, which maximised
 * geometric spread at the expense of tourism relevance — producing anchors
 * in peripheral, low-tourism barrios while skipping the central ones a
 * visitor would care about.
 *
 * Anchors are always geographic coverage only: they neither rank tourism
 * relevance nor select an area for composite generation.
 */
@Injectable()
export class CatalogRefillAnchorPlanner {
  constructor(private readonly prisma: PrismaService) {}

  async plan(
    input: CatalogRefillAnchorPlanInput,
  ): Promise<CatalogRefillAnchor[]> {
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

    const candidates = await this.toCoverageCandidates(
      input.coverageAreas ?? [],
      boundary,
      anchors,
    );
    this.selectByPOIDensity(anchors, candidates, input.destinationPoint);

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

  private async toCoverageCandidates(
    coverageAreas: OsmCandidate[],
    boundary: GeoJsonGeometry,
    existingAnchors: CatalogRefillAnchor[],
  ): Promise<CatalogRefillAnchorWithDensity[]> {
    const uniqueAreas = new Map<string, OsmCandidate>();
    for (const area of coverageAreas) {
      if (!uniqueAreas.has(area.id)) uniqueAreas.set(area.id, area);
    }
    const seenCoordinates = new Set(
      existingAnchors.map((anchor) => this.coordinateKey(anchor)),
    );

    return Promise.all(
      [...uniqueAreas.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(async (area) => {
          const point = this.representativePoint(area.geometry);
          if (
            !point ||
            !Number.isFinite(point.latitude) ||
            !Number.isFinite(point.longitude) ||
            !geometryContainsPoint(boundary, point.longitude, point.latitude) ||
            seenCoordinates.has(this.coordinateKey(point))
          ) {
            return null;
          }
          seenCoordinates.add(this.coordinateKey(point));
          const poiCount = await this.countPOIsInGeometry(area.geometry);
          return {
            id: area.id,
            label: area.name,
            ...point,
            radiusMeters: this.radiusForGeometry(area.geometry),
            source: 'child_area_center' as const,
            poiDensity: poiCount,
          };
        }),
    ).then((results) =>
      results.filter((r): r is NonNullable<typeof r> => r !== null),
    );
  }

  private async countPOIsInGeometry(
    geometry: GeoJsonGeometry,
  ): Promise<number> {
    if (geometry.type === 'Point') return 0;
    const bbox = boundingBoxToCenterRadius(geometry);
    const radiusKm = bbox.radiusMeters / 1000;
    const lat = bbox.latitude;
    const lon = bbox.longitude;
    const degPerKm = 1 / 111.32;
    const latDelta = radiusKm * degPerKm;
    const lonDelta = (radiusKm * degPerKm) / Math.cos((lat * Math.PI) / 180);

    const result = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*)::bigint AS count FROM activity
       WHERE kind != 'AREA'
         AND isArchived = false
         AND latitude IS NOT NULL
         AND longitude IS NOT NULL
         AND latitude BETWEEN $1 AND $2
         AND longitude BETWEEN $3 AND $4`,
      lat - latDelta,
      lat + latDelta,
      lon - lonDelta,
      lon + lonDelta,
    );
    return Number(result[0]?.count ?? 0);
  }

  private selectByPOIDensity(
    anchors: CatalogRefillAnchor[],
    candidates: CatalogRefillAnchorWithDensity[],
    destinationPoint: { latitude: number; longitude: number },
  ): void {
    candidates.sort((a, b) => {
      const densityDiff = (b.poiDensity ?? 0) - (a.poiDensity ?? 0);
      if (densityDiff !== 0) return densityDiff;
      const proximityDiff =
        calculateDistance(a, destinationPoint) -
        calculateDistance(b, destinationPoint);
      return proximityDiff || a.id.localeCompare(b.id);
    });

    while (anchors.length < MAX_ANCHORS && candidates.length > 0) {
      anchors.push(candidates.shift()!);
    }
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

interface CatalogRefillAnchorWithDensity extends CatalogRefillAnchor {
  poiDensity: number;
}
