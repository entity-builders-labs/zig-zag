import React from 'react';
import {
  VStack,
  HStack,
  Input,
  InputField,
  Button,
  ButtonText,
  FormControl,
  FormControlError,
  FormControlErrorText,
  Box,
} from '@gluestack-ui/themed';

interface LocationInputProps {
  onLocationChange: (latitude: string, longitude: string) => void;
}

export const LocationInput: React.FC<LocationInputProps> = ({
  onLocationChange,
}) => {
  const [latitude, setLatitude] = React.useState('20.9119745');
  const [longitude, setLongitude] = React.useState('-100.8232041');
  const [error, setError] = React.useState('');

  const validateCoordinates = () => {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      setError('Please enter valid numbers');
      return false;
    }

    if (lat < -90 || lat > 90) {
      setError('Latitude must be between -90 and 90');
      return false;
    }

    if (lon < -180 || lon > 180) {
      setError('Longitude must be between -180 and 180');
      return false;
    }

    setError('');
    return true;
  };

  const handleSubmit = () => {
    if (validateCoordinates()) {
      onLocationChange(latitude, longitude);
    }
  };

  return (
    <Box p='$4'>
      <FormControl isInvalid={!!error}>
        <VStack>
          <HStack space='md' alignItems='center'>
            <VStack flex={1}>
              <Input>
                <InputField
                  value={latitude}
                  onChangeText={setLatitude}
                  keyboardType='numeric'
                  placeholder='Enter latitude'
                />
              </Input>
            </VStack>
            <VStack flex={1}>
              <Input>
                <InputField
                  value={longitude}
                  onChangeText={setLongitude}
                  keyboardType='numeric'
                  placeholder='Enter longitude'
                />
              </Input>
            </VStack>
          </HStack>
          {error && (
            <FormControlError>
              <FormControlErrorText>{error}</FormControlErrorText>
            </FormControlError>
          )}
        </VStack>
      </FormControl>
      <Button onPress={handleSubmit} mt='$4'>
        <ButtonText>Update Location</ButtonText>
      </Button>
    </Box>
  );
};
