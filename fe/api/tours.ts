import axiosInstance from './config/axios';

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
    dayNumber?: number;
    travelTimeToNext?: number;
    distanceToNext?: number;
    notes?: string;
  }[];
  metadata?: any;
  options?: {
    latitude?: number;
    longitude?: number;
    radius?: number;
    includeExistingActivities?: boolean;
  };
}

export interface GenerateTourDto {
  prompt?: string;
  destination?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  latitude?: number;
  longitude?: number;
  radius?: number;
  includeExistingActivities?: boolean;
  days?: number;
  budgetLevel?: 'low' | 'medium' | 'high';
  interests?: string[];
  transportationMode?:
    | 'walking'
    | 'driving'
    | 'public_transport'
    | 'cycling'
    | ('walking' | 'driving' | 'public_transport' | 'cycling')[];
  groupType?: 'solo' | 'couple' | 'family' | 'friends';
  travelPace?: 'relaxed' | 'moderate' | 'fast';
  dietaryRestrictions?: string[];
  startDates?: string[];
  skipImageGeneration?: boolean;
  skipActivities?: boolean;
  excludeTours?: string[];
  categories?: string[];
}

export async function fetchNearbyTours(
  lat: number,
  lng: number,
  category: string = 'walking',
  radius: number = 1000
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

export async function generateTour(dataOrPrompt: string | GenerateTourDto) {
  const payload =
    typeof dataOrPrompt === 'string' ? { prompt: dataOrPrompt } : dataOrPrompt;
  const { data } = await axiosInstance.post<Tour>(
    '/tours/generate-tour',
    payload
  );
  return data;
}
