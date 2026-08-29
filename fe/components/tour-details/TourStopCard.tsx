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
  Pressable,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { TourStopLocation } from './types';
import { FONT_DISPLAY } from '@/constants/typography';

export const TourStopCard = ({
  data,
  isLast,
  stopNumber,
}: {
  data: TourStopLocation;
  isLast: boolean;
  stopNumber?: number;
}) => {
  const router = useRouter();
  // Activities that only exist inline on the tour (no linked Activity record)
  // get a synthetic `inline-...` id and have no detail page to navigate to.
  const hasActivityDetail = !data.id.startsWith('inline-');

  return (
    <HStack testID={`location-stop-${data.id}`}>
      {/* Timeline Node */}
      <Box width={36} alignItems='center' position='relative'>
        {/* Top Connecting Line */}
        <Box height={16} width={2} bg='$borderLight300' />

        {/* Node Dot with order number */}
        <Box
          width={24}
          height={24}
          borderRadius='$full'
          bg='$primary500'
          borderWidth={2}
          borderColor='$white'
          zIndex={1}
          alignItems='center'
          justifyContent='center'
          shadowColor='$primary500'
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.4}
          shadowRadius={4}
          elevation={3}
        >
          <Text size='2xs' fontWeight='$bold' color='$white'>
            {stopNumber ?? '•'}
          </Text>
        </Box>

        {/* Bottom Line (if not last) */}
        {!isLast && <Box flex={1} width={2} bg='$borderLight300' />}
      </Box>

      {/* Card Content */}
      <Box flex={1} pb='$4' pl='$2' pr='$2'>
        <Pressable
          onPress={() => {
            if (hasActivityDetail) router.push(`/activities/${data.id}`);
          }}
        >
          <Box
            bg='$white'
            borderRadius='$2xl'
            overflow='hidden'
            borderWidth={1}
            borderColor='$borderLight100'
            shadowColor='$black'
            shadowOffset={{ width: 0, height: 2 }}
            shadowOpacity={0.05}
            shadowRadius={6}
            elevation={2}
            p='$3'
          >
            <HStack space='md'>
              <Image
                source={{ uri: data.image }}
                alt={data.title}
                width={84}
                height={84}
                borderRadius={12}
                resizeMode='cover'
              />
              <VStack flex={1} justifyContent='space-between'>
                <VStack>
                  <HStack justifyContent='space-between' alignItems='center' mb='$1'>
                    <HStack space='xs' flexWrap='wrap'>
                      {data.badges?.slice(0, 2).map((badge, idx) => (
                        <Box
                          key={idx}
                          bg='$primary50'
                          px='$2'
                          py='$0.5'
                          borderRadius='$md'
                          borderWidth={1}
                          borderColor='$primary100'
                        >
                          <Text size='2xs' fontWeight='$bold' color='$primary700'>
                            {badge.text}
                          </Text>
                        </Box>
                      ))}
                    </HStack>
                  </HStack>

                  <Heading
                    size='sm'
                    numberOfLines={1}
                    ellipsizeMode='tail'
                    color='$textLight900'
                    style={{ fontFamily: FONT_DISPLAY }}
                  >
                    {data.title}
                  </Heading>
                  <Text size='xs' color='$textLight500' numberOfLines={2} mt='$0.5'>
                    {data.description}
                  </Text>
                </VStack>

                {hasActivityDetail && (
                  <HStack justifyContent='flex-end' alignItems='center' mt='$1'>
                    <Text size='2xs' fontWeight='$bold' color='$primary600'>
                      Ver detalles
                    </Text>
                    <Icon as={ChevronRight} size='2xs' color='$primary600' ml='$0.5' />
                  </HStack>
                )}
              </VStack>
            </HStack>
          </Box>
        </Pressable>
      </Box>
    </HStack>
  );
};
