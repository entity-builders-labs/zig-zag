import { useEffect, useState } from 'react';
import axiosInstance from '../../api/config/axios';
import { Activity, PaginatedResponseActivity } from './types';
import { useApi } from '../../api/hooks/useApi';
import { useAddress } from '../../context/address-context';

export const useActivities = () => {
  const [currentActivityIndex, setCurrentActivityIndex] = useState<number>(0);
  const { addressCoordinates } = useAddress();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [radius, setRadius] = useState<number>(50000);
  const [limit, setLimit] = useState<number>(100);

  const getActivities = async () => {
    if (!addressCoordinates?.lat || !addressCoordinates?.lng) {
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
        `/activities?latitude=${addressCoordinates?.lat}&longitude=${addressCoordinates?.lng}`
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
    if (!activitiesLoading && !activities.length && addressCoordinates) {
      getActivities();
    }
  }, [addressCoordinates]);

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
