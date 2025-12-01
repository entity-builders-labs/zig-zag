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
  FormControl,
  FormControlLabel,
  FormControlLabelText,
  Select,
  SelectTrigger,
  SelectInput,
  SelectIcon,
  SelectPortal,
  SelectBackdrop,
  SelectContent,
  SelectDragIndicatorWrapper,
  SelectDragIndicator,
  SelectItem,
  Checkbox,
  CheckboxIndicator,
  CheckboxIcon,
  CheckboxLabel,
  ScrollView,
} from '@gluestack-ui/themed';
import { ChevronDownIcon, CheckIcon } from 'lucide-react-native';
import { GenerateTourDto } from '@/api/tours';
import { DestinationInput } from './DestinationInput';

interface TourWizardFormProps {
  onSubmit: (preferences: GenerateTourDto) => void;
  onCancel: () => void;
  initialLocation?: { lat: number; lng: number };
}

const INTEREST_OPTIONS = [
  'history',
  'culture',
  'food',
  'nature',
  'art',
  'architecture',
  'beach',
  'shopping',
  'nightlife',
  'sports',
];

const DIETARY_RESTRICTIONS_OPTIONS = [
  'vegetarian',
  'vegan',
  'gluten-free',
  'dairy-free',
  'halal',
  'kosher',
  'nut-free',
];

export const TourWizardForm: React.FC<TourWizardFormProps> = ({
  onSubmit,
  onCancel,
  initialLocation,
}) => {
  const [destination, setDestination] = useState<string>('');
  const [destinationCoords, setDestinationCoords] = useState<
    { lat: number; lng: number } | undefined
  >();
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [days, setDays] = useState<string>('3');
  const [budgetLevel, setBudgetLevel] = useState<'low' | 'medium' | 'high'>(
    'medium'
  );
  const [transportationMode, setTransportationMode] = useState<
    'walking' | 'driving' | 'public_transport' | 'cycling'
  >('walking');
  const [travelPace, setTravelPace] = useState<'relaxed' | 'moderate' | 'fast'>(
    'moderate'
  );
  const [groupType, setGroupType] = useState<
    'solo' | 'couple' | 'family' | 'friends'
  >('couple');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [selectedDietaryRestrictions, setSelectedDietaryRestrictions] =
    useState<string[]>([]);

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  };

  const toggleDietaryRestriction = (restriction: string) => {
    setSelectedDietaryRestrictions((prev) =>
      prev.includes(restriction)
        ? prev.filter((r) => r !== restriction)
        : [...prev, restriction]
    );
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
      // Store destination coordinates separately for preferences
      destinationLatitude: destinationCoords?.lat,
      destinationLongitude: destinationCoords?.lng,
      days: parseInt(days, 10),
      budgetLevel,
      transportationMode,
      travelPace,
      groupType,
      interests: selectedInterests.length > 0 ? selectedInterests : undefined,
      dietaryRestrictions:
        selectedDietaryRestrictions.length > 0
          ? selectedDietaryRestrictions
          : undefined,
      startDates: startDates.length > 0 ? startDates : undefined,
      // Use destination coordinates if available, otherwise use initial location
      latitude: destinationCoords?.lat || initialLocation?.lat,
      longitude: destinationCoords?.lng || initialLocation?.lng,
      includeExistingActivities: true,
      skipImageGeneration: true,
    };

    onSubmit(preferences);
  };

  return (
    <Box flex={1} bg='$white' p='$4'>
      <ScrollView showsVerticalScrollIndicator={false}>
        <VStack space='lg' pb='$8'>
          <Heading size='xl' color='$textLight900'>
            Crear Nuevo Tour
          </Heading>
          <Text size='sm' color='$textLight600'>
            Completa tus preferencias para generar un tour personalizado
          </Text>

          {/* Destination */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>Destino</FormControlLabelText>
            </FormControlLabel>
            <DestinationInput
              value={destination}
              onDestinationChange={(dest, coords) => {
                setDestination(dest);
                if (coords) {
                  setDestinationCoords(coords);
                }
              }}
            />
          </FormControl>

          {/* Start Date */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>Fecha de Inicio</FormControlLabelText>
            </FormControlLabel>
            <Input>
              <InputField
                value={startDate}
                onChangeText={setStartDate}
                placeholder='YYYY-MM-DD'
                keyboardType='default'
              />
            </Input>
            <Text size='xs' color='$textLight500' mt='$1'>
              Formato: YYYY-MM-DD (ej: 2024-06-15)
            </Text>
          </FormControl>

          {/* End Date */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>
                Fecha de Fin (opcional)
              </FormControlLabelText>
            </FormControlLabel>
            <Input>
              <InputField
                value={endDate}
                onChangeText={setEndDate}
                placeholder='YYYY-MM-DD'
                keyboardType='default'
              />
            </Input>
            <Text size='xs' color='$textLight500' mt='$1'>
              Formato: YYYY-MM-DD (ej: 2024-06-18)
            </Text>
          </FormControl>

          {/* Days */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>Duración (días)</FormControlLabelText>
            </FormControlLabel>
            <Input>
              <InputField
                value={days}
                onChangeText={setDays}
                keyboardType='numeric'
                placeholder='3'
              />
            </Input>
          </FormControl>

          {/* Budget Level */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>Nivel de Presupuesto</FormControlLabelText>
            </FormControlLabel>
            <Select
              selectedValue={budgetLevel}
              onValueChange={(value) =>
                setBudgetLevel(value as 'low' | 'medium' | 'high')
              }
            >
              <SelectTrigger>
                <SelectInput placeholder='Selecciona presupuesto' />
                <SelectIcon>
                  <ChevronDownIcon />
                </SelectIcon>
              </SelectTrigger>
              <SelectPortal>
                <SelectBackdrop />
                <SelectContent>
                  <SelectDragIndicatorWrapper>
                    <SelectDragIndicator />
                  </SelectDragIndicatorWrapper>
                  <SelectItem label='Bajo' value='low' />
                  <SelectItem label='Medio' value='medium' />
                  <SelectItem label='Alto' value='high' />
                </SelectContent>
              </SelectPortal>
            </Select>
          </FormControl>

          {/* Transportation Mode */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>Modo de Transporte</FormControlLabelText>
            </FormControlLabel>
            <Select
              selectedValue={transportationMode}
              onValueChange={(value) =>
                setTransportationMode(
                  value as
                    | 'walking'
                    | 'driving'
                    | 'public_transport'
                    | 'cycling'
                )
              }
            >
              <SelectTrigger>
                <SelectInput placeholder='Selecciona transporte' />
                <SelectIcon>
                  <ChevronDownIcon />
                </SelectIcon>
              </SelectTrigger>
              <SelectPortal>
                <SelectBackdrop />
                <SelectContent>
                  <SelectDragIndicatorWrapper>
                    <SelectDragIndicator />
                  </SelectDragIndicatorWrapper>
                  <SelectItem label='Caminando' value='walking' />
                  <SelectItem label='En auto' value='driving' />
                  <SelectItem
                    label='Transporte público'
                    value='public_transport'
                  />
                  <SelectItem label='En bicicleta' value='cycling' />
                </SelectContent>
              </SelectPortal>
            </Select>
          </FormControl>

          {/* Travel Pace */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>Ritmo de Viaje</FormControlLabelText>
            </FormControlLabel>
            <Select
              selectedValue={travelPace}
              onValueChange={(value) =>
                setTravelPace(value as 'relaxed' | 'moderate' | 'fast')
              }
            >
              <SelectTrigger>
                <SelectInput placeholder='Selecciona ritmo' />
                <SelectIcon>
                  <ChevronDownIcon />
                </SelectIcon>
              </SelectTrigger>
              <SelectPortal>
                <SelectBackdrop />
                <SelectContent>
                  <SelectDragIndicatorWrapper>
                    <SelectDragIndicator />
                  </SelectDragIndicatorWrapper>
                  <SelectItem label='Relajado' value='relaxed' />
                  <SelectItem label='Moderado' value='moderate' />
                  <SelectItem label='Rápido' value='fast' />
                </SelectContent>
              </SelectPortal>
            </Select>
          </FormControl>

          {/* Group Type */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>Tipo de Grupo</FormControlLabelText>
            </FormControlLabel>
            <Select
              selectedValue={groupType}
              onValueChange={(value) =>
                setGroupType(value as 'solo' | 'couple' | 'family' | 'friends')
              }
            >
              <SelectTrigger>
                <SelectInput placeholder='Selecciona tipo de grupo' />
                <SelectIcon>
                  <ChevronDownIcon />
                </SelectIcon>
              </SelectTrigger>
              <SelectPortal>
                <SelectBackdrop />
                <SelectContent>
                  <SelectDragIndicatorWrapper>
                    <SelectDragIndicator />
                  </SelectDragIndicatorWrapper>
                  <SelectItem label='Solo' value='solo' />
                  <SelectItem label='Pareja' value='couple' />
                  <SelectItem label='Familia' value='family' />
                  <SelectItem label='Amigos' value='friends' />
                </SelectContent>
              </SelectPortal>
            </Select>
          </FormControl>

          {/* Interests */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>
                Intereses (selecciona varios)
              </FormControlLabelText>
            </FormControlLabel>
            <VStack space='sm' mt='$2'>
              {INTEREST_OPTIONS.map((interest) => (
                <Checkbox
                  key={interest}
                  value={interest}
                  isChecked={selectedInterests.includes(interest)}
                  onChange={() => toggleInterest(interest)}
                >
                  <CheckboxIndicator mr='$2'>
                    <CheckboxIcon as={CheckIcon} />
                  </CheckboxIndicator>
                  <CheckboxLabel>{interest}</CheckboxLabel>
                </Checkbox>
              ))}
            </VStack>
          </FormControl>

          {/* Dietary Restrictions */}
          <FormControl>
            <FormControlLabel>
              <FormControlLabelText>
                Restricciones Alimentarias (opcional)
              </FormControlLabelText>
            </FormControlLabel>
            <VStack space='sm' mt='$2'>
              {DIETARY_RESTRICTIONS_OPTIONS.map((restriction) => (
                <Checkbox
                  key={restriction}
                  value={restriction}
                  isChecked={selectedDietaryRestrictions.includes(restriction)}
                  onChange={() => toggleDietaryRestriction(restriction)}
                >
                  <CheckboxIndicator mr='$2'>
                    <CheckboxIcon as={CheckIcon} />
                  </CheckboxIndicator>
                  <CheckboxLabel>{restriction}</CheckboxLabel>
                </Checkbox>
              ))}
            </VStack>
          </FormControl>

          {/* Action Buttons */}
          <HStack space='md' mt='$4'>
            <Button variant='outline' flex={1} onPress={onCancel}>
              <ButtonText>Cancelar</ButtonText>
            </Button>
            <Button flex={1} onPress={handleSubmit}>
              <ButtonText>Crear Tour</ButtonText>
            </Button>
          </HStack>
        </VStack>
      </ScrollView>
    </Box>
  );
};
