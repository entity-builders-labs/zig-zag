import axiosInstance from './config/axios';

export interface Tour {
  id: string;
  name: string;
  description?: string;
  duration?: number;
  activities?: {
    activity: {
      name: string;
      type: string;
      photos?: any;
      latitude?: number;
      longitude?: number;
    };
    order: number;
  }[];
  metadata?: any;
}

export async function fetchNearbyTours(
  lat: number,
  lng: number,
  category: string = 'walking',
  radius: number = 5000
) {
  const { data } = await axiosInstance.get<Tour[]>('/tours/nearby', {
    params: { lat, lng, category, radius },
  });
  return data;
}
