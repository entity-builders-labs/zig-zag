import axiosInstance from './config/axios';

export interface ExperienceSearchResult {
  id: string;
  canonicalName: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  themes?: string[];
  qualityScore?: number;
}

export async function fetchNearbyExperiences(params: { latitude: number; longitude: number; radius?: number }) {
  const { data } = await axiosInstance.get<ExperienceSearchResult[]>('/tours/experiences/nearby', {
    params: { lat: params.latitude, lng: params.longitude, radius: params.radius ?? 5000 },
  });
  return data;
}
