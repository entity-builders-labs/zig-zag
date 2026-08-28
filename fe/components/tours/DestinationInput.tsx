import React, { useState, useEffect, useRef } from 'react';
import { Keyboard } from 'react-native';
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
import { PlaceSuggestion, searchPlaces, resolvePlace } from '@/features/places-autocomplete';

interface DestinationInputProps {
  value?: string;
  onDestinationChange: (
    destination: string,
    coordinates?: { lat: number; lng: number },
    radiusMeters?: number
  ) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export const DestinationInput: React.FC<DestinationInputProps> = ({
  value,
  onDestinationChange,
  onDirtyChange,
}) => {
  const [term, setTerm] = useState(value || '');
  const [locationResults, setLocationResults] = useState<PlaceSuggestion[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Track if term change was programmatic (e.g. user selected an item)
  // to prevent re-opening the dropdown after selection
  const skipSearchRef = useRef(false);

  useEffect(() => {
    if (value !== undefined && value !== term) {
      skipSearchRef.current = true;
      setTerm(value);
    }
  }, [value]);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      setLocationResults([]);
      setIsOpen(false);
      return;
    }

    if (!term || term.length < 3) {
      setLocationResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const handler = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await searchPlaces(term);
        setLocationResults(results);
        if (results.length > 0 && isFocused) {
          setIsOpen(true);
        }
      } catch (e) {
        console.error('Autocomplete error', e);
        setLocationResults([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [term, isFocused]);

  const handleSelectItem = async (item: PlaceSuggestion) => {
    skipSearchRef.current = true;
    setIsOpen(false);
    setLocationResults([]);
    setIsFocused(false);
    Keyboard.dismiss();

    try {
      const details = await resolvePlace(item);
      if (!details) throw new Error('No details returned for place');

      setTerm(details.name);
      onDestinationChange(
        details.name,
        { lat: details.lat, lng: details.lng },
        details.radiusMeters
      );
      onDirtyChange?.(false);
    } catch (error) {
      console.error('Failed to fetch place details:', error);
      setTerm(item.label);
      onDirtyChange?.(true);
    }
  };

  const handleClear = () => {
    skipSearchRef.current = true;
    setTerm('');
    setLocationResults([]);
    setIsOpen(false);
    onDestinationChange('');
    setIsFocused(false);
    onDirtyChange?.(false);
  };

  const showDropdown = isOpen && locationResults.length > 0 && term.length >= 3;

  return (
    <Box position='relative' w='$full' zIndex={showDropdown ? 1000 : 1}>
      <Input
        variant='outline'
        size='lg'
        borderRadius='$xl'
        borderColor='$borderLight300'
        bg='$white'
        h={50}
        isFocused={isFocused}
      >
        <InputSlot pl='$3.5'>
          <InputIcon as={Search} size='md' color='$textLight500' />
        </InputSlot>
        <InputField
          placeholder='Ej: Roma, Italia o Barcelona...'
          value={term}
          onChangeText={(text) => {
            skipSearchRef.current = false;
            setTerm(text);
            if (!text) {
              onDestinationChange('');
              setLocationResults([]);
              setIsOpen(false);
              onDirtyChange?.(false);
            } else {
              onDirtyChange?.(true);
            }
          }}
          onFocus={() => {
            setIsFocused(true);
            if (locationResults.length > 0 && term.length >= 3) {
              setIsOpen(true);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          color='$textLight900'
          fontSize='$sm'
        />
        {term.length > 0 && (
          <InputSlot pr='$3'>
            <Pressable onPress={handleClear} hitSlop={10}>
              <InputIcon as={X} size='sm' color='$textLight400' />
            </Pressable>
          </InputSlot>
        )}
      </Input>

      {/* Results Dropdown */}
      {showDropdown && (
        <Box
          position='absolute'
          top={56}
          left={0}
          right={0}
          zIndex={9999}
          borderRadius='$2xl'
          borderWidth={1}
          borderColor='$borderLight200'
          bg='$white'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 6 }}
          shadowOpacity={0.12}
          shadowRadius={16}
          elevation={12}
          maxHeight={260}
          overflow='hidden'
        >
          <ScrollView
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps='always'
            style={{ maxHeight: 260, backgroundColor: '#FFFFFF' }}
            contentContainerStyle={{ padding: 6, backgroundColor: '#FFFFFF' }}
          >
            <VStack space='xs'>
              {locationResults.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handleSelectItem(item)}
                  borderRadius='$xl'
                  p='$3'
                  $hover-bg='$backgroundLight100'
                  $active-bg='$backgroundLight100'
                >
                  {({ pressed }) => (
                    <Box
                      flexDirection='row'
                      alignItems='center'
                      style={{
                        backgroundColor: pressed ? '#FEE2E2' : 'transparent',
                        borderRadius: 12,
                        padding: 4,
                      }}
                    >
                      <Box
                        w={34}
                        h={34}
                        borderRadius='$full'
                        bg='$primary50'
                        alignItems='center'
                        justifyContent='center'
                        mr='$3'
                      >
                        <Icon as={MapPin} size='sm' color='$primary500' />
                      </Box>
                      <Text
                        flex={1}
                        size='sm'
                        color='$textLight900'
                        fontWeight='$semibold'
                        numberOfLines={2}
                      >
                        {item.label}
                      </Text>
                    </Box>
                  )}
                </Pressable>
              ))}
            </VStack>
          </ScrollView>
        </Box>
      )}
    </Box>
  );
};
