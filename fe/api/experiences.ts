import axiosInstance from './config/axios';
import { DocumentaryPhoto } from './tours';

export interface ExperienceSearchResult {
  id: string;
  canonicalName: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  themes?: string[];
  qualityScore?: number;
}

export interface ExperienceComponentDetail {
  geoEntityId: string;
  order?: number | null;
  role?: string | null;
  required?: boolean;
  geoEntity: {
    id: string;
    name: string;
    kind: 'PLACE' | 'AREA' | 'ROUTE';
    latitude?: number | null;
    longitude?: number | null;
    geometry?: unknown;
    address?: string | null;
  };
}

/** Response shape of `GET /tours/experiences/:id` — a real V2 Experience,
 * not the legacy Activity. `photos` is the persisted `ExperienceMedia[]`
 * relation, shape-compatible with `getPhotoGallery`/`getImage`. */
export interface ExperienceDetail {
  id: string;
  name: string;
  canonicalName: string;
  description?: string;
  price?: number;
  qualityScore?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  duration?: number;
  durationMinutes?: number;
  openingHours?: unknown;
  themes?: string[];
  intents?: string[];
  traits?: string[];
  type?: string;
  photos?: DocumentaryPhoto[];
  mediaUpdatedAt?: string;
  components: ExperienceComponentDetail[];
}

export async function fetchNearbyExperiences(params: { latitude: number; longitude: number; radius?: number }) {
  const { data } = await axiosInstance.get<ExperienceSearchResult[]>('/tours/experiences/nearby', {
    params: { lat: params.latitude, lng: params.longitude, radius: params.radius ?? 5000 },
  });
  return data;
}

export async function fetchExperienceById(id: string) {
  const { data } = await axiosInstance.get<ExperienceDetail>(`/tours/experiences/${id}`);
  return data;
}
