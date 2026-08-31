import React, { useContext, useEffect, useState } from 'react';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Icon,
  Pressable,
  ScrollView,
  Switch,
  Text,
  VStack
} from '@gluestack-ui/themed';
import { ArrowLeft, MapPin, Sparkles } from 'lucide-react-native';
import * as ExpoLocation from 'expo-location';
import { GenerateTourDto } from '@/api/tours';
import {
  BudgetLevel,
  DestinationScaleHint,
  ExperienceFormat,
  ExplorationStyle,
  GroupType,
  TransportationMode,
  WALKING_EFFORT_PRESETS,
  WalkingEffortProfile
} from '@/features/tours/tour-generation-contract';
import { Map } from '@/features/map';
import { AppContext } from '@/context/app';
import { FONT_DISPLAY } from '@/constants/typography';
import { DEFAULT_LOCATION } from '@/api/config/constants';
import { DateRangePicker } from './DateRangePicker';
import { DestinationInput } from './DestinationInput';
import { TourWizardIntentStep } from './TourWizardIntentStep';
import { TourWizardMobilityStep } from './TourWizardMobilityStep';

interface TourWizardFormProps {
  onSubmit: (preferences: GenerateTourDto) => void;
  onCancel: () => void;
  isLoading?: boolean;
  initialDestination?: string;
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
  'Deportes'
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
  Deportes: 'sports'
};

export const TourWizardForm: React.FC<TourWizardFormProps> = ({
  onSubmit,
  onCancel,
  isLoading,
  initialDestination,
  initialLocation
}) => {
  const { setCenter } = useContext(AppContext);
  const [currentStep, setCurrentStep] = useState(1);
  const [destination, setDestination] = useState(initialDestination || '');
  const [destinationCoords, setDestinationCoords] = useState<
    { lat: number; lng: number } | undefined
  >(initialLocation);
  const [destinationRadius, setDestinationRadius] = useState<number>();
  const [destinationScaleHint, setDestinationScaleHint] =
    useState<DestinationScaleHint>('specific_point');
  const [destinationIsDirty, setDestinationIsDirty] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [days, setDays] = useState(3);
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>('low');
  const [transportationModes, setTransportationModes] = useState<
    TransportationMode[]
  >(['walking']);
  const [travelPace, setTravelPace] = useState(50);
  const [groupType, setGroupType] = useState<GroupType>('solo');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [experienceFormats, setExperienceFormats] = useState<
    ExperienceFormat[]
  >(['point_visits', 'neighborhood_walks']);
  const [explorationStyle, setExplorationStyle] =
    useState<ExplorationStyle>('balanced');
  const [walkingEffortProfile, setWalkingEffortProfile] =
    useState<WalkingEffortProfile>('moderate');
  const [maxWalkingDistancePerDayMeters, setMaxWalkingDistancePerDayMeters] =
    useState(WALKING_EFFORT_PRESETS.moderate.dailyMeters);
  const [
    maxContinuousWalkingDistanceMeters,
    setMaxContinuousWalkingDistanceMeters
  ] = useState(WALKING_EFFORT_PRESETS.moderate.continuousMeters);
  const [accessibilityNeeds, setAccessibilityNeeds] = useState<string[]>([]);
  const [additionalPreferences, setAdditionalPreferences] = useState('');

  useEffect(() => {
    const getInitialLocation = async () => {
      if (initialLocation && !destinationCoords) {
        setDestinationCoords(initialLocation);
        setCenter(initialLocation);
        return;
      }

      if (useCurrentLocation && !destinationCoords) {
        try {
          const { status } =
            await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const location = await ExpoLocation.getCurrentPositionAsync({});
            const coords = {
              lat: location.coords.latitude,
              lng: location.coords.longitude
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
    // This is intentionally mount-only: changing the toggle has its own handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (destinationCoords) setCenter(destinationCoords);
    else if (initialLocation) setCenter(initialLocation);
  }, [destinationCoords, initialLocation, setCenter]);

  const toggleInterest = (interest: string) => {
    setSelectedInterests((current) =>
      current.includes(interest)
        ? current.filter((value) => value !== interest)
        : [...current, interest]
    );
  };

  const toggleTransportationMode = (mode: TransportationMode) => {
    setTransportationModes((current) => {
      if (current.includes(mode)) {
        return current.length === 1
          ? current
          : current.filter((value) => value !== mode);
      }
      return [...current, mode];
    });
  };

  const toggleExperienceFormat = (format: ExperienceFormat) => {
    setExperienceFormats((current) => {
      if (current.includes(format)) {
        return current.length === 1
          ? current
          : current.filter((value) => value !== format);
      }
      return [...current, format];
    });
  };

  const toggleAccessibilityNeed = (need: string) => {
    setAccessibilityNeeds((current) =>
      current.includes(need)
        ? current.filter((value) => value !== need)
        : [...current, need]
    );
  };

  const selectWalkingEffortProfile = (profile: WalkingEffortProfile) => {
    setWalkingEffortProfile(profile);
    if (profile !== 'custom') {
      const preset = WALKING_EFFORT_PRESETS[profile];
      setMaxWalkingDistancePerDayMeters(preset.dailyMeters);
      setMaxContinuousWalkingDistanceMeters(preset.continuousMeters);
    }
  };

  const handleMaxWalkingDistancePerDayChange = (value: number) => {
    setMaxWalkingDistancePerDayMeters(value);
    setMaxContinuousWalkingDistanceMeters((current) =>
      Math.min(current, value)
    );
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
            lng: location.coords.longitude
          };
          setDestinationCoords(coords);
          setCenter(coords);
        }
      } catch (error) {
        console.error('Error getting location:', error);
      }
      return;
    }

    if (!destination) setDestinationCoords(undefined);
  };

  const getPaceValue = (): 'relaxed' | 'moderate' | 'fast' => {
    if (travelPace < 33) return 'relaxed';
    if (travelPace < 67) return 'moderate';
    return 'fast';
  };

  const handleSubmit = () => {
    const startDates: string[] = [];
    for (const value of [startDate, endDate !== startDate ? endDate : '']) {
      if (!value) continue;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) startDates.push(date.toISOString());
    }

    const latitude =
      destinationCoords?.lat ??
      initialLocation?.lat ??
      DEFAULT_LOCATION.LATITUDE;
    const longitude =
      destinationCoords?.lng ??
      initialLocation?.lng ??
      DEFAULT_LOCATION.LONGITUDE;

    onSubmit({
      destination: {
        label: destination || undefined,
        latitude,
        longitude,
        radiusMeters: destinationRadius,
        scaleHint: destinationScaleHint
      },
      days,
      budgetLevel,
      groupType,
      intent: {
        interests: selectedInterests.map(
          (interest) => INTEREST_MAP[interest] || interest.toLowerCase()
        ),
        experienceFormats,
        explorationStyle,
        additionalPreferences: additionalPreferences.trim() || undefined
      },
      mobility: {
        allowedTransportationModes: transportationModes,
        maxWalkingDistancePerDayMeters,
        maxContinuousWalkingDistanceMeters,
        travelPace: getPaceValue(),
        accessibilityNeeds
      },
      startDates: startDates.length > 0 ? startDates : undefined,
      includeExistingActivities: true,
      skipImageGeneration: true
    });
  };

  const handleNext = () => {
    if (currentStep === 1 && destinationIsDirty) return;
    if (currentStep < 3) setCurrentStep((step) => step + 1);
    else handleSubmit();
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep((step) => step - 1);
    else onCancel();
  };

  const renderDestinationStep = () => {
    const mapCoords = destinationCoords || initialLocation;
    const marker = mapCoords
      ? [
          {
            id: 'destination',
            coordinate: {
              latitude: mapCoords.lat,
              longitude: mapCoords.lng
            },
            title:
              destination ||
              (useCurrentLocation
                ? 'Mi ubicación actual'
                : 'Ubicación seleccionada'),
            description: ''
          }
        ]
      : [];

    return (
      <VStack space='lg' flex={1}>
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

        <Box position='relative' zIndex={1}>
          <DestinationInput
            value={destination}
            onDestinationChange={(label, coords, radiusMeters, scaleHint) => {
              setDestination(label);
              if (coords) setDestinationCoords(coords);
              setDestinationRadius(radiusMeters);
              setDestinationScaleHint(scaleHint ?? 'specific_point');
            }}
            onDirtyChange={setDestinationIsDirty}
          />
          {destinationIsDirty && (
            <Text color='$error600' size='sm' mt='$1'>
              Elegí una opción de la lista para confirmar el destino
            </Text>
          )}
        </Box>

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

        <HStack justifyContent='space-between' alignItems='center'>
          <Text size='md' color='$textLight900'>
            Usar mi ubicación actual
          </Text>
          <Switch
            value={useCurrentLocation}
            onToggle={handleLocationToggle}
            trackColor={{ false: '#E3DDCC', true: '#C89B3C' }}
            thumbColor='#FFFFFF'
          />
        </HStack>
      </VStack>
    );
  };

  const stepName =
    currentStep === 1
      ? 'Destino y Fechas'
      : currentStep === 2
        ? 'Movilidad y Ritmo'
        : 'Intereses y Estilo';

  const getCtaText = () => {
    if (currentStep === 1) return 'Siguiente: Movilidad & Ritmo →';
    if (currentStep === 2) return 'Siguiente: Intereses & Estilo →';
    return 'Generar Zig-Zag ✨';
  };

  return (
    <Box flex={1} bg='$backgroundLight50'>
      {/* Wizard Header with Progress Bar */}
      <Box bg='$backgroundLight50' pt='$12' pb='$3' px='$4' borderBottomWidth={1} borderBottomColor='$borderLight100'>
        <HStack alignItems='center' justifyContent='space-between'>
          <HStack alignItems='center' space='md'>
            <Pressable onPress={handleBack}>
              <Box
                w='$8'
                h='$8'
                borderRadius='$full'
                bg='$backgroundLight100'
                alignItems='center'
                justifyContent='center'
                borderWidth={1}
                borderColor='$borderLight200'
              >
                <Icon as={ArrowLeft} size='sm' color='$textLight800' />
              </Box>
            </Pressable>
            <VStack>
              <Text
                size='2xs'
                fontWeight='$bold'
                color='$primary600'
                textTransform='uppercase'
                letterSpacing={1}
              >
                Paso {currentStep} de 3
              </Text>
              <Heading
                size='md'
                color='$textLight900'
                style={{ fontFamily: FONT_DISPLAY }}
              >
                {stepName}
              </Heading>
            </VStack>
          </HStack>

          {/* 3-Segment Progress Bar */}
          <HStack space='xs' w='$20'>
            {[1, 2, 3].map((step) => (
              <Box
                key={step}
                flex={1}
                h='$1.5'
                borderRadius='$full'
                bg={step <= currentStep ? '$primary500' : '$backgroundLight200'}
              />
            ))}
          </HStack>
        </HStack>
      </Box>

      <ScrollView flex={1} showsVerticalScrollIndicator={false}>
        <Box p='$4' pb='$24'>
          {currentStep === 1 && renderDestinationStep()}
          {currentStep === 2 && (
            <TourWizardMobilityStep
              budgetLevel={budgetLevel}
              groupType={groupType}
              travelPace={travelPace}
              transportationModes={transportationModes}
              walkingEffortProfile={walkingEffortProfile}
              maxWalkingDistancePerDayMeters={maxWalkingDistancePerDayMeters}
              maxContinuousWalkingDistanceMeters={
                maxContinuousWalkingDistanceMeters
              }
              accessibilityNeeds={accessibilityNeeds}
              onBudgetLevelChange={setBudgetLevel}
              onGroupTypeChange={setGroupType}
              onTravelPaceChange={setTravelPace}
              onTransportationModeToggle={toggleTransportationMode}
              onWalkingEffortProfileChange={selectWalkingEffortProfile}
              onMaxWalkingDistancePerDayChange={
                handleMaxWalkingDistancePerDayChange
              }
              onMaxContinuousWalkingDistanceChange={
                setMaxContinuousWalkingDistanceMeters
              }
              onAccessibilityNeedToggle={toggleAccessibilityNeed}
            />
          )}
          {currentStep === 3 && (
            <TourWizardIntentStep
              interestOptions={INTEREST_OPTIONS}
              selectedInterests={selectedInterests}
              experienceFormats={experienceFormats}
              explorationStyle={explorationStyle}
              additionalPreferences={additionalPreferences}
              onInterestToggle={toggleInterest}
              onExperienceFormatToggle={toggleExperienceFormat}
              onExplorationStyleChange={setExplorationStyle}
              onAdditionalPreferencesChange={setAdditionalPreferences}
            />
          )}
        </Box>
      </ScrollView>

      {/* Floating Bottom CTA */}
      <Box
        position='absolute'
        bottom='$0'
        left='$0'
        right='$0'
        bg='$backgroundLight50'
        borderTopWidth='$1'
        borderTopColor='$borderLight100'
        p='$4'
        pb='$8'
        shadowColor='$black'
        shadowOffset={{ width: 0, height: -2 }}
        shadowOpacity={0.06}
        shadowRadius={4}
        elevation={4}
      >
        <Button
          testID='wizard-cta-button'
          onPress={handleNext}
          bg='$primary500'
          borderRadius='$xl'
          py='$3.5'
          isDisabled={currentStep === 1 && destinationIsDirty}
          shadowColor='$primary500'
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.3}
          shadowRadius={4}
          elevation={3}
        >
          <ButtonText
            color='$secondary950'
            fontWeight='$bold'
            size='md'
            style={{ fontFamily: FONT_DISPLAY }}
          >
            {getCtaText()}
          </ButtonText>
          {currentStep === 3 && (
            <Icon as={Sparkles} size='sm' color='$secondary950' ml='$2' />
          )}
        </Button>
      </Box>
    </Box>
  );
};

