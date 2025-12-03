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
  isStatic?: boolean;
  initialRegion?: Region;
}
