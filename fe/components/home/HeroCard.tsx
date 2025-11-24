import React from 'react';
import { Box, Image, VStack, Text, Heading } from '@gluestack-ui/themed';

export const HeroCard = () => {
  return (
    <Box px='$4'>
      <Box
        height={450}
        rounded='$3xl'
        overflow='hidden'
        position='relative'
        bg='$backgroundDark900'
      >
        <Image
          source={{
            uri: 'https://images.unsplash.com/photo-1583478446437-76752a5a6372?q=80&w=1000&auto=format&fit=crop', // Palacio Barolo feel
          }}
          alt='Palacio Barolo'
          w='$full'
          h='$full'
          resizeMode='cover'
        />

        {/* Gradient Overlay Simulation */}
        <Box
          position='absolute'
          bottom={0}
          left={0}
          right={0}
          height={200}
          bg='$black'
          opacity={0.4}
        />

        {/* Content Overlay */}
        <VStack
          position='absolute'
          bottom={0}
          left={0}
          right={0}
          p='$6'
          space='xs'
        >
          <Text
            color='$white'
            fontSize='$sm'
            fontWeight='$medium'
            opacity={0.9}
          >
            Recomendado en tu zona:
          </Text>
          <Heading color='$white' size='xl' fontWeight='$bold'>
            Atardecer en el{'\n'}Palacio Barolo
          </Heading>
        </VStack>
      </Box>
    </Box>
  );
};

