import axiosInstance from './config/axios';
import { CompositeActivityFields } from '../features/activities/composite';

export interface ActivityDetail extends CompositeActivityFields {
  id: string;
  name: string;
  description?: string;
  type?: string;
  knownActivityTypeName?: string;
  duration?: number;
  price?: number;
  priceLevel?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  formattedAddress?: string;
  rating?: number;
  ratingCount?: number;
  phoneNumber?: string;
  website?: string;
  photos?: any;
  metadata?: any;
  openingHours?: any;
  notes?: string;
}

export async function fetchSimilarActivities(activityId: string, limit = 10) {
  const { data } = await axiosInstance.get(`/activities/${activityId}/similar`, {
    params: { limit },
  });
  return data;
}

export async function fetchActivityById(id: string) {
  const { data } = await axiosInstance.get<ActivityDetail>(`/activities/${id}`);
  return data;
}

export async function fetchAllActivities(params?: {
  latitude?: number;
  longitude?: number;
  radius?: number;
  limit?: number;
  types?: string[];
}) {
  const { data } = await axiosInstance.get<ActivityDetail[]>('/activities/all', {
    params,
  });
  return data;
}

