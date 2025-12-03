import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Input,
  InputField,
  InputIcon,
  InputSlot,
  VStack,
  Pressable,
  Text,
  ScrollView,
  Icon,
} from '@gluestack-ui/themed';
import { Search, MapPin, X } from 'lucide-react-native';
import * as ExpoLocation from 'expo-location';

interface DestinationInputProps {
  value?: string;
  onDestinationChange: (
    destination: string,
    coordinates?: { lat: number; lng: number }
  ) => void;
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
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (value) {
      setTerm(value);
    }
  }, [value]);

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!term || term.length < 3) {
        setLocationResults([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
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
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [term]);

  const handleSelectItem = async (item: {
    place_id: string;
    structured_formatting: { main_text: string };
  }) => {
    try {
      const details = await placeDetails(item.place_id);
      const destinationName =
        details.formattedAddress ||
        details.displayName?.text ||
        item.structured_formatting.main_text;

      onDestinationChange(destinationName, {
        lat: details.location.latitude,
        lng: details.location.longitude,
      });
      setTerm(destinationName);
      setLocationResults([]);
      setIsFocused(false);
    } catch (error) {
      console.error('Failed to fetch place details:', error);
      onDestinationChange(item.structured_formatting.main_text);
      setTerm(item.structured_formatting.main_text);
      setLocationResults([]);
      setIsFocused(false);
    }
  };

  const handleClear = () => {
    setTerm('');
    setLocationResults([]);
    onDestinationChange('');
    setIsFocused(false);
  };

  const showResults =
    isFocused && locationResults.length > 0 && term.length >= 3;

  return (
    <Box position='relative' w='$full' zIndex={showResults ? 1000 : 1}>
      <Input
        variant='outline'
        size='lg'
        isFocused={isFocused}
        isInvalid={false}
      >
        <InputSlot pl='$3'>
          <InputIcon as={Search} size='md' color='$textLight600' />
        </InputSlot>
        <InputField
          placeholder='Buscar destino'
          value={term}
          onChangeText={(text) => {
            setTerm(text);
            if (!text) {
              onDestinationChange('');
              setLocationResults([]);
            }
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            // Delay to allow item selection
            setTimeout(() => setIsFocused(false), 200);
          }}
        />
        {term.length > 0 && (
          <InputSlot pr='$3'>
            <Pressable onPress={handleClear}>
              <InputIcon as={X} size='sm' color='$textLight600' />
            </Pressable>
          </InputSlot>
        )}
      </Input>

      {/* Results Dropdown */}
      {showResults && (
        <Box
          position='absolute'
          top='$12'
          left='$0'
          right='$0'
          zIndex={1001}
          borderRadius='$md'
          borderWidth='$1'
          borderColor='$backgroundLight300'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.1}
          shadowRadius={8}
          elevation={10}
          maxHeight='$64'
          overflow='hidden'
          style={{
            backgroundColor: '#FFFFFF',
            opacity: 1,
          }}
          pointerEvents='box-none'
        >
          <Box
            style={{
              backgroundColor: '#FFFFFF',
              width: '100%',
              height: '100%',
            }}
            pointerEvents='auto'
          >
            <ScrollView
              nestedScrollEnabled
              style={{
                backgroundColor: '#FFFFFF',
                width: '100%',
              }}
              contentContainerStyle={{
                backgroundColor: '#FFFFFF',
              }}
            >
              <VStack
                p='$2'
                style={{
                  backgroundColor: '#FFFFFF',
                  width: '100%',
                }}
              >
                {locationResults.map((item) => (
                  <Pressable
                    key={item.place_id}
                    onPress={() => handleSelectItem(item)}
                  >
                    {({ pressed }) => (
                      <Box
                        flexDirection='row'
                        alignItems='center'
                        p='$3'
                        borderRadius='$sm'
                        style={{
                          backgroundColor: pressed ? '#F3F4F6' : '#FFFFFF',
                          width: '100%',
                        }}
                      >
                        <Box
                          w='$8'
                          h='$8'
                          borderRadius='$full'
                          bg='$primary50'
                          alignItems='center'
                          justifyContent='center'
                          mr='$3'
                        >
                          <Icon as={MapPin} size='sm' color='$primary500' />
                        </Box>
                        <Text flex={1} size='md' color='$textLight900'>
                          {item.structured_formatting.main_text}
                        </Text>
                      </Box>
                    )}
                  </Pressable>
                ))}
              </VStack>
            </ScrollView>
          </Box>
        </Box>
      )}
    </Box>
  );
};
