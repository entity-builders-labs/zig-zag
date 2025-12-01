import React from 'react';
import { Dimensions } from 'react-native';
import { Map } from '../../features/map';
import {
  Box,
  Image,
  Button,
  Icon,
  VStack,
  HStack,
  Badge,
  BadgeText,
  Heading,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Tour } from '../../api/tours';
import { getImage } from './utils';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export const TourHeader = ({ tour }: { tour: Tour }) => {
  const router = useRouter();
  const firstActivity = tour.activities?.[0]?.activity;
  const imageUri = tour.coverImage || getImage(firstActivity?.photos);
  console.log('$$$ tour:', tour);

  const getFirstLocation = () => {
    if (tour.metadata?.options?.latitude && tour.metadata?.options?.longitude) {
      return {
        latitude: tour.metadata?.options?.latitude,
        longitude: tour.metadata.options.longitude,
      };
    } else if (firstActivity?.latitude && firstActivity?.longitude) {
      return {
        latitude: firstActivity.latitude,
        longitude: firstActivity.longitude,
      };
    }
  };

  const firstLocation = getFirstLocation();

  console.log('$$$ firstLocation 2:', firstLocation);
  // Get tags from metadata or fallback to first activity type
  const tags =
    tour.metadata?.tags ||
    (firstActivity?.type
      ? [firstActivity.type]
      : tour.activities?.[0]?.activityType
        ? [tour.activities[0].activityType]
        : ['']);
  return (
    <Box height={SCREEN_HEIGHT * 0.4} width='$full' position='relative'>
      {/* Background Image or Static Map */}
      {firstLocation ? (
        <Map
          isStatic
          initialRegion={{
            ...firstLocation,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }}
          markers={[
            {
              id: 'tour-location',
              coordinate: firstLocation,
              title: tour.name,
            },
          ]}
        />
      ) : (
        <Image
          source={{ uri: imageUri }}
          alt={tour.name}
          w='$full'
          h='$full'
          resizeMode='cover'
        />
      )}

      {/* Gradient Overlay (Simulated) */}
      <Box
        position='absolute'
        bottom={0}
        left={0}
        right={0}
        height='50%'
        bg='$black'
        opacity={0.6}
      />

      {/* Back Button */}
      <Box position='absolute' top={50} left={20} zIndex={10}>
        <Button
          size='sm'
          variant='solid'
          action='secondary'
          bg='rgba(255,255,255,0.2)'
          onPress={() => router.back()}
          borderRadius='$full'
          p='$2'
        >
          <Icon as={ArrowLeft} color='$white' size='xl' />
        </Button>
      </Box>

      {/* Title & Tags */}
      <VStack position='absolute' bottom={20} left={20} right={20} space='xs'>
        <HStack space='sm' flexWrap='wrap'>
          {tags.map((tag: string) => (
            <Badge
              key={tag}
              size='md'
              variant='solid'
              borderRadius='$full'
              action='info'
              bg='rgba(255,255,255,0.2)'
              borderColor='transparent'
            >
              <BadgeText color='$white' fontWeight='$medium'>
                {tag}
              </BadgeText>
            </Badge>
          ))}
        </HStack>
        <Heading color='$white' size='3xl' fontWeight='$bold' mt='$2'>
          {tour.name}
        </Heading>
      </VStack>
    </Box>
  );
};
