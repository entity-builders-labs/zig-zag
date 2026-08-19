export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface Marker {
  id: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  title?: string;
  description?: string;
  order?: number;
}

export interface MapProps {
  markers?: Marker[];
  onRegionChange?: (region: Region) => void;
  focusCoordinate?: {
    latitude: number;
    longitude: number;
  };
  onRefresh?: () => void;
  routes?: {
    coordinates: {
      latitude: number;
      longitude: number;
    }[];
  }[];
  // One entry per polygon "part" (see geoJsonBoundaryToPolygonParts) — a
  // MultiPolygon boundary contributes more than one entry here, each with
  // its own optional holes, rather than needing a separate prop shape.
  polygons?: {
    coordinates: {
      latitude: number;
      longitude: number;
    }[];
    holes?: {
      latitude: number;
      longitude: number;
    }[][];
    strokeColor?: string;
    fillColor?: string;
  }[];
  isStatic?: boolean;
  initialRegion?: Region;
  // Controls pan/zoom/pinch UI independently of isStatic — isStatic still
  // decides whether dragging updates the global search center. Defaults to
  // !isStatic when omitted.
  zoomable?: boolean;
  // Web-only, for E2E: more than one <MapView> can be mounted on the same
  // screen now (the tour header's map, plus one per CompositeStopCard's
  // mini-map) — a bare `window.__zigzagPolylines`/`__zigzagPolygons` would
  // have every instance clobber the same global. Passing a unique
  // `instanceId` routes that instance's exposed data into
  // `window.__zigzagMapInstances[instanceId]` instead, leaving the legacy
  // top-level globals exclusively for the one instance that omits it (the
  // tour header), unchanged for existing e2e specs.
  instanceId?: string;
}
