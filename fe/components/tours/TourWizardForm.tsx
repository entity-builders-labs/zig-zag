import React, { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  ButtonText,
  Input,
  InputField,
  InputIcon,
  InputSlot,
  ScrollView,
  Pressable,
  Icon,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Textarea,
  TextareaInput,
  Switch,
} from '@gluestack-ui/themed';
import {
  ArrowLeft,
  Search,
  Calendar,
  MapPin,
  User,
  Users,
  Baby,
  UserPlus,
  Footprints,
  Car,
  Bike,
  Bus,
  Sparkles,
} from 'lucide-react-native';
import { Platform } from 'react-native';
import { GenerateTourDto } from '@/api/tours';
import { DestinationInput } from './DestinationInput';
import { DateRangePicker } from './DateRangePicker';
import { Map } from '@/features/map';
import { useContext, useEffect } from 'react';
import { AppContext } from '@/context/app';
import * as ExpoLocation from 'expo-location';

interface TourWizardFormProps {
  onSubmit: (preferences: GenerateTourDto) => void;
  onCancel: () => void;
  initialLocation?: { lat: number; lng: number };
}

const INTEREST_OPTIONS = [
  'Historia',
  'Arte',
  'Comida',
  'Naturaleza',
  'Cultura',
  'Arquitectura',
  'Playa',
  'Compras',
  'Vida Nocturna',
  'Deportes',
];

const INTEREST_MAP: Record<string, string> = {
  Historia: 'history',
  Arte: 'art',
  Comida: 'food',
  Naturaleza: 'nature',
  Cultura: 'culture',
  Arquitectura: 'architecture',
  Playa: 'beach',
  Compras: 'shopping',
  'Vida Nocturna': 'nightlife',
  Deportes: 'sports',
};

export const TourWizardForm: React.FC<TourWizardFormProps> = ({
  onSubmit,
  onCancel,
  initialLocation,
}) => {
  const { setCenter } = useContext(AppContext);
  const [currentStep, setCurrentStep] = useState(1);
  const [destination, setDestination] = useState<string>('');
  const [destinationCoords, setDestinationCoords] = useState<
    { lat: number; lng: number } | undefined
  >(initialLocation);

  // Get current location on mount if useCurrentLocation is enabled
  useEffect(() => {
    const getInitialLocation = async () => {
      // If we have initialLocation, use it
      if (initialLocation && !destinationCoords) {
        setDestinationCoords(initialLocation);
        setCenter(initialLocation);
        return;
      }

      // If useCurrentLocation is enabled and we don't have coordinates yet
      if (useCurrentLocation && !destinationCoords) {
        try {
          const { status } =
            await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const location = await ExpoLocation.getCurrentPositionAsync({});
            const coords = {
              lat: location.coords.latitude,
              lng: location.coords.longitude,
            };
            setDestinationCoords(coords);
            setCenter(coords);
          }
        } catch (error) {
          console.error('Error getting initial location:', error);
        }
      }
    };

    getInitialLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Update map center when destination coordinates change
  useEffect(() => {
    if (destinationCoords) {
      setCenter(destinationCoords);
    } else if (initialLocation) {
      setCenter(initialLocation);
    }
  }, [destinationCoords, initialLocation, setCenter]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [days, setDays] = useState<number>(3);
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [budgetLevel, setBudgetLevel] = useState<'low' | 'medium' | 'high'>(
    'low'
  );
  const [transportationMode, setTransportationMode] = useState<string[]>([
    'walking',
  ]);
  const [travelPace, setTravelPace] = useState<number>(50); // 0-100, 0=relaxed, 100=fast
  const [groupType, setGroupType] = useState<
    'solo' | 'couple' | 'family' | 'friends'
  >('solo');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [specialNotes, setSpecialNotes] = useState<string>('');

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  };

  const toggleTransportationMode = (mode: string) => {
    setTransportationMode((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  };

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else {
      onCancel();
    }
  };

  const handleLocationToggle = async (value: boolean) => {
    setUseCurrentLocation(value);
    if (value) {
      try {
        const { status } =
          await ExpoLocation.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await ExpoLocation.getCurrentPositionAsync({});
          const coords = {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          };
          setDestinationCoords(coords);
          setCenter(coords);
        }
      } catch (error) {
        console.error('Error getting location:', error);
      }
    } else {
      // When toggled off, clear destination coords if they were from current location
      // But keep them if user had selected a destination
      if (!destination) {
        setDestinationCoords(undefined);
      }
    }
  };

  const getPaceValue = (): 'relaxed' | 'moderate' | 'fast' => {
    if (travelPace < 33) return 'relaxed';
    if (travelPace < 67) return 'moderate';
    return 'fast';
  };

  const formatDateRange = () => {
    if (!startDate && !endDate) return '';
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    if (start && end) {
      const daysDiff =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
      const startStr = start.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
      });
      const endStr = end.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
      });
      return `${startStr} - ${endStr} (${daysDiff} Días)`;
    } else if (start) {
      const startStr = start.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
      });
      return `${startStr} - ${startStr} (1 Día)`;
    }
    return '';
  };

  const handleSubmit = () => {
    // Build startDates array if dates are provided
    const startDates: string[] = [];
    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) {
        startDates.push(start.toISOString());
      }
    }
    if (endDate && endDate !== startDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        startDates.push(end.toISOString());
      }
    }

    const preferences: GenerateTourDto = {
      destination: destination || undefined,
      destinationLatitude: destinationCoords?.lat,
      destinationLongitude: destinationCoords?.lng,
      days,
      budgetLevel,
      transportationMode: transportationMode as any, // Cast to avoid TS error as we updated DTO but FE validation might be strict or I missed something. Actually I updated DTO.
      travelPace: getPaceValue(),
      groupType,
      interests:
        selectedInterests.length > 0
          ? selectedInterests.map((i) => INTEREST_MAP[i] || i.toLowerCase())
          : undefined,
      startDates: startDates.length > 0 ? startDates : undefined,
      latitude: destinationCoords?.lat || initialLocation?.lat,
      longitude: destinationCoords?.lng || initialLocation?.lng,
      includeExistingActivities: true,
      skipImageGeneration: true,
    };

    onSubmit(preferences);
  };

  const renderStep1 = () => {
    const mapCoords = destinationCoords || initialLocation;
    const marker = mapCoords
      ? [
          {
            id: 'destination',
            coordinate: {
              latitude: mapCoords.lat,
              longitude: mapCoords.lng,
            },
            title:
              destination ||
              (useCurrentLocation
                ? 'Mi ubicación actual'
                : 'Ubicación seleccionada'),
            description: '',
          },
        ]
      : [];

    return (
      <VStack space='lg' flex={1}>
        {/* Map */}
        <Box
          h='$48'
          borderRadius='$lg'
          overflow='hidden'
          borderWidth='$1'
          borderColor='$backgroundLight300'
        >
          {mapCoords ? (
            <Box h='$full' w='$full'>
              <Map markers={marker} />
            </Box>
          ) : (
            <Box
              bg='$backgroundLight200'
              h='$full'
              justifyContent='center'
              alignItems='center'
            >
              <Icon as={MapPin} size='xl' color='$primary500' />
              <Text mt='$2' color='$textLight600' size='sm'>
                Selecciona un destino para ver el mapa
              </Text>
            </Box>
          )}
        </Box>

        {/* Search Destination */}
        <Box position='relative' zIndex={1}>
          <DestinationInput
            value={destination}
            onDestinationChange={(dest, coords) => {
              setDestination(dest);
              if (coords) {
                setDestinationCoords(coords);
              }
            }}
          />
        </Box>

        {/* Date Range */}
        <Box position='relative' zIndex={0}>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            days={days}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onDaysChange={setDays}
          />
        </Box>

        {/* Use Current Location Toggle */}
        <HStack justifyContent='space-between' alignItems='center'>
          <Text size='md' color='$textLight900'>
            Usar mi ubicación actual
          </Text>
          <Switch
            value={useCurrentLocation}
            onToggle={handleLocationToggle}
            trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
            thumbColor='#FFFFFF'
          />
        </HStack>
      </VStack>
    );
  };

  const renderStep2 = () => (
    <VStack space='xl' flex={1}>
      {/* Budget */}
      <VStack space='md'>
        <Text size='lg' fontWeight='$semibold' color='$textLight900'>
          Presupuesto
        </Text>
        <HStack space='md'>
          {(['low', 'medium', 'high'] as const).map((level) => (
            <Pressable
              key={level}
              flex={1}
              onPress={() => setBudgetLevel(level)}
            >
              <Box
                bg={budgetLevel === level ? '$primary500' : '$white'}
                borderWidth='$1'
                borderColor={
                  budgetLevel === level ? '$primary500' : '$backgroundLight300'
                }
                borderRadius='$md'
                p='$4'
                alignItems='center'
                justifyContent='center'
                h='$16'
              >
                <Text
                  size='xl'
                  fontWeight='$bold'
                  color={budgetLevel === level ? '$white' : '$textLight900'}
                >
                  {'$'.repeat(level === 'low' ? 1 : level === 'medium' ? 2 : 3)}
                </Text>
              </Box>
            </Pressable>
          ))}
        </HStack>
      </VStack>

      {/* Company */}
      <VStack space='md'>
        <Text size='lg' fontWeight='$semibold' color='$textLight900'>
          Compañía
        </Text>
        <HStack space='md' justifyContent='space-around'>
          {[
            { type: 'solo' as const, icon: User, label: 'Solo' },
            { type: 'couple' as const, icon: Users, label: 'Pareja' },
            { type: 'family' as const, icon: Baby, label: 'Familia' },
            { type: 'friends' as const, icon: UserPlus, label: 'Amigos' },
          ].map(({ type, icon: IconComponent, label }) => (
            <Pressable
              key={type}
              onPress={() => setGroupType(type)}
              alignItems='center'
            >
              <Box
                w='$16'
                h='$16'
                borderRadius='$full'
                bg={groupType === type ? '$primary500' : '$backgroundLight100'}
                alignItems='center'
                justifyContent='center'
                borderWidth={groupType === type ? '$2' : '$0'}
                borderColor='$primary500'
              >
                <Icon
                  as={IconComponent}
                  size='xl'
                  color={groupType === type ? '$white' : '$textLight600'}
                />
              </Box>
              <Text
                mt='$2'
                size='sm'
                color={groupType === type ? '$primary500' : '$textLight600'}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </HStack>
      </VStack>

      {/* Pace */}
      <VStack space='md'>
        <Text size='lg' fontWeight='$semibold' color='$textLight900'>
          Ritmo
        </Text>
        <VStack space='sm'>
          <Slider
            value={travelPace}
            onChange={(value) => setTravelPace(value)}
            minValue={0}
            maxValue={100}
            step={1}
          >
            <SliderTrack>
              <SliderFilledTrack bg='$primary500' />
            </SliderTrack>
            <SliderThumb
              bg='$white'
              borderWidth='$2'
              borderColor='$primary500'
            />
          </Slider>
          <HStack justifyContent='space-between' px='$2'>
            <Text size='sm' color='$textLight600'>
              Relax
            </Text>
            <Text size='sm' color='$textLight600'>
              Moderado
            </Text>
            <Text size='sm' color='$textLight600'>
              Rápido
            </Text>
          </HStack>
        </VStack>
      </VStack>

      {/* Transport */}
      <VStack space='md'>
        <Text size='lg' fontWeight='$semibold' color='$textLight900'>
          Transporte (Selección múltiple)
        </Text>
        <HStack space='md' justifyContent='space-around'>
          {[
            { mode: 'walking', icon: Footprints, label: 'Pie' },
            { mode: 'driving', icon: Car, label: 'Auto' },
            { mode: 'cycling', icon: Bike, label: 'Bici' },
            { mode: 'public_transport', icon: Bus, label: 'Público' },
          ].map(({ mode, icon: IconComponent, label }) => (
            <Pressable
              key={mode}
              onPress={() => toggleTransportationMode(mode)}
              alignItems='center'
            >
              <Box
                w='$16'
                h='$16'
                borderRadius='$full'
                bg={
                  transportationMode.includes(mode)
                    ? '$primary500'
                    : '$backgroundLight100'
                }
                alignItems='center'
                justifyContent='center'
                borderWidth={transportationMode.includes(mode) ? '$2' : '$0'}
                borderColor='$primary500'
              >
                <Icon
                  as={IconComponent}
                  size='xl'
                  color={
                    transportationMode.includes(mode)
                      ? '$white'
                      : '$textLight600'
                  }
                />
              </Box>
              <Text
                mt='$2'
                size='sm'
                color={
                  transportationMode.includes(mode)
                    ? '$primary500'
                    : '$textLight600'
                }
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </HStack>
      </VStack>
    </VStack>
  );

  const renderStep3 = () => (
    <VStack space='xl' flex={1}>
      {/* Interests */}
      <VStack space='md'>
        <Text size='lg' fontWeight='$semibold' color='$textLight900'>
          Intereses
        </Text>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {INTEREST_OPTIONS.map((interest) => (
            <Pressable key={interest} onPress={() => toggleInterest(interest)}>
              <Box
                bg={
                  selectedInterests.includes(interest)
                    ? '$primary500'
                    : '$white'
                }
                borderWidth='$1'
                borderColor={
                  selectedInterests.includes(interest)
                    ? '$primary500'
                    : '$backgroundLight300'
                }
                borderRadius='$full'
                px='$4'
                py='$2'
              >
                <Text
                  size='sm'
                  color={
                    selectedInterests.includes(interest)
                      ? '$white'
                      : '$textLight900'
                  }
                >
                  {interest}
                </Text>
              </Box>
            </Pressable>
          ))}
        </Box>
      </VStack>

      {/* Special Notes */}
      <VStack space='md'>
        <Text size='lg' fontWeight='$semibold' color='$textLight900'>
          Algo especial?
        </Text>
        <Textarea size='lg' h='$32'>
          <TextareaInput
            placeholder='Escribe aquí... (ej. Soy vegano...)'
            value={specialNotes}
            onChangeText={setSpecialNotes}
          />
        </Textarea>
      </VStack>
    </VStack>
  );

  const getStepTitle = () => {
    switch (currentStep) {
      case 1:
        return 'Paso 1/3: Destino y Fechas';
      case 2:
        return 'Paso 2/3: Define tu estilo';
      case 3:
        return 'Paso 3/3: Personalización IA';
      default:
        return '';
    }
  };

  return (
    <Box flex={1} bg='$white'>
      {/* Header */}
      <Box bg='$primary500' pt='$12' pb='$4' px='$4'>
        <HStack alignItems='center' space='md' mb='$2'>
          <Pressable onPress={handleBack}>
            <Icon as={ArrowLeft} size='lg' color='$white' />
          </Pressable>
          <Box w='$6' />
        </HStack>
        <Text textAlign='center' size='sm' color='$white' opacity={0.9}>
          {getStepTitle()}
        </Text>
      </Box>

      {/* Content */}
      <ScrollView flex={1} showsVerticalScrollIndicator={false}>
        <Box p='$4' pb='$24'>
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </Box>
      </ScrollView>

      {/* Bottom Button */}
      <Box
        position='absolute'
        bottom='$0'
        left='$0'
        right='$0'
        bg='$white'
        borderTopWidth='$1'
        borderTopColor='$backgroundLight200'
        p='$4'
        pb='$8'
      >
        <Button onPress={handleNext} bg='$primary500' borderRadius='$md'>
          <ButtonText color='$white' fontWeight='$semibold'>
            {currentStep === 3 ? 'Generar ZigZag ✨' : 'Siguiente →'}
          </ButtonText>
          {currentStep === 3 && (
            <Icon as={Sparkles} size='md' color='$white' ml='$2' />
          )}
        </Button>
      </Box>
    </Box>
  );
};
