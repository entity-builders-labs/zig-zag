import {
  ActivityBoundary,
  ActivityKind,
  ActivityWaypointRef,
} from '../../features/activities/composite';

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

// A multi-stop composite pick (neighborhood_walk/route/experience), as
// opposed to a plain POI (TourStopLocation). `waypoints` is always this
// specific tour stop's TourActivityWaypoint snapshot — frozen at generation
// time, never the variant's current/live ActivityWaypoint content — so the
// card stays stable even if the shared variant is edited/curated later.
export interface TourStopComposite {
  type: 'composite';
  id: string;
  // The TourActivity join row's own id — distinct from `id` (the Activity/
  // variant id, used for the React key). This is what the pre-confirmation
  // review screen's PATCH /tours/:tourId/activities/:tourActivityId/waypoints
  // call targets.
  tourActivityId: string;
  title: string;
  themeReasoning?: string;
  kind: Exclude<ActivityKind, 'POI' | 'AREA'>;
  boundary?: ActivityBoundary;
  waypoints: ActivityWaypointRef[];
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
