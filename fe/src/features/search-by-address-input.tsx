import { useGoogleAutocomplete } from '@appandflow/react-native-google-autocomplete';
import { View } from '@gluestack-ui/themed';
import {
  AutocompleteDropdown,
  AutocompleteDropdownItem,
} from 'react-native-autocomplete-dropdown';
import { useAddress } from '../context/app';

const GOOGLE_PLACES_API_KEY = 'AIzaSyA9nKk8SB6GVvUZmhAhRCLJzT8iNVgZC48';

export const SearchByAddressInput = () => {
  const { setAddress } = useAddress();

  const { locationResults, setTerm, clearSearch, searchDetails, term } =
    useGoogleAutocomplete(GOOGLE_PLACES_API_KEY, {
      language: 'es',
      debounce: 300,
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
      />
    </View>
  );
};
