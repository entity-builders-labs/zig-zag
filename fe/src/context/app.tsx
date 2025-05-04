import { createContext, useContext, useState } from 'react';
import { Address } from '../types/address';
import { BottomSheetContext } from '../components/ui/bottom-sheet';

export type AppContextType = {
  center: { lat: number; lng: number };
  setCenter: (center: { lat: number; lng: number }) => void;
  address: Address | null;
  setAddress: (address: Address | null) => void;
};

const AppContext = createContext<AppContextType>({
  center: { lat: 0, lng: 0 },
  setCenter: (center: { lat: number; lng: number }) => {},
  address: null,
  setAddress: (address: Address | null) => {},
});

// Buenos aires coordinates
const defaultCenter = {
  lat: -34.603722,
  lng: -58.381592,
};

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [center, setCenter] = useState(defaultCenter);
  const [address, setAddress] = useState<Address | null>(null);

  return (
    <AppContext.Provider
      value={{
        center,
        setCenter,
        address,
        setAddress,
        // ...otros valores
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
  const { address, setAddress } = useContext(AppContext);
  const { setCenter } = useMap();
  const { handleOpen } = useContext(BottomSheetContext);

  const handleAddressChange = (address: Address | null) => {
    setAddress(address);
    if (address) {
      setCenter({ lat: address.lat, lng: address.lng });
      //  handleOpen();
    }
  };

  return { address, setAddress: handleAddressChange };
};
