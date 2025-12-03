import React, { useEffect, useState } from 'react';
import {
  VStack,
  Heading,
  ScrollView,
  Box,
  HStack,
  Image,
  Icon,
  Text,
  Spinner,
  Pressable,
} from '@gluestack-ui/themed';
import { MapPin, ChevronRight } from 'lucide-react-native';
import { Link } from 'expo-router';
import { useMap } from '../../context/app';
import { fetchNearbyTours, Tour } from '../../api/tours';

const DEFAULT_MAP_IMAGE =
  'https://images.unsplash.com/photo-1569336415962-a4bd9f69cd83?q=80&w=1000&auto=format&fit=crop';
const DEFAULT_THUMB_1 =
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=200&auto=format&fit=crop';
const DEFAULT_THUMB_2 =
  'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?q=80&w=200&auto=format&fit=crop';

interface RoutesSectionProps {
  category?: string;
  categoryTitle?: string;
}

export const RoutesSection = ({
  category = 'walking',
  categoryTitle = 'Rutas a pie cercanas',
}: RoutesSectionProps) => {
  const { center } = useMap();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadTours = async () => {
      if (!center) return;

      setLoading(true);
      try {
        const fetchedTours = await fetchNearbyTours(
          center.lat,
          center.lng,
          category
        );
        if (fetchedTours && fetchedTours.length > 0) {
          setTours(fetchedTours);
        }
      } catch (error) {
        console.error('Failed to fetch tours:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTours();
  }, [center, category]);

  // If loading, maybe show a spinner or skeleton (keeping it simple for now)

  // Helper to get images safely
  const getTourImages = (tour: Tour) => {
    const activities = tour.activities || [];

    // Try to get photos from first two activities
    const img1 = activities[0]?.activity?.photos?.[0]
      ? typeof activities[0].activity.photos[0] === 'string'
        ? activities[0].activity.photos[0]
        : activities[0].activity.photos[0].url
      : DEFAULT_THUMB_1;

    const img2 = activities[1]?.activity?.photos?.[0]
      ? typeof activities[1].activity.photos[0] === 'string'
        ? activities[1].activity.photos[0]
        : activities[1].activity.photos[0].url
      : DEFAULT_THUMB_2;

    return { map: DEFAULT_MAP_IMAGE, thumb1: img1, thumb2: img2 };
  };

  if (!tours.length && !loading) {
    // Fallback to hardcoded if no tours found (or show empty state)
    // For now, let's hide the section or show empty message if truly dynamic
    // But user might expect the hardcoded ones as fallback?
    // Let's keep the hardcoded ones ONLY if API fails or returns empty to avoid breaking UI during dev?
    // Actually, user wants to return tours from backend.
    // If loading, show spinner.
  }

  return (
    <VStack space='lg'>
      <HStack
        px='$4'
        justifyContent='space-between'
        alignItems='center'
        w='$full'
      >
        <Heading size='lg' color='#1A1A1A' flex={1}>
          {categoryTitle}
        </Heading>
        <Link href={`/tours?category=${encodeURIComponent(category)}`} asChild>
          <Pressable>
            <HStack space='xs' alignItems='center'>
              <Text size='sm' color='#2E4038' fontWeight='$medium'>
                Ver todo
              </Text>
              <Icon as={ChevronRight} size='sm' color='#2E4038' />
            </HStack>
          </Pressable>
        </Link>
      </HStack>

      {loading ? (
        <Box h={200} justifyContent='center' alignItems='center'>
          <Spinner size='large' />
        </Box>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 16, paddingHorizontal: 16 }}
        >
          {tours.map((tour) => {
            const images = getTourImages(tour);
            return (
              <Link href={`/tours/${tour.id}`} asChild>
                <Pressable>
                  <Box
                    key={tour.id}
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
                          source={{ uri: images.map }}
                          alt='Map Route'
                          w='$full'
                          h='$full'
                          resizeMode='cover'
                        />
                      </Box>
                      <VStack flex={1} borderLeftWidth={1} borderColor='$white'>
                        <Box
                          flex={1}
                          borderBottomWidth={1}
                          borderColor='$white'
                        >
                          <Image
                            source={{ uri: images.thumb1 }}
                            alt='Stop 1'
                            w='$full'
                            h='$full'
                            resizeMode='cover'
                          />
                        </Box>
                        <Box flex={1}>
                          <Image
                            source={{ uri: images.thumb2 }}
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
                        {tour.name}
                      </Heading>
                      <HStack space='sm' alignItems='center'>
                        <Icon as={MapPin} size='xs' color='#6B7280' />
                        <Text size='sm' color='#6B7280'>
                          {tour.activities?.length || 0} paradas •{' '}
                          {(tour.duration || 0).toFixed(1)} hrs
                        </Text>
                      </HStack>
                    </VStack>
                  </Box>
                </Pressable>
              </Link>
            );
          })}
        </ScrollView>
      )}
    </VStack>
  );
};
