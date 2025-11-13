import { createContext, useContext, useEffect, useState } from 'react';
import { Address } from '../types/address';
import { BottomSheetContext } from '../components/ui/bottom-sheet';
import { ApiError, ApiResponse, useApi } from '../api/hooks/useApi';
import { PaginatedResponseActivity } from '../components/types';
import axiosInstance from '../api/config/axios';
import { Activity } from '../features/activities/types';

export type AppContextType = {
  center: { lat: number; lng: number };
  setCenter: (center: { lat: number; lng: number }) => void;
  address: Address | null;
  setAddress: (address: Address | null) => void;
  activities: Activity[];
  activitiesData: PaginatedResponseActivity | null;
  activitiesError: ApiError | null;
  activitiesLoading: boolean;
  getActivities: (coordinatesProps?: {
    lat?: number;
    lng?: number;
    radius?: number;
    limit?: number;
    forceRefresh?: boolean;
    types?: string[];
  }) => Promise<ApiResponse<PaginatedResponseActivity>>;
  selectedRadiusMeters: number;
  setSelectedRadiusMeters: (meters: number) => void;
};

const AppContext = createContext<AppContextType>({
  center: { lat: 0, lng: 0 },
  setCenter: (center: { lat: number; lng: number }) => {},
  address: null,
  setAddress: (address: Address | null) => {},
  activities: [],
  activitiesData: null,
  activitiesError: null,
  activitiesLoading: false,
  getActivities: () =>
    Promise.resolve({
      data: null,
      success: false,
      error: {
        message: 'No address coordinates',
      },
    }),
  selectedRadiusMeters: 3000,
  setSelectedRadiusMeters: (_m: number) => {},
});

// Buenos aires coordinates
const defaultCenter = {
  lat: -34.603722,
  lng: -58.381592,
};

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [center, setCenter] = useState(defaultCenter);
  const [address, setAddress] = useState<Address | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesError, setActivitiesError] = useState<ApiError | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState<boolean>(false);
  const [selectedRadiusMeters, setSelectedRadiusMeters] = useState<number>(
    Number(process.env.EXPO_PUBLIC_DEFAULT_RADIUS_METERS ?? 3000)
  );

  const getActivities = async (coordinatesProps?: {
    lat?: number;
    lng?: number;
    radius?: number;
    limit?: number;
    forceRefresh?: boolean;
    types?: string[];
  }): Promise<ApiResponse<PaginatedResponseActivity>> => {
    setActivitiesLoading(true);
    try {
      const coordinates = coordinatesProps || address || center;

      if (
        !coordinates ||
        typeof coordinates.lat !== 'number' ||
        typeof coordinates.lng !== 'number'
      ) {
        console.log('$$$ Invalid coordinates:', coordinates);
        setActivitiesError({ message: 'Invalid coordinates' });
        return {
          data: null,
          success: false,
          error: { message: 'Invalid coordinates' },
        };
      }

      console.log('$$$ getActivities:', coordinates);
      const response = await axiosInstance.post<PaginatedResponseActivity>(
        '/activities/search-hybrid',
        {
          latitude: coordinates.lat,
          longitude: coordinates.lng,
          // radius in meters
          radius: coordinatesProps?.radius ?? selectedRadiusMeters,
          limit: coordinatesProps?.limit || 100,
          forceRefresh: coordinatesProps?.forceRefresh || false,
          types: coordinatesProps?.types || undefined,
        }
      );

      console.log('$$$ response:', response.data);

      // El endpoint search-hybrid retorna un objeto con estructura diferente
      // { activities: Activity[], fromCache: boolean, crawlingTriggered: boolean, message: string }
      const activitiesData = response.data.activities;
      console.log('$$$ activitiesData:', activitiesData);
      setActivities(activitiesData);
      setActivitiesError(null);
      return {
        data: response.data,
        success: true,
        error: undefined,
      };
    } catch (error) {
      console.log('$$$ getActivities error:', error);
      setActivitiesError(error as ApiError);
      return {
        data: null,
        success: false,
        error: error as ApiError,
      };
    } finally {
      setActivitiesLoading(false);
    }
  };

  // No dispares búsquedas automáticas; el user debe elegir dirección primero
  const { data, error, loading } = useApi(getActivities, false, [address]);

  // Cuando cambia la dirección, no busques automáticamente; deja que el user pulse el botón

  return (
    <AppContext.Provider
      value={{
        center,
        setCenter,
        address,
        setAddress,
        activities,
        activitiesData: data,
        activitiesError: error,
        activitiesLoading: loading || activitiesLoading,
        getActivities,
        selectedRadiusMeters,
        setSelectedRadiusMeters,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useMap = () => {
  const { center, setCenter } = useContext(AppContext);

  const handleCenterChange = (center: { lat: number; lng: number }) => {
    setCenter(center);
  };

  return { center, handleCenterChange };
};

export const useAddress = () => {
  const { address, setAddress, getActivities } = useContext(AppContext);
  const { handleCenterChange } = useMap();
  const { handleOpen } = useContext(BottomSheetContext);
  const handleAddressChange = (address: Address | null) => {
    setAddress(address);
    if (address) {
      handleCenterChange({ lat: address.lat, lng: address.lng });
    }
  };

  return { address, setAddress: handleAddressChange };
};

export const useActivities = () => {
  const {
    activities,
    activitiesData,
    activitiesError,
    activitiesLoading,
    getActivities,
  } = useContext(AppContext);

  return {
    activities,
    activitiesData,
    activitiesError,
    activitiesLoading,
    getActivities,
  };
};

export const useSearchRadius = () => {
  const { selectedRadiusMeters, setSelectedRadiusMeters } = useContext(AppContext);
  return {
    radiusMeters: selectedRadiusMeters,
    setRadiusMeters: setSelectedRadiusMeters,
  };
};
