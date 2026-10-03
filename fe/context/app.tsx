import { createContext, useContext, useState } from 'react';
import { Address } from '../types/address';
import { BottomSheetContext } from '../components/ui/bottom-sheet';

export type AppContextType = {
  center: { lat: number; lng: number };
  setCenter: (center: { lat: number; lng: number }) => void;
  address: Address | null;
  setAddress: (address: Address | null) => void;
  selectedRadiusMeters: number;
  setSelectedRadiusMeters: (meters: number) => void;
};

export const AppContext = createContext<AppContextType>({
  center: { lat: 0, lng: 0 },
  setCenter: (center: { lat: number; lng: number }) => {},
  address: null,
  setAddress: (address: Address | null) => {},
  selectedRadiusMeters: 3000,
  setSelectedRadiusMeters: (_m: number) => {},
});

import { DEFAULT_LOCATION } from '../api/config/constants';

// Buenos aires coordinates
const defaultCenter = {
  lat: DEFAULT_LOCATION.LATITUDE,
  lng: DEFAULT_LOCATION.LONGITUDE,
};

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [center, setCenter] = useState<{ lat: number; lng: number }>(defaultCenter);
  const [address, setAddress] = useState<Address | null>(null);
  const [selectedRadiusMeters, setSelectedRadiusMeters] = useState<number>(
    Number(process.env.EXPO_PUBLIC_DEFAULT_RADIUS_METERS ?? 3000)
  );

  return (
    <AppContext.Provider
      value={{
        center,
        setCenter,
        address,
        setAddress,
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
  const { address, setAddress, center } = useContext(AppContext);
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

export const useSearchRadius = () => {
  const { selectedRadiusMeters, setSelectedRadiusMeters } =
    useContext(AppContext);
  return {
    radiusMeters: selectedRadiusMeters,
    setRadiusMeters: setSelectedRadiusMeters,
  };
};
