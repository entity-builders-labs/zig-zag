import React from 'react';
import { HStack, Box, Icon, Text } from '@gluestack-ui/themed';
import { Bus, Footprints } from 'lucide-react-native';
import { TourStopTransport } from './types';

export const SmartConnector = ({ data }: { data: TourStopTransport }) => {
  return (
    <HStack flex={1}>
      {/* Timeline Line */}
      <Box width={40} alignItems='center'>
        <Box
          flex={1}
          width={2}
          bg='$borderLight300'
          borderStyle='dashed'
          borderWidth={1}
          borderColor='#E5E5E5'
        />
      </Box>

      {/* Content */}
      <Box flex={1} py='$4'>
        <Box
          bg='$backgroundLight50'
          py='$2'
          px='$3'
          borderRadius='$full'
          alignSelf='flex-start'
          borderWidth={1}
          borderColor='$borderLight200'
        >
          <HStack space='sm' alignItems='center'>
            <Icon
              as={data.mode === 'bus' ? Bus : Footprints}
              size='xs'
              color='$primary500'
            />
            <Text size='xs' fontWeight='$medium' color='$textLight700'>
              {data.label} • {data.duration}
            </Text>
          </HStack>
        </Box>
      </Box>
    </HStack>
  );
};
