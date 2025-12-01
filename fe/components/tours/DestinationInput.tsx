import React, { useState, useEffect } from 'react';
import { View, Text } from '@gluestack-ui/themed';
import {
  AutocompleteDropdown,
  AutocompleteDropdownItem,
} from 'react-native-autocomplete-dropdown';
import * as ExpoLocation from 'expo-location';

interface DestinationInputProps {
  value?: string;
  onDestinationChange: (destination: string, coordinates?: { lat: number; lng: number }) => void;
}

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

export const DestinationInput: React.FC<DestinationInputProps> = ({
  value,
  onDestinationChange,
}) => {
  const [term, setTerm] = useState(value || '');
  const [locationResults, setLocationResults] = useState<
    { place_id: string; structured_formatting: { main_text: string } }[]
  >([]);

  useEffect(() => {
    if (value) {
      setTerm(value);
    }
  }, [value]);

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!term || term.length < 3) {
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
      onDestinationChange('');
      return;
    }

    const locationId = locationResults.find((el) => el.place_id === item.id)?.place_id;

    if (locationId) {
      try {
        const details = await placeDetails(locationId);
        const destinationName = details.formattedAddress || details.displayName?.text || term;
        
        onDestinationChange(destinationName, {
          lat: details.location.latitude,
          lng: details.location.longitude,
        });
        setTerm(destinationName);
      } catch (error) {
        console.error('Failed to fetch place details:', error);
        // Fallback: use the selected text
        onDestinationChange(item.title || term);
      }
    } else {
      // Fallback: use the selected text
      onDestinationChange(item.title || term);
    }
  };

  return (
    <View>
      <AutocompleteDropdown
        dataSet={locationResults.map((el) => ({
          id: el.place_id,
          title: el.structured_formatting.main_text,
        }))}
        onChangeText={(text) => {
          setTerm(text);
          if (!text) {
            onDestinationChange('');
          }
        }}
        onClear={() => {
          setTerm('');
          setLocationResults([]);
          onDestinationChange('');
        }}
        onSelectItem={handleOnSelectItem}
        textInputProps={{
          placeholder: 'Buscar destino...',
          value: term,
        }}
      />
    </View>
  );
};

