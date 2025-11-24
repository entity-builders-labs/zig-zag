import React from 'react';
import {
  HStack,
  Box,
  Image,
  VStack,
  Heading,
  Text,
  Badge,
  BadgeText,
  Button,
  ButtonText,
  Icon,
} from '@gluestack-ui/themed';
import { ChevronRight } from 'lucide-react-native';
import { TourStopLocation } from './types';

export const TourStopCard = ({
  data,
  isLast,
}: {
  data: TourStopLocation;
  isLast: boolean;
}) => {
  return (
    <HStack flex={1}>
      {/* Timeline Node */}
      <Box width={40} alignItems='center' position='relative'>
        {/* Top Line */}
        <Box height={20} width={2} bg='$borderLight300' />

        {/* Node Dot */}
        <Box
          width={16}
          height={16}
          borderRadius='$full'
          bg='$primary500'
          borderWidth={3}
          borderColor='$white'
          zIndex={1}
          shadowColor='$primary500'
          shadowOffset={{ width: 0, height: 0 }}
          shadowOpacity={0.5}
          shadowRadius={4}
        />

        {/* Bottom Line (if not last) */}
        {!isLast && <Box flex={1} width={2} bg='$borderLight300' />}
      </Box>

      {/* Card Content */}
      <Box flex={1} pb='$6' pr='$4'>
        <Box
          bg='$white'
          borderRadius='$xl'
          overflow='hidden'
          borderWidth={1}
          borderColor='$borderLight100'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 1 }}
          shadowOpacity={0.05}
          shadowRadius={3}
          elevation={2}
        >
          <HStack>
            <Image
              source={{ uri: data.image }}
              alt={data.title}
              width={100}
              height={100}
              resizeMode='cover'
            />
            <VStack p='$3' flex={1} justifyContent='space-between'>
              <VStack>
                <Heading size='sm' numberOfLines={1} ellipsizeMode='tail'>
                  {data.title}
                </Heading>
                <Text size='xs' color='$textLight500' numberOfLines={2} mt='$1'>
                  {data.description}
                </Text>
              </VStack>

              <HStack
                justifyContent='space-between'
                alignItems='center'
                mt='$2'
              >
                <HStack space='xs'>
                  {data.badges?.map((badge, idx) => (
                    <Badge
                      key={idx}
                      size='sm'
                      action={badge.action}
                      variant='outline'
                      borderRadius='$sm'
                    >
                      <BadgeText fontSize='$2xs'>{badge.text}</BadgeText>
                    </Badge>
                  ))}
                </HStack>

                {/* Action Button */}
                <Button size='xs' variant='link' action='primary' p='$0'>
                  <ButtonText size='xs' fontWeight='$bold'>
                    Ver
                  </ButtonText>
                  <Icon as={ChevronRight} size='xs' ml='$1' />
                </Button>
              </HStack>
            </VStack>
          </HStack>
        </Box>
      </Box>
    </HStack>
  );
};
