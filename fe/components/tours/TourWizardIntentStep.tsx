import React from 'react';
import {
  Box,
  HStack,
  Icon,
  Pressable,
  Text,
  Textarea,
  TextareaInput,
  VStack
} from '@gluestack-ui/themed';
import { Check } from 'lucide-react-native';
import {
  ADDITIONAL_PREFERENCES_MAX_LENGTH,
  ExperienceIntent,
  ExplorationStyle
} from '@/features/tours/tour-generation-contract';
import { WizardFieldLabel } from './WizardFieldLabel';

interface TourWizardIntentStepProps {
  interestOptions: string[];
  selectedInterests: string[];
  selectedIntents: ExperienceIntent[];
  explorationStyle: ExplorationStyle;
  additionalPreferences: string;
  onInterestToggle: (value: string) => void;
  onIntentToggle: (value: ExperienceIntent) => void;
  onExplorationStyleChange: (value: ExplorationStyle) => void;
  onAdditionalPreferencesChange: (value: string) => void;
}

const EXPLORATION_STYLE_OPTIONS = [
  {
    value: 'iconic' as const,
    label: 'Icónicos',
    desc: 'Imperdibles y clásicos'
  },
  {
    value: 'balanced' as const,
    label: 'Equilibrado',
    desc: 'Lo mejor de ambos'
  },
  {
    value: 'local_deep_dive' as const,
    label: 'Más local',
    desc: 'Joyas ocultas'
  }
];

const EXPERIENCE_INTENT_OPTIONS: Array<{
  value: ExperienceIntent;
  label: string;
  desc: string;
}> = [
  {
    value: 'visit',
    label: 'Visitas y lugares',
    desc: 'Museos, monumentos, mercados y otros puntos concretos'
  },
  {
    value: 'walk',
    label: 'Caminatas y recorridos',
    desc: 'Paseos a pie que pueden combinar varios lugares'
  },
  {
    value: 'food',
    label: 'Gastronomía',
    desc: 'Comida, mercados, degustaciones y experiencias culinarias'
  },
  {
    value: 'nightlife',
    label: 'Vida nocturna',
    desc: 'Bares, música, espectáculos y experiencias nocturnas'
  },
  {
    value: 'route_like',
    label: 'Rutas temáticas',
    desc: 'Recorridos conectados por un tema, paisaje o producto'
  },
  {
    value: 'day_trip',
    label: 'Escapada de un día',
    desc: 'Experiencias desde el destino base con regreso en el día'
  }
];

export function TourWizardIntentStep({
  interestOptions,
  selectedInterests,
  selectedIntents,
  explorationStyle,
  additionalPreferences,
  onInterestToggle,
  onIntentToggle,
  onExplorationStyleChange,
  onAdditionalPreferencesChange
}: TourWizardIntentStepProps) {
  return (
    <VStack space='xl' flex={1}>
      <VStack space='sm'>
        <WizardFieldLabel>Estilo de exploración</WizardFieldLabel>
        <HStack space='sm' justifyContent='space-between'>
          {EXPLORATION_STYLE_OPTIONS.map(({ value, label, desc }) => {
            const isSelected = explorationStyle === value;
            return (
              <Pressable
                key={value}
                flex={1}
                onPress={() => onExplorationStyleChange(value)}
              >
                <Box
                  bg={isSelected ? '$primary50' : '$white'}
                  borderRadius='$xl'
                  p='$3'
                  alignItems='center'
                  justifyContent='center'
                  borderWidth={1.5}
                  borderColor={isSelected ? '$primary500' : '$borderLight200'}
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={isSelected ? 0.1 : 0.03}
                  shadowRadius={2}
                  elevation={1}
                >
                  <Text
                    size='xs'
                    fontWeight={isSelected ? '$bold' : '$semibold'}
                    color={isSelected ? '$primary900' : '$textLight800'}
                    textAlign='center'
                  >
                    {label}
                  </Text>
                  <Text
                    size='2xs'
                    color={isSelected ? '$primary600' : '$textLight400'}
                    textAlign='center'
                    mt='$0.5'
                  >
                    {desc}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </HStack>
      </VStack>

      <VStack space='sm'>
        <WizardFieldLabel>Tipo de experiencia</WizardFieldLabel>
        <Text size='2xs' color='$textLight500'>
          Podés combinar tipos e intereses. Por ejemplo, Caminatas y recorridos +
          Historia busca caminatas históricas sin crear un tipo especial en el
          planner.
        </Text>
        {EXPERIENCE_INTENT_OPTIONS.map(({ value, label, desc }) => {
          const isSelected = selectedIntents.includes(value);
          return (
            <Pressable key={value} onPress={() => onIntentToggle(value)}>
              <Box
                bg={isSelected ? '$primary50' : '$white'}
                borderWidth={1.5}
                borderColor={isSelected ? '$primary500' : '$borderLight200'}
                borderRadius='$xl'
                px='$4'
                py='$3'
              >
                <HStack justifyContent='space-between' alignItems='center'>
                  <VStack flex={1} pr='$3'>
                    <Text
                      size='sm'
                      fontWeight={isSelected ? '$bold' : '$semibold'}
                      color={isSelected ? '$primary900' : '$textLight800'}
                    >
                      {label}
                    </Text>
                    <Text size='2xs' color='$textLight500' mt='$0.5'>
                      {desc}
                    </Text>
                  </VStack>
                  {isSelected && <Icon as={Check} size='sm' color='$primary600' />}
                </HStack>
              </Box>
            </Pressable>
          );
        })}
      </VStack>

      <VStack space='sm'>
        <WizardFieldLabel>Tus Intereses Favoritos</WizardFieldLabel>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {interestOptions.map((interest) => {
            const isSelected = selectedInterests.includes(interest);
            return (
              <Pressable
                key={interest}
                onPress={() => onInterestToggle(interest)}
              >
                <Box
                  bg={isSelected ? '$primary50' : '$white'}
                  borderWidth={1.5}
                  borderColor={isSelected ? '$primary500' : '$borderLight200'}
                  borderRadius='$full'
                  px='$3.5'
                  py='$2'
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={isSelected ? 0.08 : 0.02}
                  shadowRadius={2}
                  elevation={1}
                >
                  <HStack space='xs' alignItems='center'>
                    <Text
                      size='xs'
                      fontWeight={isSelected ? '$bold' : '$medium'}
                      color={isSelected ? '$primary900' : '$textLight800'}
                    >
                      {interest}
                    </Text>
                    {isSelected && (
                      <Icon as={Check} size='2xs' color='$primary600' />
                    )}
                  </HStack>
                </Box>
              </Pressable>
            );
          })}
        </Box>
      </VStack>

      <VStack space='sm'>
        <WizardFieldLabel>Notas o pedidos especiales (Opcional)</WizardFieldLabel>
        <Box
          bg='$white'
          borderRadius='$xl'
          borderWidth={1}
          borderColor='$borderLight200'
          p='$2'
        >
          <Textarea size='md' h='$32' borderWidth='$0'>
            <TextareaInput
              placeholder='Ej. Prefiero fotografía urbana, cafés históricos y evitar lugares muy concurridos...'
              value={additionalPreferences}
              maxLength={ADDITIONAL_PREFERENCES_MAX_LENGTH}
              onChangeText={onAdditionalPreferencesChange}
              style={{ fontSize: 13 }}
            />
          </Textarea>
        </Box>
        <Text size='2xs' color='$textLight400' textAlign='right'>
          {additionalPreferences.length}/{ADDITIONAL_PREFERENCES_MAX_LENGTH}
        </Text>
      </VStack>
    </VStack>
  );
}
