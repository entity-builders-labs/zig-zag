
export interface BadgeData {
  text: string;
  action: 'info' | 'success' | 'warning' | 'error' | 'muted';
}

export interface TourStopLocation {
  type: 'location';
  id: string;
  title: string;
  image: string;
  description?: string;
  badges: BadgeData[];
}

// A multi-component Experience snapshot, as opposed to a plain location.
export interface TourStopComposite {
  type: 'composite';
  id: string;
  // Immutable snapshot identity, distinct from the persisted Experience id.
  experienceSnapshotId: string;
  title: string;
  themeReasoning?: string;
  kind: string;
  boundary?: unknown;
  components: Array<{ order: number | null; component: { id: string; name: string; latitude?: number; longitude?: number } }>;
  badges: BadgeData[];
}

export interface TourStopTransport {
  type: 'transport';
  id: string;
  mode: 'walk' | 'bus';
  label: string;
  duration: string;
}

export interface TourStopDayHeader {
  type: 'day-header';
  id: string;
  dayNumber: number;
  title: string;
}

export type TourStop =
  | TourStopLocation
  | TourStopComposite
  | TourStopTransport
  | TourStopDayHeader;
