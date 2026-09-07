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
  dayTotals?: DayTotals[];
  metadata?: any;
  options?: {
    latitude?: number;
    longitude?: number;
    radius?: number;
    includeExistingExperiences?: boolean;
  };
}

export interface TourExperienceComponent {
  id: string;
  geoEntityId: string;
  order?: number | null;
  role?: string;
  required: boolean;
  name: string;
  latitude?: number;
  longitude?: number;
  geometry?: unknown;
}

export interface DocumentaryPhoto {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
  author?: string;
  authorUrl?: string;
  license?: string;
  licenseUrl?: string;
  sourceUrl?: string;
  provider?: 'wikimedia_commons' | 'google_places';
}

export interface MediaPresentation {
  photos: DocumentaryPhoto[];
  primaryPhoto?: {
    url: string;
    caption?: string;
    author?: string;
    license?: string;
    licenseUrl?: string;
    isFallback: boolean;
  };
  source?: 'DOCUMENTARY' | 'CURATED_FALLBACK';
}

export interface TravelFromPrevious {
  mode: 'WALKING' | 'CYCLING' | 'DRIVING' | 'PUBLIC_TRANSPORT';
  durationMinutes: number;
  distanceMeters: number;
  walkingMinutes: number;
  walkingDistanceMeters: number;
  approximate: boolean;
  provider?: string;
  fallbackReason?: string;
}

export interface DayTotals {
  dayNumber: number;
  experienceCount: number;
  totalExperienceMinutes: number;
  totalTravelMinutes: number;
  totalWalkingMinutes: number;
  totalMinutes: number;
}

export interface ExperiencePresentation {
  geometryMode: 'POINT' | 'AREA' | 'ROUTE' | 'MULTI_POINT';
  geometry?: unknown;
  hasIntrinsicSequence: boolean;
}

export interface TourExperience {
  id: string;
  experienceId: string;
  dayNumber?: number;
  order: number;
  startTime?: string;
  duration?: number;
  notes?: string;
  travelFromPrevious?: TravelFromPrevious | null;
  experiencePresentation?: ExperiencePresentation;
  components: TourExperienceComponent[];
  experience?: {
    id: string;
    canonicalName?: string;
    name?: string;
    description?: string;
    status?: string;
    mediaUpdatedAt?: string;
    /** Resolved by the backend on every full tour fetch (real Wikimedia/etc. photos, falling back to a curated static bank only when none exist). */
    mediaPresentation?: MediaPresentation;
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
// tour's Experience snapshot (see the corresponding backend update DTO).
export async function generateTour(payload: GenerateTourDto) {
  const { data } = await axiosInstance.post<Tour>(
    '/tours/generate-tour',
    payload
  );
  return data;
}
