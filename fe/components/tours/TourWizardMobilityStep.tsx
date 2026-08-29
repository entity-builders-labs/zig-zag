import React from 'react';
import {
  Box,
  HStack,
  Icon,
  Pressable,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Text,
  VStack
} from '@gluestack-ui/themed';
import {
  Baby,
  Bike,
  Bus,
  Car,
  Check,
  Footprints,
  User,
  UserPlus,
  Users,
  Accessibility,
  Sliders
} from 'lucide-react-native';
import {
  BudgetLevel,
  GroupType,
  TransportationMode,
  WalkingEffortProfile
} from '@/features/tours/tour-generation-contract';
import { WizardFieldLabel } from './WizardFieldLabel';

interface TourWizardMobilityStepProps {
  budgetLevel: BudgetLevel;
  groupType: GroupType;
  travelPace: number;
  transportationModes: TransportationMode[];
  walkingEffortProfile: WalkingEffortProfile;
  maxWalkingDistancePerDayMeters: number;
  maxContinuousWalkingDistanceMeters: number;
  accessibilityNeeds: string[];
  onBudgetLevelChange: (value: BudgetLevel) => void;
  onGroupTypeChange: (value: GroupType) => void;
  onTravelPaceChange: (value: number) => void;
  onTransportationModeToggle: (value: TransportationMode) => void;
  onWalkingEffortProfileChange: (value: WalkingEffortProfile) => void;
  onMaxWalkingDistancePerDayChange: (value: number) => void;
  onMaxContinuousWalkingDistanceChange: (value: number) => void;
  onAccessibilityNeedToggle: (value: string) => void;
}

const GROUP_OPTIONS = [
  { type: 'solo' as const, icon: User, label: 'Solo' },
  { type: 'couple' as const, icon: Users, label: 'Pareja' },
  { type: 'family' as const, icon: Baby, label: 'Familia' },
  { type: 'friends' as const, icon: UserPlus, label: 'Amigos' }
];

const TRANSPORT_OPTIONS = [
  { mode: 'walking' as const, icon: Footprints, label: 'A Pie' },
  { mode: 'driving' as const, icon: Car, label: 'Auto' },
  { mode: 'cycling' as const, icon: Bike, label: 'Bici' },
  { mode: 'public_transport' as const, icon: Bus, label: 'Bus/Subte' }
];

const WALKING_PROFILES = [
  {
    profile: 'minimize' as const,
    label: 'Mínimo',
    desc: 'Hasta 2 km/día'
  },
  {
    profile: 'moderate' as const,
    label: 'Moderado',
    desc: 'Hasta 4 km/día'
  },
  {
    profile: 'enjoys_walking' as const,
    label: 'Me gusta caminar',
    desc: 'Hasta 6 km/día'
  },
  {
    profile: 'custom' as const,
    label: 'Personalizado',
    desc: 'Ajustar sliders'
  }
];

const ACCESSIBILITY_OPTIONS = [
  { value: 'wheelchair_access', label: '♿ Silla de ruedas' },
  { value: 'avoid_stairs', label: '🚫 Evitar escaleras' },
  { value: 'limited_mobility', label: '🦽 Movilidad reducida' }
];

export function TourWizardMobilityStep({
  budgetLevel,
  groupType,
  travelPace,
  transportationModes,
  walkingEffortProfile,
  maxWalkingDistancePerDayMeters,
  maxContinuousWalkingDistanceMeters,
  accessibilityNeeds,
  onBudgetLevelChange,
  onGroupTypeChange,
  onTravelPaceChange,
  onTransportationModeToggle,
  onWalkingEffortProfileChange,
  onMaxWalkingDistancePerDayChange,
  onMaxContinuousWalkingDistanceChange,
  onAccessibilityNeedToggle
}: TourWizardMobilityStepProps) {
  const getPaceLabel = () => {
    if (travelPace < 33) return 'Relajado';
    if (travelPace < 67) return 'Moderado';
    return 'Rápido';
  };

  return (
    <VStack space='xl' flex={1}>
      {/* Group Type */}
      <VStack space='sm'>
        <WizardFieldLabel>¿Con quién viajás?</WizardFieldLabel>
        <HStack space='sm' justifyContent='space-between'>
          {GROUP_OPTIONS.map(({ type, icon: IconComponent, label }) => {
            const isSelected = groupType === type;
            return (
              <Pressable
                key={type}
                flex={1}
                onPress={() => onGroupTypeChange(type)}
              >
                <Box
                  bg={isSelected ? '$secondary950' : '$white'}
                  borderRadius='$xl'
                  py='$3'
                  px='$2'
                  alignItems='center'
                  justifyContent='center'
                  borderWidth={1.5}
                  borderColor={isSelected ? '$secondary950' : '$borderLight200'}
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={isSelected ? 0.15 : 0.04}
                  shadowRadius={2}
                  elevation={isSelected ? 2 : 1}
                >
                  <Icon
                    as={IconComponent}
                    size='lg'
                    color={isSelected ? '$primary400' : '$textLight600'}
                  />
                  <Text
                    mt='$1.5'
                    size='xs'
                    fontWeight={isSelected ? '$bold' : '$medium'}
                    color={isSelected ? '$white' : '$textLight700'}
                  >
                    {label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </HStack>
      </VStack>

      {/* Budget Level */}
      <VStack space='sm'>
        <WizardFieldLabel>Presupuesto</WizardFieldLabel>
        <HStack bg='$backgroundLight100' borderRadius='$xl' p='$1' space='xs'>
          {(['low', 'medium', 'high'] as const).map((level) => {
            const isSelected = budgetLevel === level;
            return (
              <Pressable
                key={level}
                flex={1}
                onPress={() => onBudgetLevelChange(level)}
              >
                <Box
                  bg={isSelected ? '$white' : 'transparent'}
                  borderRadius='$lg'
                  py='$2.5'
                  alignItems='center'
                  justifyContent='center'
                  shadowColor={isSelected ? '$black' : 'transparent'}
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={isSelected ? 0.1 : 0}
                  shadowRadius={3}
                  elevation={isSelected ? 2 : 0}
                >
                  <Text
                    size='md'
                    fontWeight={isSelected ? '$bold' : '$medium'}
                    color={isSelected ? '$primary600' : '$textLight500'}
                  >
                    {'$'.repeat(level === 'low' ? 1 : level === 'medium' ? 2 : 3)}
                  </Text>
                  <Text
                    size='2xs'
                    color={isSelected ? '$textLight900' : '$textLight400'}
                  >
                    {level === 'low' ? 'Económico' : level === 'medium' ? 'Medio' : 'Alto'}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </HStack>
      </VStack>

      {/* Transportation Modes */}
      <VStack space='sm'>
        <WizardFieldLabel>Medios de Transporte Permitidos</WizardFieldLabel>
        <HStack space='sm' justifyContent='space-between'>
          {TRANSPORT_OPTIONS.map(({ mode, icon: IconComponent, label }) => {
            const isSelected = transportationModes.includes(mode);
            return (
              <Pressable
                key={mode}
                flex={1}
                onPress={() => onTransportationModeToggle(mode)}
              >
                <Box
                  bg={isSelected ? '$primary50' : '$white'}
                  borderRadius='$xl'
                  py='$3'
                  px='$2'
                  alignItems='center'
                  justifyContent='center'
                  borderWidth={1.5}
                  borderColor={isSelected ? '$primary500' : '$borderLight200'}
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={isSelected ? 0.1 : 0.04}
                  shadowRadius={2}
                  elevation={1}
                >
                  <Icon
                    as={IconComponent}
                    size='lg'
                    color={isSelected ? '$primary600' : '$textLight600'}
                  />
                  <Text
                    mt='$1.5'
                    size='xs'
                    fontWeight={isSelected ? '$bold' : '$medium'}
                    color={isSelected ? '$primary700' : '$textLight700'}
                  >
                    {label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </HStack>
      </VStack>

      {/* Walking Effort Profile */}
      <VStack space='sm'>
        <HStack justifyContent='space-between' alignItems='center'>
          <WizardFieldLabel>Esfuerzo caminando por día</WizardFieldLabel>
          <Text size='2xs' color='$textLight500' fontWeight='$medium'>
            Hasta {(maxWalkingDistancePerDayMeters / 1000).toFixed(1)} km/día
          </Text>
        </HStack>

        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {WALKING_PROFILES.map(({ profile, label, desc }) => {
            const isSelected = walkingEffortProfile === profile;
            return (
              <Pressable
                key={profile}
                flexBasis='48%'
                flexGrow={1}
                onPress={() => onWalkingEffortProfileChange(profile)}
              >
                <Box
                  bg={isSelected ? '$primary50' : '$white'}
                  borderRadius='$xl'
                  p='$3'
                  borderWidth={1.5}
                  borderColor={isSelected ? '$primary500' : '$borderLight200'}
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={isSelected ? 0.1 : 0.04}
                  shadowRadius={2}
                  elevation={1}
                >
                  <HStack justifyContent='space-between' alignItems='center'>
                    <Text
                      size='xs'
                      fontWeight={isSelected ? '$bold' : '$semibold'}
                      color={isSelected ? '$primary800' : '$textLight800'}
                    >
                      {label}
                    </Text>
                    {isSelected && (
                      <Icon as={Check} size='xs' color='$primary600' />
                    )}
                  </HStack>
                  <Text
                    size='2xs'
                    color={isSelected ? '$primary600' : '$textLight400'}
                    mt='$0.5'
                  >
                    {desc}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </Box>

        {/* Custom Walking Sliders */}
        {walkingEffortProfile === 'custom' && (
          <VStack
            bg='$white'
            borderRadius='$2xl'
            p='$4'
            borderWidth={1}
            borderColor='$borderLight200'
            space='md'
            mt='$2'
          >
            <VStack space='xs'>
              <HStack justifyContent='space-between'>
                <Text size='xs' fontWeight='$bold' color='$textLight800'>
                  Total diario permitido
                </Text>
                <Text size='xs' fontWeight='$bold' color='$primary600'>
                  {(maxWalkingDistancePerDayMeters / 1000).toFixed(1)} km
                </Text>
              </HStack>
              <Slider
                value={maxWalkingDistancePerDayMeters}
                onChange={onMaxWalkingDistancePerDayChange}
                minValue={1000}
                maxValue={20000}
                step={500}
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
            </VStack>

            <VStack space='xs'>
              <HStack justifyContent='space-between'>
                <Text size='xs' fontWeight='$bold' color='$textLight800'>
                  Máximo tramo continuo sin descanso
                </Text>
                <Text size='xs' fontWeight='$bold' color='$primary600'>
                  {(maxContinuousWalkingDistanceMeters / 1000).toFixed(1)} km
                </Text>
              </HStack>
              <Slider
                value={maxContinuousWalkingDistanceMeters}
                onChange={onMaxContinuousWalkingDistanceChange}
                minValue={250}
                maxValue={maxWalkingDistancePerDayMeters}
                step={250}
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
            </VStack>
          </VStack>
        )}
      </VStack>

      {/* Pace Slider */}
      <VStack
        bg='$white'
        borderRadius='$2xl'
        p='$4'
        borderWidth={1}
        borderColor='$borderLight200'
        space='sm'
      >
        <HStack justifyContent='space-between' alignItems='center'>
          <Text size='xs' fontWeight='$bold' color='$textLight800'>
            Ritmo del Itinerario
          </Text>
          <Box bg='$primary50' px='$2.5' py='$0.5' borderRadius='$full'>
            <Text size='2xs' fontWeight='$bold' color='$primary700'>
              {getPaceLabel()}
            </Text>
          </Box>
        </HStack>
        <Slider
          value={travelPace}
          onChange={onTravelPaceChange}
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
        <HStack justifyContent='space-between' px='$1'>
          <Text size='2xs' color='$textLight400' fontWeight='$medium'>
            Relax (Pocas paradas)
          </Text>
          <Text size='2xs' color='$textLight400' fontWeight='$medium'>
            Moderado
          </Text>
          <Text size='2xs' color='$textLight400' fontWeight='$medium'>
            Rápido (Máx POIs)
          </Text>
        </HStack>
      </VStack>

      {/* Accessibility */}
      <VStack space='sm'>
        <WizardFieldLabel>Accesibilidad (Opcional)</WizardFieldLabel>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {ACCESSIBILITY_OPTIONS.map(({ value, label }) => {
            const isSelected = accessibilityNeeds.includes(value);
            return (
              <Pressable
                key={value}
                onPress={() => onAccessibilityNeedToggle(value)}
              >
                <Box
                  bg={isSelected ? '$secondary950' : '$white'}
                  borderRadius='$full'
                  px='$3.5'
                  py='$2'
                  borderWidth={1}
                  borderColor={isSelected ? '$secondary950' : '$borderLight200'}
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={isSelected ? 0.1 : 0.02}
                  shadowRadius={2}
                  elevation={1}
                >
                  <Text
                    size='xs'
                    fontWeight={isSelected ? '$bold' : '$medium'}
                    color={isSelected ? '$white' : '$textLight700'}
                  >
                    {label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </Box>
      </VStack>
    </VStack>
  );
}

