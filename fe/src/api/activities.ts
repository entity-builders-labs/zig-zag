import axiosInstance from './config/axios';

export async function fetchSimilarActivities(activityId: string, limit = 10) {
  const { data } = await axiosInstance.get(`/activities/${activityId}/similar`, {
    params: { limit },
  });
  return data;
}
