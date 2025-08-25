import { View, Text } from '@gluestack-ui/themed';
import {
  AutocompleteDropdown,
  AutocompleteDropdownItem,
} from 'react-native-autocomplete-dropdown';
import { useAddress } from '../context/app';
import { useEffect, useMemo, useState } from 'react';
import * as ExpoLocation from 'expo-location';

// NEW Places API calls via proxy
async function placesAutocomplete(input: string) {
  const resp = await fetch(
    `${process.env.EXPO_PUBLIC_CORS_PROXY_URL || 'http://localhost:8080'}/gplaces/v1/places:autocomplete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY!,
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
      body: JSON.stringify({ input }),
    }
  );
  if (!resp.ok) throw new Error(`Autocomplete failed: ${resp.status}`);
  return resp.json();
}

async function placeDetails(placeId: string) {
  const resp = await fetch(
    `${process.env.EXPO_PUBLIC_CORS_PROXY_URL || 'http://localhost:8080'}/gplaces/v1/places/${placeId}?fields=id,displayName,formattedAddress,location`,
    {
      headers: {
        'X-Goog-Api-Key': process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY!,
      },
    }
  );
  if (!resp.ok) throw new Error(`Place details failed: ${resp.status}`);
  return resp.json();
}

export const SearchByAddressInput = () => {
  const { setAddress } = useAddress();
  const [term, setTerm] = useState('');
  const [locationResults, setLocationResults] = useState<
    { place_id: string; structured_formatting: { main_text: string } }[]
  >([]);

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!term) {
        setLocationResults([]);
        return;
      }
      try {
        const data = await placesAutocomplete(term);
        const items = (data.suggestions || [])
          .map((s: any) => s.placePrediction)
          .filter(Boolean)
          .map((p: any) => ({
            place_id: p.placeId,
            structured_formatting: { main_text: p.text?.text || '' },
          }));
        setLocationResults(items);
      } catch (e) {
        console.error('Autocomplete error', e);
        setLocationResults([]);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [term]);

  const handleOnSelectItem = async (item: AutocompleteDropdownItem | null) => {
    if (item === null) {
      setAddress(null);
      return;
    }

    const locationId = locationResults.find((el) => el.place_id === item.id)?.place_id;

    if (locationId) {
      try {
        const details = await placeDetails(locationId);

        setAddress({
          lat: details.location.latitude,
          lng: details.location.longitude,
          street: details.formattedAddress || details.displayName?.text || '',
          // New API may not include address components here
          city: '',
          country: '',
        });
      } catch (error) {
        console.error('Failed to fetch place details:', error);
        // Optionally set address with limited info
        setAddress(null);
      }
    }
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontWeight: '600' }}>Dirección</Text>
        <Text
          onPress={async () => {
            try {
              const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
              if (status !== 'granted') return;
              const pos = await ExpoLocation.getCurrentPositionAsync({});
              setAddress({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                street: 'Ubicación actual',
                city: '',
                country: '',
              });
            } catch (e) {
              // ignore
            }
          }}
          style={{ color: '#007AFF' }}
        >
          Usar ubicación actual
        </Text>
      </View>
      <AutocompleteDropdown
        dataSet={locationResults.map((el) => ({
          id: el.place_id,
          title: el.structured_formatting.main_text,
        }))}
        onChangeText={setTerm}
        onClear={() => {
          setTerm('');
          setLocationResults([]);
        }}
        onSelectItem={handleOnSelectItem}
        textInputProps={{
          placeholder: 'Search by address',
        }}
      />
    </View>
  );
};
