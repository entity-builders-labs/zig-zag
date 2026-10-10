import { Injectable } from '@nestjs/common';
import { OsmCandidate } from './osm-places.service';
import { geometryContainsPoint } from '../utils/geojson-containment.util';

export type MembershipOutcome =
  | 'inside'
  | 'outside'
  | 'ambiguous'
  | 'unavailable';

export interface OsmMembershipResult {
  outcome: MembershipOutcome;
  /** Boundaries (from the input set) whose geometry contains the point. */
  containing: OsmCandidate[];
  /** Human-readable explanation for non-`inside` outcomes. */
  reason?: string;
}

/**
 * Exact, parent-constrained point-to-area membership over a finite set of
 * already-hydrated boundaries. This is the bounded adapter for containment:
 * it never performs its own Overpass query. The caller resolves the finite
 * candidate set (a proposal's own neighborhood boundaries), and this service
 * answers "which of these authoritative polygons contains the point" using
 * real geometry — never nearest-centroid or name matching.
 *
 * Only Polygon/MultiPolygon geometries are authoritative for containment. A
 * Point/LineString boundary (e.g. an area fetched with `out center`) cannot
 * prove membership, so it is excluded and reported as unavailable rather than
 * guessed.
 */
@Injectable()
export class OsmMembershipService {
  membershipOf(
    latitude: number,
    longitude: number,
    boundaries: OsmCandidate[],
  ): OsmMembershipResult {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        outcome: 'unavailable',
        containing: [],
        reason: 'invalid_point',
      };
    }
    if (boundaries.length === 0) {
      return {
        outcome: 'unavailable',
        containing: [],
        reason: 'no_boundaries',
      };
    }

    const authoritative = boundaries.filter(
      (b) =>
        b.geometry.type === 'Polygon' || b.geometry.type === 'MultiPolygon',
    );
    if (authoritative.length === 0) {
      return {
        outcome: 'unavailable',
        containing: [],
        reason: 'no_authoritative_geometry',
      };
    }

    const containing = authoritative.filter((b) =>
      geometryContainsPoint(b.geometry, longitude, latitude),
    );

    if (containing.length === 1) return { outcome: 'inside', containing };
    if (containing.length > 1) {
      return {
        outcome: 'ambiguous',
        containing,
        reason: 'multiple_containing',
      };
    }
    return { outcome: 'outside', containing: [] };
  }
}
