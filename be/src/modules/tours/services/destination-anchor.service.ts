import { Injectable } from '@nestjs/common';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { DestinationResolution } from './destination-resolution.service';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';

export interface DestinationAnchor {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  source: 'destination_point' | 'neighborhood' | 'boundary';
}

export interface DestinationAnchorInput {
  destinationResolution: DestinationResolution;
  destinationPoint: { latitude: number; longitude: number };
  pointRadiusMeters: number;
  shortlistedNeighborhoods?: OsmCandidate[];
}

const MAX_ANCHORS = 8;
const MAX_ANCHOR_RADIUS_METERS = 5_000;
const MIN_ANCHOR_RADIUS_METERS = 1_000;
const DEFAULT_NEIGHBORHOOD_RADIUS_METERS = 2_500;

/**
 * Converts a resolved destination into bounded point origins for point-based
 * Places APIs. Anchors are transient request values, never catalog entities.
 */
@Injectable()
export class DestinationAnchorService {
  buildAnchors(input: DestinationAnchorInput): DestinationAnchor[] {
    if (input.destinationResolution.scale === 'point') {
      return [
        {
          id: 'destination-point',
          label: 'Destination point',
          latitude: input.destinationPoint.latitude,
          longitude: input.destinationPoint.longitude,
          radiusMeters: this.clampRadius(input.pointRadiusMeters),
          source: 'destination_point',
        },
      ];
    }

    const anchors: DestinationAnchor[] = [];
    for (const neighborhood of input.shortlistedNeighborhoods ?? []) {
      if (anchors.length >= MAX_ANCHORS) break;
      const point = this.representativePoint(neighborhood.geometry);
      if (!point) continue;
      anchors.push({
        id: neighborhood.id,
        label: neighborhood.name,
        latitude: point.latitude,
        longitude: point.longitude,
        radiusMeters: this.radiusForGeometry(neighborhood.geometry),
        source: 'neighborhood',
      });
    }

    const boundary = input.destinationResolution.boundary.geometry;
    const destinationIsInside = geometryContainsPoint(
      boundary,
      input.destinationPoint.longitude,
      input.destinationPoint.latitude,
    );
    if (destinationIsInside && anchors.length < MAX_ANCHORS) {
      anchors.push({
        id: 'destination-point',
        label: input.destinationResolution.boundary.name,
        latitude: input.destinationPoint.latitude,
        longitude: input.destinationPoint.longitude,
        radiusMeters: this.clampRadius(input.pointRadiusMeters),
        source: 'destination_point',
      });
    }

    // An area can legitimately expose no child neighborhoods. Preserve a
    // bounded refill using the authoritative boundary rather than reverting
    // to the old unbounded city-radius crawl.
    if (anchors.length === 0) {
      const point = this.representativePoint(boundary);
      if (point) {
        anchors.push({
          id: input.destinationResolution.boundary.id,
          label: input.destinationResolution.boundary.name,
          latitude: point.latitude,
          longitude: point.longitude,
          radiusMeters: this.radiusForGeometry(boundary),
          source: 'boundary',
        });
      }
    }

    return this.deduplicateCoordinates(anchors).slice(0, MAX_ANCHORS);
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
    if (geometry.type === 'Point') return DEFAULT_NEIGHBORHOOD_RADIUS_METERS;
    return this.clampRadius(boundingBoxToCenterRadius(geometry).radiusMeters);
  }

  private clampRadius(radiusMeters: number): number {
    return Math.min(
      MAX_ANCHOR_RADIUS_METERS,
      Math.max(MIN_ANCHOR_RADIUS_METERS, radiusMeters),
    );
  }

  private deduplicateCoordinates(
    anchors: DestinationAnchor[],
  ): DestinationAnchor[] {
    const seen = new Set<string>();
    return anchors.filter((anchor) => {
      const key = `${anchor.latitude.toFixed(5)}:${anchor.longitude.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
