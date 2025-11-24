import { useEffect, useState } from 'react';
import axiosInstance from '../../api/config/axios';
import { PaginatedResponseTour, Tour } from '../../components/types';
import { useApi } from '../../api/hooks/useApi';

export const useTours = (
  addressCoordinates:
    | {
        lat: number;
        lng: number;
      }
    | undefined
) => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalTours, setTotalTours] = useState<number>(0);
  const [currentTourIndex, setCurrentTourIndex] = useState<number>(0);
  const [coordinates, setCoordinates] = useState<{
    latitude: string;
    longitude: string;
  }>({
    latitude: addressCoordinates?.lat.toString() || '-34.6018365',
    longitude: addressCoordinates?.lng.toString() || '-58.4566444',
  });

  const [tours, setTours] = useState<Tour[]>([]);

  const getTours = async () => {
    try {
      const response = (await axiosInstance.get(
        `/tours?page=${currentPage}`
      )) as PaginatedResponseTour;

      if (!response.tours) {
        throw new Error('No data returned from API');
      }

      const { tours, meta } = response;
      setTotalPages(meta?.totalPages || 1);
      setTotalTours(tours.length);
      setTours(tours);
      return {
        data: {
          tours: tours,
          meta: meta,
        },
        success: true,
      };
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
  };

  const {
    data: toursData,
    error: toursError,
    loading: toursLoading,
  } = useApi<PaginatedResponse>(getTours);

  useEffect(() => {
    if (toursData) {
      setTours(toursData.tours);
    }
  }, [toursData]);

  return {
    currentPage,
    totalPages,
    totalTours,
    currentTourIndex,
    tours,
    coordinates,
    toursData,
    toursError,
    toursLoading,
    setCoordinates,
    getTours,
    setCurrentTourIndex,
  };
};
