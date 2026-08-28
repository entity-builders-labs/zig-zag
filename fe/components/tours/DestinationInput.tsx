import React, { useState, useEffect } from 'react';
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
  Spinner,
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
  const [isLoading, setIsLoading] = useState(false);
  const [confirmedValue, setConfirmedValue] = useState(value || '');

  useEffect(() => {
    if (value !== undefined && value !== confirmedValue) {
      setConfirmedValue(value);
      setTerm(value);
      setLocationResults([]);
    }
  }, [value]);

  useEffect(() => {
    // If term matches what was already selected/confirmed, don't trigger search
    if (term === confirmedValue) {
      setLocationResults([]);
      setIsLoading(false);
      return;
    }

    if (!term || term.trim().length < 3) {
      setLocationResults([]);
      setIsLoading(false);
      return;
    }

    const handler = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await searchPlaces(term.trim());
        setLocationResults(results);
      } catch (e) {
        console.error('Autocomplete error', e);
        setLocationResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(handler);
  }, [term, confirmedValue]);

  const handleSelectItem = async (item: PlaceSuggestion) => {
    Keyboard.dismiss();
    setLocationResults([]);

    try {
      const details = await resolvePlace(item);
      const placeName = details?.name || item.label;
      const coords = details ? { lat: details.lat, lng: details.lng } : undefined;
      const radius = details?.radiusMeters;

      setConfirmedValue(placeName);
      setTerm(placeName);
      onDestinationChange(placeName, coords, radius);
      onDirtyChange?.(false);
    } catch (error) {
      console.error('Failed to resolve place:', error);
      setConfirmedValue(item.label);
      setTerm(item.label);
      onDestinationChange(item.label);
      onDirtyChange?.(true);
    }
  };

  const handleClear = () => {
    setConfirmedValue('');
    setTerm('');
    setLocationResults([]);
    onDestinationChange('');
    onDirtyChange?.(false);
  };

  const showDropdown = locationResults.length > 0 && term !== confirmedValue && term.length >= 3;

  return (
    <Box position='relative' w='$full' zIndex={showDropdown ? 1000 : 1}>
      <Input
        variant='outline'
        size='lg'
        borderRadius='$xl'
        borderColor='$borderLight300'
        bg='$white'
        h={50}
      >
        <InputSlot pl='$3.5'>
          <InputIcon as={Search} size='md' color='$textLight500' />
        </InputSlot>
        <InputField
          placeholder='Ej: Roma, Italia o Barcelona...'
          value={term}
          onChangeText={(text) => {
            setTerm(text);
            if (!text) {
              setConfirmedValue('');
              setLocationResults([]);
              onDestinationChange('');
              onDirtyChange?.(false);
            } else {
              onDirtyChange?.(true);
            }
          }}
          color='$textLight900'
          fontSize='$sm'
        />
        {isLoading ? (
          <InputSlot pr='$3'>
            <Spinner size='small' color='$primary500' />
          </InputSlot>
        ) : term.length > 0 ? (
          <InputSlot pr='$3'>
            <Pressable onPress={handleClear} hitSlop={10}>
              <InputIcon as={X} size='sm' color='$textLight400' />
            </Pressable>
          </InputSlot>
        ) : null}
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
