/** Provider-neutral GeoJSON geometry used by canonical geographic contracts. */
export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
  | { type: 'LineString'; coordinates: [number, number][] }
  /**
   * One real-world linear entity made of several real provider segments
   * (a multi-way OSM street). Lines are never joined across gaps.
   */
  | { type: 'MultiLineString'; coordinates: [number, number][][] }
  | { type: 'Point'; coordinates: [number, number] };
