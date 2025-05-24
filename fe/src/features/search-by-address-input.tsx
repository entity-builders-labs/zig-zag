import { View } from '@gluestack-ui/themed';
import {
  AutocompleteDropdown,
  AutocompleteDropdownItem,
} from 'react-native-autocomplete-dropdown';
import { useAddress } from '../context/app';
import { useGoogleAutocomplete } from '@appandflow/react-native-google-autocomplete';

export const SearchByAddressInput = () => {
  const { setAddress } = useAddress();

  const { locationResults, setTerm, clearSearch, searchDetails, term } =
    useGoogleAutocomplete(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, {
      language: 'es',
      debounce: 300,
      proxyUrl: 'https://corsproxy.io/?',
    });

  const handleOnSelectItem = async (item: AutocompleteDropdownItem | null) => {
    if (item === null) {
      setAddress(null);
      return;
    }
    const locationId = locationResults.find(
      (el) => el.place_id === item.id
    )?.place_id;

    if (locationId) {
      const details = await searchDetails(locationId);
      setAddress({
        lat: details.geometry.location.lat,
        lng: details.geometry.location.lng,
        street: details.formatted_address,
        city: details.address_components[0].long_name,
        country: details.address_components[2].long_name,
      });
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
