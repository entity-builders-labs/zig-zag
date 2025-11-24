import React from 'react';
import { Box, Image, VStack, Text, Heading } from '@gluestack-ui/themed';

const HERO_CARD_IMAGE =
  'https://lh3.googleusercontent.com/gps-cs-s/AG0ilSzQp2oIICWexnmDApBuLjKa_BraOYa16ccgP86FaMFX3wE7OmsfW4N10nR1K8pQ1Bh33tiYMDxbCAhA_PIF1oFpRY56NJmrjerRIHuidg-oa9V7nT70ZY-IE8aQ-_6WdYavUR53HQ=s680-w680-h510-rw';

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
            uri: HERO_CARD_IMAGE,
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
