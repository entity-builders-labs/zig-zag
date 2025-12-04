import React from 'react';
import { Box, Heading, HStack, Text } from '@gluestack-ui/themed';
import { TourStopDayHeader } from './types';

export const DayHeader = ({ data }: { data: TourStopDayHeader }) => {
  return (
    <Box py='$4' px='$4'>
      <HStack alignItems='center' space='sm'>
        <Box width={4} height={20} bg='$primary500' borderRadius='$full' />
        <Heading size='lg' color='$textLight800' fontWeight='$bold'>
          {data.title}
        </Heading>
      </HStack>
    </Box>
  );
};
