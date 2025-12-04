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
  Spinner,
} from '@gluestack-ui/themed';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { fetchTourById, Tour } from '../../api/tours';
import { TourHeader } from '../../components/tour-details/TourHeader';
import { QuickStatsBar } from '../../components/tour-details/QuickStatsBar';
import { SmartConnector } from '../../components/tour-details/SmartConnector';
import { TourStopCard } from '../../components/tour-details/TourStopCard';
import { DayHeader } from '../../components/tour-details/DayHeader';
import { getImage, getBadges } from '../../components/tour-details/utils';
import { TourStop } from '../../components/tour-details/types';

// Helper function to transform activities to stops, grouping by day if needed
function transformActivitiesToStops(
  activities: Tour['activities'],
  totalDays?: number
): TourStop[] {
  if (!activities || activities.length === 0) {
    return [];
  }

  const shouldGroupByDay =
    totalDays !== undefined && totalDays !== null && totalDays > 1;

  // Check if we have dayNumber in activities
  const hasDayNumbers = activities.some(
    (item) => item.dayNumber !== undefined && item.dayNumber !== null
  );

  // If we shouldn't group by day or don't have day numbers, use original behavior
  if (!shouldGroupByDay || !hasDayNumbers) {
    const transformedStops: TourStop[] = [];
    activities.forEach((item, index) => {
      const activity = item.activity;
      const activityId = activity?.id || `inline-${index}`;
      const activityName =
        activity?.name || item.activityName || 'Unknown Activity';
      const activityPhotos = activity?.photos;
      const activityDescription = activity?.description || item.notes;

      if (!activityName) return;

      transformedStops.push({
        type: 'location',
        id: activityId,
        title: activityName,
        image: getImage(activityPhotos),
        description: activityDescription,
        badges: getBadges(activity || { type: item.activityType }),
      });

      if (index < activities.length - 1) {
        const duration = item.travelTimeToNext
          ? `${Math.round(item.travelTimeToNext)} min`
          : '10 min';

        transformedStops.push({
          type: 'transport',
          id: `t-${index}`,
          mode: 'walk',
          label: 'Caminata',
          duration: duration,
        });
      }
    });
    return transformedStops;
  }

  // Group by day
  const stops: TourStop[] = [];
  const activitiesByDay = new Map<number, typeof activities>();
  const activitiesWithoutDay: typeof activities = [];

  // Separate activities with and without dayNumber
  activities.forEach((item) => {
    if (item.dayNumber !== undefined && item.dayNumber !== null) {
      const dayNumber = item.dayNumber;
      if (!activitiesByDay.has(dayNumber)) {
        activitiesByDay.set(dayNumber, []);
      }
      activitiesByDay.get(dayNumber)!.push(item);
    } else {
      activitiesWithoutDay.push(item);
    }
  });

  // Helper function to add activities for a day
  const addActivitiesForDay = (
    dayActivities: typeof activities,
    dayNumber: number | null,
    dayLabel: string,
  ) => {
    dayActivities.forEach((item, index) => {
      const activity = item.activity;
      const activityId =
        activity?.id || `inline-${dayNumber ?? 'extra'}-${index}`;
      const activityName =
        activity?.name || item.activityName || 'Unknown Activity';
      const activityPhotos = activity?.photos;
      const activityDescription = activity?.description || item.notes;

      if (!activityName) return;

      stops.push({
        type: 'location',
        id: activityId,
        title: activityName,
        image: getImage(activityPhotos),
        description: activityDescription,
        badges: getBadges(activity || { type: item.activityType }),
      });

      // Add transport only if not last activity of the day
      if (index < dayActivities.length - 1) {
        const duration = item.travelTimeToNext
          ? `${Math.round(item.travelTimeToNext)} min`
          : '10 min';

        stops.push({
          type: 'transport',
          id: `t-${dayNumber ?? 'extra'}-${index}`,
          mode: 'walk',
          label: 'Caminata',
          duration: duration,
        });
      }
    });
  };

  // Sort days and add activities with dayNumber
  const sortedDays = Array.from(activitiesByDay.keys()).sort((a, b) => a - b);

  sortedDays.forEach((dayNumber) => {
    const dayActivities = activitiesByDay.get(dayNumber)!;

    // Add day header
    stops.push({
      type: 'day-header',
      id: `day-${dayNumber}`,
      dayNumber: dayNumber,
      title: `Día ${dayNumber}`,
    });

    // Add activities for this day
    addActivitiesForDay(dayActivities, dayNumber, `Día ${dayNumber}`);
  });

  // Add activities without dayNumber at the end
  if (activitiesWithoutDay.length > 0) {
    // Optionally add a header for activities without day
    // For now, we'll add them without a header, but they'll be at the end
    addActivitiesForDay(activitiesWithoutDay, null, 'Actividades adicionales');
  }

  return stops;
}

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tour, setTour] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<TourStop[]>([]);
  const [isGeneratingActivities, setIsGeneratingActivities] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string>('');

  useEffect(() => {
    const loadTour = async () => {
      if (!id) return;
      console.log('$$$ id:', id);
      try {
        setLoading(true);
        const data = await fetchTourById(id);
        console.log('$$$ data:', data);
        setTour(data);

        // Check generation status
        const metadata = data.metadata as any;
        const generationStatus = metadata?.generationStatus;
        const activities = data.activities || [];

        // Only show loading if status is generating/pending AND no activities yet
        // If activities exist, even if status is still generating, show them
        setIsGeneratingActivities(
          (generationStatus === 'generating' ||
            generationStatus === 'pending') &&
            activities.length === 0
        );
        setGenerationMessage(metadata?.generationMessage || '');

        // Transform activities to stops (with day grouping if needed)
        const transformedStops = transformActivitiesToStops(
          activities,
          data.totalDays
        );
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

  // Poll for updates if activities are being generated
  useEffect(() => {
    if (!id) return;

    const pollInterval = setInterval(async () => {
      try {
        const data = await fetchTourById(id);
        const metadata = data.metadata as any;
        const generationStatus = metadata?.generationStatus;
        const activities = data.activities || [];

        // Update generation status
        const stillGenerating =
          (generationStatus === 'generating' ||
            generationStatus === 'pending') &&
          activities.length === 0;
        setIsGeneratingActivities(stillGenerating);
        setGenerationMessage(metadata?.generationMessage || '');

        // If we have activities or generation completed, update the tour data
        if (activities.length > 0 || generationStatus === 'completed') {
          setTour(data);
          // Transform activities (with day grouping if needed)
          const transformedStops = transformActivitiesToStops(
            activities,
            data.totalDays
          );
          setStops(transformedStops);
        }
      } catch (error) {
        console.error('Failed to poll tour status:', error);
      }
    }, 3000); // Poll every 3 seconds

    return () => {
      clearInterval(pollInterval);
    };
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

            {isGeneratingActivities ? (
              <Box
                p='$8'
                alignItems='center'
                justifyContent='center'
                bg='$backgroundLight100'
                borderRadius='$md'
              >
                <Spinner size='large' color='$primary500' mb='$4' />
                <Text
                  color='$textLight600'
                  textAlign='center'
                  fontWeight='$medium'
                  mb='$2'
                >
                  {generationMessage || 'Generando actividades para tu tour...'}
                </Text>
                <Text size='sm' color='$textLight500' textAlign='center'>
                  Esto puede tomar unos momentos
                </Text>
              </Box>
            ) : stops.length === 0 ? (
              <Box
                p='$8'
                alignItems='center'
                justifyContent='center'
                bg='$backgroundLight100'
                borderRadius='$md'
              >
                <Text color='$textLight600' textAlign='center'>
                  No hay actividades disponibles para este tour
                </Text>
              </Box>
            ) : (
              <VStack>
                {stops.map((item, index) => {
                  if (item.type === 'location') {
                    // Find if this is the last location stop (not counting day headers)
                    const locationStops = stops.filter(
                      (s) => s.type === 'location'
                    );
                    const isLastLocation =
                      locationStops[locationStops.length - 1]?.id === item.id;
                    return (
                      <TourStopCard
                        key={item.id}
                        data={item}
                        isLast={isLastLocation}
                      />
                    );
                  } else if (item.type === 'day-header') {
                    return <DayHeader key={item.id} data={item} />;
                  } else {
                    return <SmartConnector key={item.id} data={item} />;
                  }
                })}
              </VStack>
            )}
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
