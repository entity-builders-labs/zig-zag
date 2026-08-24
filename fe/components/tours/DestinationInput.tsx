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
  Icon
} from '@gluestack-ui/themed';
import { Search, MapPin, X } from 'lucide-react-native';
import * as ExpoLocation from 'expo-location';
import {
  PlaceSuggestion,
  searchPlaces,
  resolvePlace
} from '@/features/places-autocomplete';
import { DestinationScaleHint } from '@/features/tours/tour-generation-contract';

interface DestinationInputProps {
  value?: string;
  onDestinationChange: (
    destination: string,
    coordinates?: { lat: number; lng: number },
    // Search radius (meters) derived from the selected place's actual
    // extent — a neighborhood yields a small radius, a whole city a large
    // one — instead of one fixed radius for every kind of destination.
    radiusMeters?: number,
    scaleHint?: DestinationScaleHint
  ) => void;
  // Called whenever the visible text stops matching a resolved selection —
  // true while the user has typed something that hasn't been confirmed by
  // picking a suggestion, so the caller can block submission until resolved.
  onDirtyChange?: (isDirty: boolean) => void;
}

export const DestinationInput: React.FC<DestinationInputProps> = ({
  value,
  onDestinationChange,
  onDirtyChange
}) => {
  const [term, setTerm] = useState(value || '');
  const [locationResults, setLocationResults] = useState<PlaceSuggestion[]>([]);
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
        setLocationResults(await searchPlaces(term));
      } catch (e) {
        console.error('Autocomplete error', e);
        setLocationResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [term]);

  const handleSelectItem = async (item: PlaceSuggestion) => {
    try {
      const details = await resolvePlace(item);
      if (!details) throw new Error('No details returned for place');

      onDestinationChange(
        details.name,
        { lat: details.lat, lng: details.lng },
        details.radiusMeters,
        details.scaleHint
      );
      setTerm(details.name);
      setLocationResults([]);
      setIsFocused(false);
      onDirtyChange?.(false);
    } catch (error) {
      console.error('Failed to fetch place details:', error);
      // No coordinates available — leave the field dirty rather than
      // silently accepting a name with no location behind it.
      setTerm(item.label);
      setLocationResults([]);
      setIsFocused(false);
      onDirtyChange?.(true);
    }
  };

  const handleClear = () => {
    setTerm('');
    setLocationResults([]);
    onDestinationChange('');
    setIsFocused(false);
    onDirtyChange?.(false);
  };

  const showResults =
    isFocused && locationResults.length > 0 && term.length >= 3;

  return (
    <Box position='relative' w='$full' zIndex={showResults ? 1000 : 1}>
      <Input
        variant='outline'
        size='lg'
        borderRadius='$lg'
        borderColor='$borderLight200'
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
              onDirtyChange?.(false);
            } else {
              onDirtyChange?.(true);
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
            opacity: 1
          }}
          pointerEvents='box-none'
        >
          <Box
            style={{
              backgroundColor: '#FFFFFF',
              width: '100%',
              height: '100%'
            }}
            pointerEvents='auto'
          >
            <ScrollView
              nestedScrollEnabled
              style={{
                backgroundColor: '#FFFFFF',
                width: '100%'
              }}
              contentContainerStyle={{
                backgroundColor: '#FFFFFF'
              }}
            >
              <VStack
                p='$2'
                style={{
                  backgroundColor: '#FFFFFF',
                  width: '100%'
                }}
              >
                {locationResults.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => handleSelectItem(item)}
                  >
                    {({ pressed }) => (
                      <Box
                        flexDirection='row'
                        alignItems='center'
                        p='$3'
                        borderRadius='$sm'
                        style={{
                          // Paper tint on press ($secondary0 in fe/config.ts)
                          // — matches the redesign palette instead of a
                          // neutral gray.
                          backgroundColor: pressed ? '#F6F3EA' : '#FFFFFF',
                          width: '100%'
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
                          {item.label}
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
