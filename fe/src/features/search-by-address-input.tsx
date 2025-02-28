import { useGoogleAutocomplete } from '@appandflow/react-native-google-autocomplete';
import { View } from '@gluestack-ui/themed';
import { useState } from 'react';
import { TextInput, TouchableOpacity, Text } from 'react-native';
import {
  AutocompleteDropdown,
  AutocompleteDropdownItem,
} from 'react-native-autocomplete-dropdown';
import { useAddress } from '../context/address-context';

const GOOGLE_PLACES_API_KEY = 'AIzaSyA9nKk8SB6GVvUZmhAhRCLJzT8iNVgZC48';

export const SearchByAddressInput = () => {
  const { setSelectedAddress } = useAddress();

  const { locationResults, setTerm, clearSearch, searchDetails, term } =
    useGoogleAutocomplete(GOOGLE_PLACES_API_KEY, {
      language: 'es',
      debounce: 300,
    });

  const handleOnSelectItem = async (item: AutocompleteDropdownItem | null) => {
    if (item === null) {
      setSelectedAddress(null);
      return;
    }
    const locationId = locationResults.find(
      (el) => el.place_id === item.id
    )?.place_id;

    if (locationId) {
      const details = await searchDetails(locationId);
      setSelectedAddress(details);
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
