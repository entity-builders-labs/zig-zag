import { GoogleLocationDetailResult } from '@appandflow/react-native-google-autocomplete';
import { createContext, useContext, useEffect, useState } from 'react';

const AddressContext = createContext<{
  selectedAddress: GoogleLocationDetailResult | null;
  setSelectedAddress: (address: GoogleLocationDetailResult | null) => void;
  addressCoordinates:
    | {
        lat: number;
        lng: number;
      }
    | undefined;
}>({
  selectedAddress: null,
  setSelectedAddress: () => {},
  addressCoordinates: undefined,
});

export const AddressProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [selectedAddress, setSelectedAddress] =
    useState<GoogleLocationDetailResult | null>(null);
  const addressCoordinates = selectedAddress?.geometry?.location;

  return (
    <AddressContext.Provider
      value={{ selectedAddress, setSelectedAddress, addressCoordinates }}
    >
      {children}
    </AddressContext.Provider>
  );
};

export const useAddress = () => useContext(AddressContext);
