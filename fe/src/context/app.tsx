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
  getActivities: () => Promise<ApiResponse<PaginatedResponseActivity>>;
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

  const getActivities = async (): Promise<
    ApiResponse<PaginatedResponseActivity>
  > => {
    setActivitiesLoading(true);
    try {
      console.log('$$$ getting activities');
      const coordinates = address || center;
      const response = (await axiosInstance.get(
        `/activities?latitude=${coordinates.lat}&longitude=${coordinates.lng}`
      )) as PaginatedResponseActivity;

      setActivities(response);
      setActivitiesError(null);
      return {
        data: response,
        success: true,
        error: undefined,
      };
    } catch (error) {
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

  const { data, error, loading } = useApi(getActivities, true, [address]);

  useEffect(() => {
    if (center) {
      getActivities();
    }
  }, [address]);

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

  return { center, setCenter: handleCenterChange };
};

export const useAddress = () => {
  const { address, setAddress, getActivities } = useContext(AppContext);
  const { setCenter } = useMap();
  const { handleOpen } = useContext(BottomSheetContext);
  const handleAddressChange = (address: Address | null) => {
    setAddress(address);
    if (address) {
      setCenter({ lat: address.lat, lng: address.lng });
      //  handleOpen();
      getActivities();
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
