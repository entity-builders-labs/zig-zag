import React from 'react';
import { HStack, Box, Icon, Text } from '@gluestack-ui/themed';
import { Bus, Footprints } from 'lucide-react-native';
import { TourStopTransport } from './types';

export const SmartConnector = ({ data }: { data: TourStopTransport }) => {
  return (
    <HStack>
      {/* Timeline Line */}
      <Box width={36} alignItems='center'>
        <Box
          flex={1}
          width={2}
          bg='$borderLight300'
        />
      </Box>

      {/* Content */}
      <Box flex={1} py='$2' pl='$2' pr='$2'>
        <Box
          bg='$backgroundLight100'
          py='$1.5'
          px='$3'
          borderRadius='$full'
          alignSelf='flex-start'
          borderWidth={1}
          borderColor='$borderLight200'
        >
          <HStack space='xs' alignItems='center'>
            <Icon
              as={data.mode === 'bus' ? Bus : Footprints}
              size='2xs'
              color='$primary600'
            />
            <Text size='2xs' fontWeight='$semibold' color='$textLight700'>
              {data.label} • {data.duration}
            </Text>
          </HStack>
        </Box>
      </Box>
    </HStack>
  );
};
