// Shared vocabulary for composite activities (neighborhood walks, routes,
// experiences), intersected into the 3 existing duplicated Activity type
// definitions (features/activities/types.ts, api/activities.ts, and the
// inline type in api/tours.ts) rather than merging them into one — that
// duplication predates this change and fixing it is out of scope here; the
// goal is to avoid adding a 4th, separate source of truth for the new
// fields on top of it.

// Matches be/prisma/schema.prisma's ActivityKind enum EXACTLY, including
// casing — Prisma serializes enum values as declared (uppercase), not
// lowercased, and this type is compared directly against what the API
// actually returns (never normalized at the boundary).
export type ActivityKind =
  | 'POI'
  | 'NEIGHBORHOOD_WALK'
  | 'ROUTE'
  | 'AREA'
  | 'EXPERIENCE';

// Mirrors be/prisma/schema.prisma's GeoJsonGeometry — only the two shapes
// Activity.boundary ever actually takes (Polygon/MultiPolygon for kind:
// area, LineString for a top-level kind: route). GeoJSON coordinates are
// [lon, lat]; see features/map/geojson.ts for the conversion into this
// app's {latitude, longitude} convention.
export type ActivityBoundary =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
  | { type: 'LineString'; coordinates: [number, number][] };

// One entry of a TourActivity's `waypoints` snapshot (TourActivityWaypoint)
// — the real waypointActivity, frozen at generation time, not the variant's
// current (possibly since-edited) content.
export interface ActivityWaypointRef {
  order: number;
  waypointActivity: {
    id: string;
    name: string;
    latitude?: number;
    longitude?: number;
  };
}

// Intersect this into an existing Activity/ActivityDetail type: `& CompositeActivityFields`.
export interface CompositeActivityFields {
  kind?: ActivityKind;
  variantTheme?: string;
  boundary?: ActivityBoundary;
}

// AREA is excluded too — it's a structural container (the geographic
// boundary a family belongs to), never something a TourActivity should
// itself render as a composite stop.
export function isCompositeKind(kind?: ActivityKind): boolean {
  return !!kind && kind !== 'POI' && kind !== 'AREA';
}
