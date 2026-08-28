import React from 'react';
import { HStack, VStack, Text, Box } from '@gluestack-ui/themed';
import { Tour } from '../../api/tours';

export const QuickStatsBar = ({ tour }: { tour: Tour }) => {
  const stopsCount = tour.activities?.length || 0;
  const distanceStr = tour.totalDistance ? `${tour.totalDistance.toFixed(1)} km` : '2.4 km';
  
  const getDurationStr = () => {
    if (!tour.duration) return '2h';
    const h = Math.floor(tour.duration);
    const m = Math.round((tour.duration - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <HStack
      bg='$white'
      py='$3.5'
      px='$4'
      mx='$4'
      mt={-24}
      borderRadius='$2xl'
      shadowColor='$black'
      shadowOffset={{ width: 0, height: 4 }}
      shadowOpacity={0.08}
      shadowRadius={12}
      elevation={4}
      borderWidth={1}
      borderColor='$borderLight100'
      justifyContent='space-around'
      alignItems='center'
    >
      <VStack alignItems='center' flex={1}>
        <Text size='2xs' fontWeight='$bold' color='$textLight400' textTransform='uppercase' letterSpacing={0.5}>
          Duración
        </Text>
        <Text size='sm' fontWeight='$bold' color='$textLight900' mt='$0.5'>
          ⏱️ {getDurationStr()}
        </Text>
      </VStack>

      <Box w={1} h={24} bg='$borderLight100' />

      <VStack alignItems='center' flex={1}>
        <Text size='2xs' fontWeight='$bold' color='$textLight400' textTransform='uppercase' letterSpacing={0.5}>
          Caminata
        </Text>
        <Text size='sm' fontWeight='$bold' color='$textLight900' mt='$0.5'>
          🚶‍♂️ {distanceStr}
        </Text>
      </VStack>

      <Box w={1} h={24} bg='$borderLight100' />

      <VStack alignItems='center' flex={1}>
        <Text size='2xs' fontWeight='$bold' color='$textLight400' textTransform='uppercase' letterSpacing={0.5}>
          Paradas
        </Text>
        <Text size='sm' fontWeight='$bold' color='$primary600' mt='$0.5'>
          📍 {stopsCount > 0 ? `${stopsCount} paradas` : '3 paradas'}
        </Text>
      </VStack>
    </HStack>
  );
};
