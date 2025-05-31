import { View } from '@gluestack-ui/themed';
import {
  AutocompleteDropdown,
  AutocompleteDropdownItem,
} from 'react-native-autocomplete-dropdown';
import { useAddress } from '../context/app';
import { useGoogleAutocomplete } from '@appandflow/react-native-google-autocomplete';

// Custom function to fetch place details
const fetchPlaceDetails = async (
  placeId: string,
  apiKey: string,
  proxyUrl?: string
) => {
  try {
    const baseUrl = proxyUrl || 'https://maps.googleapis.com/maps/api';
    const url = `${baseUrl}/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}&fields=geometry,formatted_address,address_components`;

    console.log('Fetching place details from:', url); // Debug log

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK') {
      return data.result;
    } else {
      throw new Error(`Google Places API error: ${data.status}`);
    }
  } catch (error) {
    console.error('Error fetching place details:', error);
    throw error;
  }
};

export const SearchByAddressInput = () => {
  const { setAddress } = useAddress();

  const { locationResults, setTerm, clearSearch, term } = useGoogleAutocomplete(
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    {
      language: 'es',
      debounce: 300,
      proxyUrl: 'http://localhost:8080/proxy/',
    }
  );

  const handleOnSelectItem = async (item: AutocompleteDropdownItem | null) => {
    if (item === null) {
      setAddress(null);
      return;
    }

    const locationId = locationResults.find(
      (el) => el.place_id === item.id
    )?.place_id;

    if (locationId) {
      try {
        const details = await fetchPlaceDetails(
          locationId,
          process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY!,
          'http://localhost:8080/proxy'
        );

        setAddress({
          lat: details.geometry.location.lat,
          lng: details.geometry.location.lng,
          street: details.formatted_address,
          city:
            details.address_components?.find(
              (component: any) =>
                component.types.includes('locality') ||
                component.types.includes('administrative_area_level_1')
            )?.long_name || '',
          country:
            details.address_components?.find((component: any) =>
              component.types.includes('country')
            )?.long_name || '',
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
      <AutocompleteDropdown
        dataSet={locationResults.map((el) => ({
          id: el.place_id,
          title: el.structured_formatting.main_text,
        }))}
        onChangeText={setTerm}
        onClear={clearSearch}
        onSelectItem={handleOnSelectItem}
        textInputProps={{
          placeholder: 'Search by address',
        }}
      />
    </View>
  );
};
