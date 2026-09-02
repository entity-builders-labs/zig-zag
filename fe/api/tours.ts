import axiosInstance from './config/axios';
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
  /** Canonical V2 tour snapshots. */
  experiences?: TourExperience[];
  metadata?: any;
  options?: {
    latitude?: number;
    longitude?: number;
    radius?: number;
    includeExistingActivities?: boolean;
  };
}

export interface TourExperienceComponent {
  id: string;
  geoEntityId: string;
  order?: number;
  role?: string;
  required: boolean;
  name: string;
  latitude?: number;
  longitude?: number;
  geometry?: unknown;
}

export interface TourExperience {
  id: string;
  experienceId: string;
  dayNumber?: number;
  order: number;
  startTime?: string;
  duration?: number;
  notes?: string;
  components: TourExperienceComponent[];
  experience?: {
    id: string;
    canonicalName?: string;
    name?: string;
    description?: string;
    status?: string;
    mediaUpdatedAt?: string;
    themes?: string[];
    traits?: Array<{ trait: string; value?: string }>;
    components?: Array<{ name: string; role?: string; latitude?: number; longitude?: number }>;
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
export async function generateTour(payload: GenerateTourDto) {
  const { data } = await axiosInstance.post<Tour>(
    '/tours/generate-tour',
    payload
  );
  return data;
}
