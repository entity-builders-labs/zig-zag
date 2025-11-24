import { useContext, useEffect, useState } from 'react';
import axiosInstance from '../../api/config/axios';
import { Activity, PaginatedResponseActivity } from './types';
import { useApi } from '../../api/hooks/useApi';
import { AppContext, useAddress, useMap } from '../../context/app';

export const useActivities = () => {
  const [currentActivityIndex, setCurrentActivityIndex] = useState<number>(0);
  const { address, center } = useContext(AppContext);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [radius, setRadius] = useState<number>(50000);
  const [limit, setLimit] = useState<number>(100);
  const location = address || center;

  const getActivities = async () => {
    if (!address?.lat || !address?.lng) {
      return {
        data: null,
        success: false,
        error: {
          message: 'No address coordinates',
        },
      };
    }

    try {
      const activitiesResponse = (await axiosInstance.get(
        `/activities/all?latitude=${address?.lat}&longitude=${address?.lng}`
      )) as PaginatedResponseActivity;
      if (activitiesResponse.length > 0) {
        setActivities(activitiesResponse);
        return {
          data: activitiesResponse,
          success: true,
        };
      }
    } catch (error) {
      return {
        data: null,
        success: false,
        error: {
          message:
            error instanceof Error
              ? error.message
              : 'Failed to fetch activities',
          code: 'API_ERROR',
        },
      };
    }
    // If no return happened above, return a default error
    return {
      data: null,
      success: false,
      error: { message: 'Unknown error' },
    };
  };

  const {
    data: activitiesData,
    error: activitiesError,
    loading: activitiesLoading,
  } = useApi<PaginatedResponseActivity>(getActivities);

  useEffect(() => {
    if (activitiesLoading || activitiesError) {
      return;
    }

    if (activitiesData) {
      setActivities(activitiesData);
    }
  }, [activitiesData]);

  useEffect(() => {
    if (!activitiesLoading && !activities.length && location) {
      getActivities();
    }
  }, [location]);

  return {
    currentActivityIndex,
    activities,
    activitiesData,
    activitiesError,
    activitiesLoading,
    getActivities,
    setCurrentActivityIndex,
    radius,
    setRadius,
    limit,
    setLimit,
  };
};
