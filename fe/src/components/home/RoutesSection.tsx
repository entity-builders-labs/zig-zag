import React from 'react';
import { VStack, Heading, ScrollView, Box, HStack, Image, Icon, Text } from '@gluestack-ui/themed';
import { MapPin } from 'lucide-react-native';

const ROUTES = [
  {
    id: '1',
    title: 'Ruta de Cafés Notables',
    details: '3 paradas • 1.5 hrs',
    imageMap:
      'https://images.unsplash.com/photo-1569336415962-a4bd9f69cd83?q=80&w=1000&auto=format&fit=crop', // Map style image
    imageThumb1:
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=200&auto=format&fit=crop',
    imageThumb2:
      'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?q=80&w=200&auto=format&fit=crop',
  },
  {
    id: '2',
    title: 'Arquitectura Art Nouveau',
    details: '5 paradas • 2.0 hrs',
    imageMap:
      'https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=1000&auto=format&fit=crop',
    imageThumb1:
      'https://images.unsplash.com/photo-1541963463532-d68292c34b19?q=80&w=200&auto=format&fit=crop',
    imageThumb2:
      'https://images.unsplash.com/photo-1518391846015-55a9cc003b25?q=80&w=200&auto=format&fit=crop',
  },
];

export const RoutesSection = () => {
  return (
    <VStack space='lg'>
      <Heading px='$4' size='lg' color='#1A1A1A'>
        Rutas a pie cercanas
      </Heading>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 16, paddingHorizontal: 16 }}
      >
        {ROUTES.map((route) => (
          <Box
            key={route.id}
            w={300}
            bg='$white'
            rounded='$2xl'
            overflow='hidden'
            shadowColor='#000'
            shadowOffset={{ width: 0, height: 2 }}
            shadowOpacity={0.05}
            shadowRadius={8}
            elevation={2}
          >
            {/* Card Images */}
            <HStack h={180}>
              <Box flex={2} bg='$gray100'>
                <Image
                  source={{ uri: route.imageMap }}
                  alt='Map Route'
                  w='$full'
                  h='$full'
                  resizeMode='cover'
                />
              </Box>
              <VStack flex={1} borderLeftWidth={1} borderColor='$white'>
                <Box flex={1} borderBottomWidth={1} borderColor='$white'>
                  <Image
                    source={{ uri: route.imageThumb1 }}
                    alt='Stop 1'
                    w='$full'
                    h='$full'
                    resizeMode='cover'
                  />
                </Box>
                <Box flex={1}>
                  <Image
                    source={{ uri: route.imageThumb2 }}
                    alt='Stop 2'
                    w='$full'
                    h='$full'
                    resizeMode='cover'
                  />
                </Box>
              </VStack>
            </HStack>

            {/* Card Content */}
            <VStack p='$4' space='xs'>
              <Heading size='md' color='#1A1A1A'>
                {route.title}
              </Heading>
              <HStack space='sm' alignItems='center'>
                <Icon as={MapPin} size='xs' color='#6B7280' />
                <Text size='sm' color='#6B7280'>
                  {route.details}
                </Text>
              </HStack>
            </VStack>
          </Box>
        ))}
      </ScrollView>
    </VStack>
  );
};

