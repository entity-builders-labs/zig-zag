import React from 'react';
import { HStack, Icon, Text, Box } from '@gluestack-ui/themed';
import { Clock, Footprints, Banknote } from 'lucide-react-native';
import { Tour } from '../../api/tours';

export const QuickStatsBar = ({ tour }: { tour: Tour }) => {
  return (
    <HStack
      bg='$white'
      p='$4'
      mx='$4'
      mt={-25}
      borderRadius='$xl'
      shadowColor='$black'
      shadowOffset={{ width: 0, height: 2 }}
      shadowOpacity={0.1}
      shadowRadius={8}
      elevation={5}
      justifyContent='space-around'
      alignItems='center'
    >
      <HStack alignItems='center' space='xs'>
        <Icon as={Clock} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {tour.duration ? `${Math.round(tour.duration)}h` : 'N/A'}
        </Text>
      </HStack>
      <Box w={1} h={20} bg='$borderLight200' />
      <HStack alignItems='center' space='xs'>
        <Icon as={Footprints} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {tour.totalDistance ? `${tour.totalDistance.toFixed(1)} km` : 'N/A'}
        </Text>
      </HStack>
      <Box w={1} h={20} bg='$borderLight200' />
      <HStack alignItems='center' space='xs'>
        <Icon as={Banknote} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {tour.price ? `$${tour.price}` : 'Free'}
        </Text>
      </HStack>
    </HStack>
  );
};
