import React from 'react';
import {
  Box,
  HStack,
  Pressable,
  Text,
  Textarea,
  TextareaInput,
  VStack
} from '@gluestack-ui/themed';
import {
  ADDITIONAL_PREFERENCES_MAX_LENGTH,
  ExperienceFormat,
  ExplorationStyle
} from '@/features/tours/tour-generation-contract';
import { WizardFieldLabel } from './WizardFieldLabel';

interface TourWizardIntentStepProps {
  interestOptions: string[];
  selectedInterests: string[];
  experienceFormats: ExperienceFormat[];
  explorationStyle: ExplorationStyle;
  additionalPreferences: string;
  onInterestToggle: (value: string) => void;
  onExperienceFormatToggle: (value: ExperienceFormat) => void;
  onExplorationStyleChange: (value: ExplorationStyle) => void;
  onAdditionalPreferencesChange: (value: string) => void;
}

const EXPERIENCE_FORMAT_OPTIONS = [
  { value: 'point_visits' as const, label: 'Visitar lugares' },
  { value: 'neighborhood_walks' as const, label: 'Caminatas por barrios' },
  { value: 'thematic_routes' as const, label: 'Rutas temáticas' },
  { value: 'experiences' as const, label: 'Otras experiencias' }
];

const EXPLORATION_STYLE_OPTIONS = [
  { value: 'iconic' as const, label: 'Icónicos' },
  { value: 'balanced' as const, label: 'Equilibrado' },
  { value: 'local_deep_dive' as const, label: 'Más local' }
];

export function TourWizardIntentStep({
  interestOptions,
  selectedInterests,
  experienceFormats,
  explorationStyle,
  additionalPreferences,
  onInterestToggle,
  onExperienceFormatToggle,
  onExplorationStyleChange,
  onAdditionalPreferencesChange
}: TourWizardIntentStepProps) {
  return (
    <VStack space='xl' flex={1}>
      <VStack space='md'>
        <WizardFieldLabel>¿Qué tipo de experiencia querés?</WizardFieldLabel>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {EXPERIENCE_FORMAT_OPTIONS.map(({ value, label }) => {
            const selected = experienceFormats.includes(value);
            return (
              <Pressable
                key={value}
                onPress={() => onExperienceFormatToggle(value)}
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
        <Text size='xs' color='$textLight500'>
          Elegir una caminata no cambia automáticamente cuánto estás dispuesto a
          caminar.
        </Text>
      </VStack>

      <VStack space='md'>
        <WizardFieldLabel>Estilo de exploración</WizardFieldLabel>
        <HStack bg='$backgroundLight200' borderRadius='$lg' p='$1' space='xs'>
          {EXPLORATION_STYLE_OPTIONS.map(({ value, label }) => {
            const selected = explorationStyle === value;
            return (
              <Pressable
                key={value}
                flex={1}
                onPress={() => onExplorationStyleChange(value)}
              >
                <Box
                  bg={selected ? '$backgroundLight50' : 'transparent'}
                  borderRadius='$md'
                  py='$3'
                  alignItems='center'
                >
                  <Text
                    size='sm'
                    fontWeight={selected ? '$bold' : '$medium'}
                    color={selected ? '$textLight900' : '$textLight500'}
                  >
                    {label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </HStack>
      </VStack>

      <VStack space='md'>
        <WizardFieldLabel>Intereses</WizardFieldLabel>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {interestOptions.map((interest) => {
            const selected = selectedInterests.includes(interest);
            return (
              <Pressable
                key={interest}
                onPress={() => onInterestToggle(interest)}
              >
                <Box
                  bg={selected ? '$secondary950' : '$backgroundLight100'}
                  borderWidth='$1'
                  borderColor={selected ? '$secondary950' : '$borderLight200'}
                  borderRadius='$full'
                  px='$4'
                  py='$2'
                >
                  <Text
                    size='sm'
                    fontWeight={selected ? '$semibold' : '$normal'}
                    color={selected ? '$backgroundLight50' : '$textLight700'}
                  >
                    {interest}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </Box>
      </VStack>

      <VStack space='md'>
        <WizardFieldLabel>Preferencias adicionales</WizardFieldLabel>
        <Textarea
          size='lg'
          h='$32'
          borderColor='$borderLight200'
          borderRadius='$lg'
        >
          <TextareaInput
            placeholder='Ej. Prefiero fotografía urbana y evitar lugares muy concurridos'
            value={additionalPreferences}
            maxLength={ADDITIONAL_PREFERENCES_MAX_LENGTH}
            onChangeText={onAdditionalPreferencesChange}
          />
        </Textarea>
        <Text size='xs' color='$textLight500' textAlign='right'>
          {additionalPreferences.length}/{ADDITIONAL_PREFERENCES_MAX_LENGTH}
        </Text>
      </VStack>
    </VStack>
  );
}
