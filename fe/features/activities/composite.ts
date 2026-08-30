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
    type?: string;
    formattedAddress?: string;
    photos?: any;
    latitude?: number;
    longitude?: number;
  };
}

// Mirrors be's NarrativeSource (composite-activity.service.ts) — a real
// Wikidata extract tied to one of the variant's waypoints, set only when
// that waypoint's OSM feature had a wikidata QID with safe content. `label`
// is the waypoint's OSM name, not a waypoint id, so this isn't reliably
// matchable back to a specific `ActivityWaypointRef` today — rendered as
// its own section rather than inlined per-waypoint.
export interface NarrativeSource {
  qid: string;
  label?: string;
  extract?: string;
}

// Intersect this into an existing Activity/ActivityDetail type: `& CompositeActivityFields`.
export interface CompositeActivityFields {
  kind?: ActivityKind;
  variantTheme?: string;
  boundary?: ActivityBoundary;
  // Only populated by GET /activities/:id — this variant's own current
  // content (when kind is NEIGHBORHOOD_WALK/ROUTE/EXPERIENCE), not a tour
  // snapshot. For a TourActivity's frozen snapshot, use the inline
  // `waypoints` array on TourActivity instead.
  waypoints?: ActivityWaypointRef[];
}
