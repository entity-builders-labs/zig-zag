import axiosInstance from './config/axios';

export interface Tour {
  id: string;
  name: string;
  description?: string;
  duration?: number;
  price?: number;
  totalDistance?: number;
  activities?: {
    activity?: {
      id: string;
      name: string;
      description?: string;
      type: string;
      photos?: any;
      latitude?: number;
      longitude?: number;
      address?: string;
      price?: number;
    };
    // Inline fields in case activity relation is missing
    activityName?: string;
    activityType?: string;
    activityLatitude?: number;
    activityLongitude?: number;

    order: number;
    travelTimeToNext?: number;
    distanceToNext?: number;
    notes?: string;
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

export async function fetchTourById(id: string) {
  const { data } = await axiosInstance.get<Tour>(`/tours/${id}`);
  return data;
}
