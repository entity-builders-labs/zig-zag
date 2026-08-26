import axiosInstance from './config/axios';
import {
  CompositeActivityFields,
  NarrativeSource,
} from '../features/activities/composite';

export interface ActivityDetail extends CompositeActivityFields {
  id: string;
  name: string;
  description?: string;
  type?: string;
  duration?: number;
  price?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  formattedAddress?: string;
  rating?: number;
  ratingCount?: number;
  phoneNumber?: string;
  website?: string;
  photos?: any;
  metadata?: {
    narrativeSources?: NarrativeSource[];
    [key: string]: any;
  };
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
