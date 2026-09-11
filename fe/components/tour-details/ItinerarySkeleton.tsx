import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Box, HStack, Heading, Text, VStack } from '@gluestack-ui/themed';
import { FONT_DISPLAY } from '@/constants/typography';

interface ItinerarySkeletonProps {
  message?: string;
  showHeaderCard?: boolean;
}

export const ItinerarySkeleton: React.FC<ItinerarySkeletonProps> = ({
  message,
  showHeaderCard = true,
}) => {
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 950,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 950,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <VStack space='md'>
      {/* Top Status Card - Modern & Spinner-free */}
      {showHeaderCard && (
        <Box
          p='$5'
          bg='$white'
          borderRadius='$2xl'
          borderWidth={1}
          borderColor='$borderLight100'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.04}
          shadowRadius={6}
        >
          <HStack space='sm' alignItems='center' mb='$1.5'>
            <Box
              w={8}
              h={8}
              borderRadius='$full'
              bg='$primary500'
            />
            <Heading
              size='sm'
              color='$textLight900'
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Armando tu recorrido
            </Heading>
          </HStack>
          <Text
            size='sm'
            color='$textLight600'
            fontWeight='$medium'
            numberOfLines={2}
          >
            {message || 'Buscando lugares y relatos de tu destino...'}
          </Text>
        </Box>
      )}

      {/* 3 Pulsing Skeleton Stop Cards */}
      <Animated.View style={{ opacity: pulseAnim }}>
        <VStack space='md'>
          {[1, 2, 3].map((stopNumber, idx) => (
            <HStack key={stopNumber} space='sm' alignItems='flex-start'>
              {/* Left timeline indicator */}
              <VStack alignItems='center' w={28} pt='$2'>
                <Box
                  w={24}
                  h={24}
                  borderRadius='$full'
                  bg='$backgroundLight200'
                  alignItems='center'
                  justifyContent='center'
                >
                  <Text size='2xs' fontWeight='$bold' color='$textLight400'>
                    {stopNumber}
                  </Text>
                </Box>
                {idx < 2 && (
                  <Box
                    w={2}
                    h={75}
                    bg='$backgroundLight200'
                    my='$1'
                  />
                )}
              </VStack>

              {/* Card skeleton */}
              <Box
                flex={1}
                p='$3.5'
                bg='$white'
                borderRadius='$2xl'
                borderWidth={1}
                borderColor='$borderLight100'
              >
                <HStack space='md' alignItems='center'>
                  {/* Left content skeleton bars */}
                  <VStack flex={1} space='xs'>
                    {/* Category pill placeholder */}
                    <Box
                      w={70}
                      h={18}
                      borderRadius='$full'
                      bg='$backgroundLight200'
                      mb='$1'
                    />
                    {/* Title bar placeholder */}
                    <Box
                      w={idx === 1 ? '70%' : '85%'}
                      h={16}
                      borderRadius='$md'
                      bg='$backgroundLight300'
                      mb='$1'
                    />
                    {/* Snippet / description lines */}
                    <Box
                      w='95%'
                      h={11}
                      borderRadius='$sm'
                      bg='$backgroundLight100'
                    />
                    <Box
                      w={idx === 0 ? '60%' : '75%'}
                      h={11}
                      borderRadius='$sm'
                      bg='$backgroundLight100'
                    />
                  </VStack>

                  {/* Right thumbnail skeleton box */}
                  <Box
                    w={76}
                    h={76}
                    borderRadius='$xl'
                    bg='$backgroundLight200'
                  />
                </HStack>
              </Box>
            </HStack>
          ))}
        </VStack>
      </Animated.View>
    </VStack>
  );
};
