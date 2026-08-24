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
  Footprints,
  User,
  UserPlus,
  Users
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
  { mode: 'walking' as const, icon: Footprints, label: 'Pie' },
  { mode: 'driving' as const, icon: Car, label: 'Auto' },
  { mode: 'cycling' as const, icon: Bike, label: 'Bici' },
  { mode: 'public_transport' as const, icon: Bus, label: 'Público' }
];

const WALKING_PROFILES = [
  { profile: 'minimize' as const, label: 'Caminar lo mínimo' },
  { profile: 'moderate' as const, label: 'Moderado' },
  { profile: 'enjoys_walking' as const, label: 'Me gusta caminar' },
  { profile: 'custom' as const, label: 'Personalizado' }
];

const ACCESSIBILITY_OPTIONS = [
  { value: 'wheelchair_access', label: 'Acceso en silla de ruedas' },
  { value: 'avoid_stairs', label: 'Evitar escaleras' },
  { value: 'limited_mobility', label: 'Movilidad reducida' }
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
  return (
    <VStack space='xl' flex={1}>
      <VStack space='md'>
        <WizardFieldLabel>Presupuesto</WizardFieldLabel>
        <HStack bg='$backgroundLight200' borderRadius='$lg' p='$1' space='xs'>
          {(['low', 'medium', 'high'] as const).map((level) => (
            <Pressable
              key={level}
              flex={1}
              onPress={() => onBudgetLevelChange(level)}
            >
              <Box
                bg={
                  budgetLevel === level ? '$backgroundLight50' : 'transparent'
                }
                borderRadius='$md'
                py='$3'
                alignItems='center'
                justifyContent='center'
                shadowColor={budgetLevel === level ? '$black' : 'transparent'}
                shadowOffset={{ width: 0, height: 1 }}
                shadowOpacity={budgetLevel === level ? 0.12 : 0}
                shadowRadius={4}
                elevation={budgetLevel === level ? 2 : 0}
              >
                <Text
                  size='lg'
                  fontWeight={budgetLevel === level ? '$bold' : '$medium'}
                  color={
                    budgetLevel === level ? '$textLight900' : '$textLight500'
                  }
                >
                  {'$'.repeat(level === 'low' ? 1 : level === 'medium' ? 2 : 3)}
                </Text>
              </Box>
            </Pressable>
          ))}
        </HStack>
      </VStack>

      <VStack space='md'>
        <WizardFieldLabel>Compañía</WizardFieldLabel>
        <HStack space='md' justifyContent='space-around'>
          {GROUP_OPTIONS.map(({ type, icon: IconComponent, label }) => (
            <Pressable
              key={type}
              onPress={() => onGroupTypeChange(type)}
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

      <VStack space='md'>
        <WizardFieldLabel>Ritmo</WizardFieldLabel>
        <VStack space='sm'>
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

      <VStack space='md'>
        <WizardFieldLabel>Transporte (selección múltiple)</WizardFieldLabel>
        <HStack space='md' justifyContent='space-around'>
          {TRANSPORT_OPTIONS.map(({ mode, icon: IconComponent, label }) => {
            const selected = transportationModes.includes(mode);
            return (
              <Pressable
                key={mode}
                onPress={() => onTransportationModeToggle(mode)}
                alignItems='center'
              >
                <Box
                  w='$16'
                  h='$16'
                  borderRadius='$full'
                  bg={selected ? '$primary500' : '$backgroundLight100'}
                  alignItems='center'
                  justifyContent='center'
                  borderWidth={selected ? '$2' : '$0'}
                  borderColor='$primary500'
                >
                  <Icon
                    as={IconComponent}
                    size='xl'
                    color={selected ? '$white' : '$textLight600'}
                  />
                </Box>
                <Text
                  mt='$2'
                  size='sm'
                  color={selected ? '$primary500' : '$textLight600'}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </HStack>
      </VStack>

      <VStack space='md'>
        <WizardFieldLabel>Esfuerzo caminando por día</WizardFieldLabel>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {WALKING_PROFILES.map(({ profile, label }) => {
            const selected = walkingEffortProfile === profile;
            return (
              <Pressable
                key={profile}
                onPress={() => onWalkingEffortProfileChange(profile)}
              >
                <Box
                  bg={selected ? '$secondary950' : '$backgroundLight100'}
                  borderRadius='$full'
                  px='$4'
                  py='$2'
                >
                  <Text
                    size='sm'
                    color={selected ? '$backgroundLight50' : '$textLight700'}
                  >
                    {label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </Box>
        <Text size='sm' color='$textLight600'>
          Hasta {(maxWalkingDistancePerDayMeters / 1000).toFixed(1)} km por día
          · máximo {(maxContinuousWalkingDistanceMeters / 1000).toFixed(1)} km
          seguidos
        </Text>
        {walkingEffortProfile === 'custom' && (
          <VStack space='md'>
            <VStack space='xs'>
              <Text size='sm' color='$textLight700'>
                Total diario
              </Text>
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
              <Text size='sm' color='$textLight700'>
                Máximo tramo continuo
              </Text>
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

      <VStack space='md'>
        <WizardFieldLabel>Accesibilidad</WizardFieldLabel>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {ACCESSIBILITY_OPTIONS.map(({ value, label }) => {
            const selected = accessibilityNeeds.includes(value);
            return (
              <Pressable
                key={value}
                onPress={() => onAccessibilityNeedToggle(value)}
              >
                <Box
                  bg={selected ? '$secondary950' : '$backgroundLight100'}
                  borderRadius='$full'
                  px='$4'
                  py='$2'
                >
                  <Text
                    size='sm'
                    color={selected ? '$backgroundLight50' : '$textLight700'}
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
