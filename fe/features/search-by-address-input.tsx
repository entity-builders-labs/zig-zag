import { View, Text } from '@gluestack-ui/themed';
import {
  AutocompleteDropdown,
  AutocompleteDropdownItem,
} from 'react-native-autocomplete-dropdown';
import { useAddress } from '../context/app';
import { useEffect, useState } from 'react';
import * as ExpoLocation from 'expo-location';
import { requestAndGetCurrentLocation } from '../utils/location';
import { PlaceSuggestion, searchPlaces, resolvePlace } from './places-autocomplete';

export const SearchByAddressInput = () => {
  const { setAddress } = useAddress();
  const [term, setTerm] = useState('');
  const [locationResults, setLocationResults] = useState<PlaceSuggestion[]>([]);

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!term) {
        setLocationResults([]);
        return;
      }
      try {
        setLocationResults(await searchPlaces(term));
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

    const suggestion = locationResults.find((el) => el.id === item.id);
    if (!suggestion) return;

    try {
      const details = await resolvePlace(suggestion);
      if (!details) throw new Error('No details returned for place');

      setAddress({
        lat: details.lat,
        lng: details.lng,
        street: details.name,
        // Neither provider's autocomplete/details response used here breaks
        // the address into components — this field is always empty.
        city: '',
        country: '',
      });
    } catch (error) {
      console.error('Failed to fetch place details:', error);
      setAddress(null);
    }
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontWeight: '600' }}>Dirección</Text>
        <Text
          onPress={async () => {
            const coords = await requestAndGetCurrentLocation({ showPromptOnDenial: true });
            if (coords) {
              setAddress({
                lat: coords.lat,
                lng: coords.lng,
                street: 'Ubicación actual',
                city: '',
                country: '',
              });
            }
          }}
          style={{ color: '#007AFF' }}
        >
          Usar ubicación actual
        </Text>
      </View>
      <AutocompleteDropdown
        dataSet={locationResults.map((el) => ({
          id: el.id,
          title: el.label,
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
