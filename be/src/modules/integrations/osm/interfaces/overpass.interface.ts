// Overpass QL `out geom` element shapes. Deliberately not a full OSM data
// model — only what queryBoundaryByName/queryContainingBoundary/queryStreets
// need: node/way geometry and relation members with their outer/inner role
// (needed to tell a boundary hole from a disjoint exclave — see
// osm-geometry.util.ts).
export interface OverpassRelationMember {
  type: 'way' | 'node';
  ref: number;
  role: string; // 'outer' | 'inner' | '' (unlabeled members are ignored)
  geometry?: { lat: number; lon: number }[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  // Present on nodes.
  lat?: number;
  lon?: number;
  // Present on ways (a simple point sequence).
  geometry?: { lat: number; lon: number }[];
  // Present on ways fetched with `out body`/`out geom`: the ordered OSM node
  // refs. Two ways sharing a node ref are topologically connected -- the
  // provider-native fact route-segment grouping relies on.
  nodes?: number[];
  // Present on relations.
  members?: OverpassRelationMember[];
  // Present on a way/relation fetched with `out center` instead of
  // `out geom` — a lightweight centroid in place of full polygon geometry.
  // See osm-geometry.util.ts's fallback handling (Task 9).
  center?: { lat: number; lon: number };
}

export interface QueryBoundaryByNameParams {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface QueryContainingBoundaryParams {
  latitude: number;
  longitude: number;
}

export interface QueryStreetsParams {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

// A single, structured OSM tag selector for proactive feature discovery
// (queryFeaturesNear). Deliberately NOT a free-form Overpass QL fragment:
// `key`/`value` are validated token-by-token by the query builder
// (sanitizeOverpassTagToken) so a concept registry entry can never inject
// raw QL. One selector == one `key`(=`value`) tag match, optionally scoped
// to specific element types and/or requiring a `name` tag.
export interface OverpassSelector {
  key: string;
  /** Omitted means "key present with any value". */
  value?: string;
  /** Defaults to all three (`nwr`). */
  elementTypes?: Array<'node' | 'way' | 'relation'>;
  /** Defaults to true — an unnamed feature can't become an identifiable Experience. */
  requireName?: boolean;
}

export interface QueryFeaturesNearParams {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  selectors: OverpassSelector[];
}

// Targeted ROUTE acquisition: every highway way whose `name` tag EXACTLY
// equals `name`, within `radiusMeters` of a destination point. A directed
// provider-side lookup, deliberately not "fetch every street and fuzzy-match
// client-side", and deliberately not scoped through `map_to_area`.
export interface QueryHighwaysByNameParams {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface QueryByIdParams {
  osmType: 'way' | 'relation';
  osmId: number;
}

export interface QueryAdminBoundariesWithinAreaParams extends QueryByIdParams {
  childAdminLevel: number;
}

// Deliberately scoped to two families of queries — not a general Overpass
// client. Point/name-based queries (queryBoundaryByName, queryContainingBoundary,
// queryStreets) support area discovery: queryBoundaryByName is for an area
// already known by name (the generate-templates CLI, Fase 5).
// queryContainingBoundary is for live tour generation (Fase 4), where only a
// point is known, never a name. Area-scoped queries (queryBoundaryById,
// queryAdminBoundariesWithinArea, queryStreetsWithinArea, queryPoisWithinArea)
// operate on an already-known boundary id to explore its administrative
// subdivisions, streets, and POIs.
export interface IOverpassApiService {
  queryBoundaryByName(
    params: QueryBoundaryByNameParams,
  ): Promise<OverpassElement[]>;
  queryContainingBoundary(
    params: QueryContainingBoundaryParams,
  ): Promise<OverpassElement[]>;
  queryBoundaryById(params: QueryByIdParams): Promise<OverpassElement[]>;
  queryAdminBoundariesWithinArea(
    params: QueryAdminBoundariesWithinAreaParams,
  ): Promise<OverpassElement[]>;
  queryPoisWithinArea(params: QueryByIdParams): Promise<OverpassElement[]>;
  queryPois(params: QueryStreetsParams): Promise<OverpassElement[]>;
  // Proactive feature discovery: one bounded `around:` union query built from
  // an explicit, structured selector list (never interpolated concept strings).
  queryFeaturesNear(
    params: QueryFeaturesNearParams,
  ): Promise<OverpassElement[]>;
  // Targeted ROUTE acquisition (see QueryHighwaysByNameParams). `out geom`,
  // so each way carries both its node refs and its geometry.
  queryHighwaysByName(
    params: QueryHighwaysByNameParams,
  ): Promise<OverpassElement[]>;
  // The administrative relations containing a point (`is_in`), tags only --
  // the admin-hierarchy facts destination compatibility is decided from.
  queryContainingAdminBoundaries(
    params: QueryContainingBoundaryParams,
  ): Promise<OverpassElement[]>;
}
