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
  queryStreets(params: QueryStreetsParams): Promise<OverpassElement[]>;
  queryBoundaryById(params: QueryByIdParams): Promise<OverpassElement[]>;
  queryAdminBoundariesWithinArea(
    params: QueryAdminBoundariesWithinAreaParams,
  ): Promise<OverpassElement[]>;
  queryStreetsWithinArea(params: QueryByIdParams): Promise<OverpassElement[]>;
  queryPoisWithinArea(params: QueryByIdParams): Promise<OverpassElement[]>;
}
