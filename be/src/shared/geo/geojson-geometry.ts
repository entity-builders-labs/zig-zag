/** Provider-neutral GeoJSON geometry used by canonical geographic contracts. */
export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Point'; coordinates: [number, number] };
