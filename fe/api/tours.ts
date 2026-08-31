import axiosInstance from './config/axios';
import {
  ActivityWaypointRef,
  CompositeActivityFields
} from '../features/activities/composite';
import { GenerateTourDto } from '../features/tours/tour-generation-contract';

export type { GenerateTourDto } from '../features/tours/tour-generation-contract';

export interface Tour {
  id: string;
  name: string;
  description?: string;
  coverImage?: string;
  duration?: number;
  price?: number;
  totalDistance?: number;
  totalDays?: number;
  categories?: string[];
  activities?: {
    // The TourActivity join row's own id — distinct from `activity.id`
    // (the underlying Activity/variant). Needed to target
    // PATCH /tours/:tourId/activities/:tourActivityId/waypoints.
    id: string;
    activity?: {
      id: string;
      name: string;
      description?: string;
      type: string;
      photos?: any;
      mediaUpdatedAt?: string;
      latitude?: number;
      longitude?: number;
      address?: string;
      price?: number;
    } & CompositeActivityFields;
    // Inline fields in case activity relation is missing
    activityName?: string;
    activityType?: string;
    activityLatitude?: number;
    activityLongitude?: number;

    order: number;
    dayNumber?: number;
    travelTimeToNext?: number;
    distanceToNext?: number;
    notes?: string;

    // Snapshot of which waypoints of a composite `activity` were shown for
    // THIS tour stop (TourActivityWaypoint) — frozen at generation time,
    // not the variant's current/live content. Empty/absent for a plain POI
    // stop.
    waypoints?: ActivityWaypointRef[];
  }[];
  metadata?: any;
  options?: {
    latitude?: number;
    longitude?: number;
    radius?: number;
    includeExistingActivities?: boolean;
  };
}

export interface PaginatedTours {
  tours: Tour[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export async function fetchMyTours(page: number = 1, limit: number = 20) {
  const { data } = await axiosInstance.get<PaginatedTours>('/tours', {
    params: { page, limit }
  });
  return data;
}

export async function fetchNearbyTours(
  lat: number,
  lng: number,
  category: string = 'walking',
  radius: number = 1000
) {
  const { data } = await axiosInstance.get<Tour[]>('/tours/nearby', {
    params: { lat, lng, category, radius }
  });
  return data;
}

export async function fetchTourById(id: string) {
  const { data } = await axiosInstance.get<Tour>(`/tours/${id}`);
  return data;
}

// Rewrites which waypoints of a composite tour stop are shown for THIS tour
// instance — the pre-confirmation review screen's "exclude a stop"
// affordance. Never touches the shared variant's own content, nor any other
// tour's snapshot (see be/.../update-tour-activity-waypoints.dto.ts).
export async function updateTourActivityWaypoints(
  tourId: string,
  tourActivityId: string,
  selectedWaypointActivityIds: string[]
) {
  const { data } = await axiosInstance.patch(
    `/tours/${tourId}/activities/${tourActivityId}/waypoints`,
    { selectedWaypointActivityIds }
  );
  return data;
}

export async function generateTour(payload: GenerateTourDto) {
  const { data } = await axiosInstance.post<Tour>(
    '/tours/generate-tour',
    payload
  );
  return data;
}
