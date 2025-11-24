import React, { useEffect, useState } from 'react';
import { ScrollView, ActivityIndicator } from 'react-native';
import {
  Box,
  VStack,
  Heading,
  Button,
  ButtonText,
  Icon,
  Text,
} from '@gluestack-ui/themed';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { fetchTourById, Tour } from '../../api/tours';
import { TourHeader } from '../../components/tour-details/TourHeader';
import { QuickStatsBar } from '../../components/tour-details/QuickStatsBar';
import { SmartConnector } from '../../components/tour-details/SmartConnector';
import { TourStopCard } from '../../components/tour-details/TourStopCard';
import { getImage, getBadges } from '../../components/tour-details/utils';
import { TourStop } from '../../components/tour-details/types';

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tour, setTour] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<TourStop[]>([]);

  useEffect(() => {
    const loadTour = async () => {
      if (!id) return;
      console.log('$$$ id:', id);
      try {
        setLoading(true);
        const data = await fetchTourById(id);
        console.log('$$$ data:', data);
        setTour(data);

        // Transform activities to stops
        const transformedStops: TourStop[] = [];
        const activities = data.activities || [];

        activities.forEach((item, index) => {
          // Handle potentially null activity (if relation is missing but inline data exists)
          const activity = item.activity;
          const activityId = activity?.id || `inline-${index}`;
          const activityName =
            activity?.name || item.activityName || 'Unknown Activity';
          const activityPhotos = activity?.photos;
          const activityDescription = activity?.description || item.notes;

          // Only add if we have at least a name
          if (!activityName) return;

          // Add Location
          transformedStops.push({
            type: 'location',
            id: activityId,
            title: activityName,
            image: getImage(activityPhotos),
            description: activityDescription,
            badges: getBadges(activity || { type: item.activityType }),
          });

          // Add Transport if not last and we have info or just default
          if (index < activities.length - 1) {
            // Check if we have travel time info, otherwise generic walk
            const duration = item.travelTimeToNext
              ? `${Math.round(item.travelTimeToNext)} min`
              : '10 min'; // Default assumption

            transformedStops.push({
              type: 'transport',
              id: `t-${index}`,
              mode: 'walk',
              label: 'Caminata',
              duration: duration,
            });
          }
        });
        console.log('$$$ activities:', activities.length);
        setStops(transformedStops);
      } catch (error) {
        console.error('Failed to fetch tour:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTour();
  }, [id]);

  if (loading) {
    return (
      <Box
        flex={1}
        bg='$backgroundLight50'
        justifyContent='center'
        alignItems='center'
      >
        <ActivityIndicator size='large' color='#0000ff' />
      </Box>
    );
  }

  if (!tour) {
    return (
      <Box
        flex={1}
        bg='$backgroundLight50'
        justifyContent='center'
        alignItems='center'
      >
        <Text>Tour not found</Text>
      </Box>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <Box flex={1} bg='$backgroundLight50'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          <TourHeader tour={tour} />

          <Box position='relative' zIndex={10}>
            <QuickStatsBar tour={tour} />
          </Box>

          <VStack mt='$6' px='$4'>
            <Heading size='md' mb='$4' color='$textLight800'>
              Tu Recorrido
            </Heading>

            <VStack>
              {stops.map((item, index) => {
                if (item.type === 'location') {
                  return (
                    <TourStopCard
                      key={item.id}
                      data={item}
                      isLast={index === stops.length - 1}
                    />
                  );
                } else {
                  return <SmartConnector key={item.id} data={item} />;
                }
              })}
            </VStack>
          </VStack>
        </ScrollView>

        {/* Floating CTA */}
        <Box
          position='absolute'
          bottom={0}
          left={0}
          right={0}
          p='$4'
          bg='$white'
          borderTopWidth={1}
          borderTopColor='$borderLight100'
        >
          <Button
            size='lg'
            variant='solid'
            action='primary'
            borderRadius='$full'
            shadowColor='$primary500'
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.3}
            shadowRadius={8}
            elevation={5}
          >
            <ButtonText fontWeight='$bold'>Comenzar Recorrido</ButtonText>
            <Icon as={MapPin} color='$white' ml='$2' />
          </Button>
        </Box>
      </Box>
    </>
  );
}
