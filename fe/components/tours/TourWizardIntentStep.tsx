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
import { Check, Compass, Landmark, MapPin, Sparkles } from 'lucide-react-native';
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
  { value: 'point_visits' as const, label: '🏛️ Visitas a Lugares' },
  { value: 'neighborhood_walks' as const, label: '🚶 Caminatas Barriales' },
  { value: 'thematic_routes' as const, label: '🗺️ Rutas Temáticas' },
  { value: 'experiences' as const, label: '✨ Otras Experiencias' }
];

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
      {/* Experience Format */}
      <VStack space='sm'>
        <WizardFieldLabel>¿Qué formato de experiencia buscás?</WizardFieldLabel>
        <Box flexDirection='row' flexWrap='wrap' gap='$2'>
          {EXPERIENCE_FORMAT_OPTIONS.map(({ value, label }) => {
            const isSelected = experienceFormats.includes(value);
            return (
              <Pressable
                key={value}
                onPress={() => onExperienceFormatToggle(value)}
              >
                <Box
                  bg={isSelected ? '$secondary950' : '$white'}
                  borderRadius='$full'
                  px='$4'
                  py='$2.5'
                  borderWidth={1.5}
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
                    color={isSelected ? '$white' : '$textLight800'}
                  >
                    {label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </Box>
        <Text size='2xs' color='$textLight500'>
          Elegir una caminata no cambia automáticamente cuánto estás dispuesto a caminar.
        </Text>
      </VStack>

      {/* Exploration Style */}
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

      {/* Interests */}
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

      {/* Additional Preferences */}
      <VStack space='sm'>
        <WizardFieldLabel>Notas o pedidos especiales (Opcional)</WizardFieldLabel>
        <Box
          bg='$white'
          borderRadius='$xl'
          borderWidth={1}
          borderColor='$borderLight200'
          p='$2'
        >
          <Textarea
            size='md'
            h='$32'
            borderWidth='$0'
          >
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

