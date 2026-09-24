import { OsmRouteSegment } from '@integrations/osm/services/osm-places.service';
import { calculateDistance, Coordinates } from '@shared/utils/distance.utils';

/**
 * Groups the OSM highway ways a targeted ROUTE acquisition returned into
 * real-street candidates. One real street is routinely split into many OSM
 * ways, so several same-name ways must not be reported as ambiguity by
 * themselves; two DISCONNECTED same-name groups, however, are genuinely
 * different candidates and stay separate.
 *
 * Grouping facts, in order of authority:
 *   1. exact equality of the provider's own `name` tag (never similarity);
 *   2. OSM topology: ways sharing a node ref are connected;
 *   3. OPTIONAL, off by default: an explicit endpoint continuity gap
 *      (intersection-scale) for streets whose OSM ways are interrupted
 *      without sharing a node. Characterization knob, not identity policy.
 *
 * Distance to the destination (or to anything else) is never used here, and
 * the representative segment is chosen by its own length, not proximity.
 */

/** Normalized by the OSM adapter (exact name tag, highway class, node refs). */
export type RouteSegment = Pick<
  OsmRouteSegment,
  'osmId' | 'name' | 'highway' | 'nodes' | 'geometry'
>;

export interface RouteClusterSegment {
  externalId: string;
  highway: string;
  lengthMeters: number;
  /** A real vertex of the way (its middle one), so it lies on the line. */
  probePoint: Coordinates;
}

export interface RouteCandidateCluster {
  canonicalName: string;
  segmentExternalIds: string[];
  segments: RouteClusterSegment[];
  representativeSegment: RouteClusterSegment;
  geometryFacts: {
    segmentCount: number;
    totalLengthMeters: number;
    highwayTypes: string[];
    bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  };
}

export interface RouteClusteringOptions {
  /** 0 / omitted = pure OSM topology (shared node refs only). */
  continuityGapMeters?: number;
}

const toCoordinates = (p: { lat: number; lon: number }): Coordinates => ({
  latitude: p.lat,
  longitude: p.lon,
});

const distanceMeters = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number => calculateDistance(toCoordinates(a), toCoordinates(b)) * 1000;

function segmentLengthMeters(segment: RouteSegment): number {
  let total = 0;
  for (let i = 1; i < segment.geometry.length; i += 1) {
    total += distanceMeters(segment.geometry[i - 1], segment.geometry[i]);
  }
  return total;
}

function endpoints(segment: RouteSegment) {
  return [segment.geometry[0], segment.geometry[segment.geometry.length - 1]];
}

function toClusterSegment(segment: RouteSegment): RouteClusterSegment {
  const middle = segment.geometry[Math.floor(segment.geometry.length / 2)];
  return {
    externalId: `osm:way:${segment.osmId}`,
    highway: segment.highway,
    lengthMeters: Math.round(segmentLengthMeters(segment)),
    probePoint: toCoordinates(middle),
  };
}

export function clusterRouteSegments(
  input: RouteSegment[],
  options: RouteClusteringOptions = {},
): RouteCandidateCluster[] {
  const gap = options.continuityGapMeters ?? 0;
  // Canonical input order makes union-find (and therefore the output)
  // independent of provider response order.
  const segments = [...input].sort((a, b) => a.osmId - b.osmId);
  const parent = segments.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const nodeOwner = new Map<string, number>();
  segments.forEach((segment, i) => {
    for (const node of segment.nodes) {
      const key = `${segment.name}|${node}`;
      const owner = nodeOwner.get(key);
      if (owner === undefined) nodeOwner.set(key, i);
      else union(owner, i);
    }
  });

  if (gap > 0) {
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        if (segments[i].name !== segments[j].name) continue;
        const bridged = endpoints(segments[i]).some((a) =>
          endpoints(segments[j]).some((b) => distanceMeters(a, b) <= gap),
        );
        if (bridged) union(i, j);
      }
    }
  }

  const groups = new Map<number, RouteSegment[]>();
  segments.forEach((segment, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), segment]);
  });

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, members]) => {
      const clusterSegments = members.map(toClusterSegment);
      const representativeSegment = [...clusterSegments].sort(
        (a, b) =>
          b.lengthMeters - a.lengthMeters ||
          a.externalId.localeCompare(b.externalId),
      )[0];
      const points = members.flatMap((m) => m.geometry);
      return {
        canonicalName: members[0].name,
        segmentExternalIds: clusterSegments.map((s) => s.externalId),
        segments: clusterSegments,
        representativeSegment,
        geometryFacts: {
          segmentCount: members.length,
          totalLengthMeters: clusterSegments.reduce(
            (sum, s) => sum + s.lengthMeters,
            0,
          ),
          highwayTypes: [...new Set(members.map((m) => m.highway))].sort(),
          bbox: {
            minLat: Math.min(...points.map((p) => p.lat)),
            maxLat: Math.max(...points.map((p) => p.lat)),
            minLon: Math.min(...points.map((p) => p.lon)),
            maxLon: Math.max(...points.map((p) => p.lon)),
          },
        },
      };
    });
}
