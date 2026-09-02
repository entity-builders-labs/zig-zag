import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  ButtonText,
  Icon,
  Pressable,
  Image,
  Spinner,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Navigation, List } from 'lucide-react-native';
import { Tour } from '../../api/tours';
import { Map as MapView } from '../../features/map';
import { Marker as MapMarker } from '../../features/map/types';
import { getRegionForCoordinates } from '../../features/map/utils';
import { fetchWalkingRoute } from '../../features/map/directions';
import { getImage } from './utils';
import { FONT_DISPLAY } from '@/constants/typography';

interface StopWithLocation {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  order: number;
  dayNumber: number;
  image?: string;
  category?: string;
  travelTimeToNext?: number;
  activityId?: string;
}

export const TourMapView = ({
  tour,
  onSwitchToItinerary,
}: {
  tour: Tour;
  onSwitchToItinerary: () => void;
}) => {
  const router = useRouter();
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);

  const firstExperience = tour.experiences?.[0];
  const firstComponent = firstExperience?.components?.[0];
  const firstLocation = tour.metadata?.options?.latitude && tour.metadata?.options?.longitude
    ? {
        latitude: tour.metadata.options.latitude,
        longitude: tour.metadata.options.longitude,
      }
      : firstComponent?.latitude != null && firstComponent?.longitude != null
      ? {
          latitude: firstComponent.latitude,
          longitude: firstComponent.longitude,
        }
      : undefined;

  // Extract all stops with valid coordinates
  const stops: StopWithLocation[] = useMemo(() => {
    const source = tour.experiences?.length
      ? tour.experiences.flatMap((snapshot, index) => {
          const component = snapshot.components?.[0];
          if (!component || component.latitude == null || component.longitude == null) return [];
          return [{
            id: snapshot.id,
            activityId: snapshot.experienceId,
            latitude: component.latitude,
            longitude: component.longitude,
            title: snapshot.experience?.canonicalName || snapshot.experience?.name || 'Experiencia',
            order: snapshot.order ?? index,
            dayNumber: snapshot.dayNumber ?? 1,
            category: 'Experiencia',
            image: undefined,
            travelTimeToNext: undefined,
          }];
        })
      : [];
    return source
      .map((item, index): StopWithLocation | null => {
        const latitude = item.latitude;
        const longitude = item.longitude;
        if (latitude == null || longitude == null) return null;
        return {
          id: item.id || `stop-${index}`,
          activityId: item.activityId,
          latitude,
          longitude,
          title: item.title,
          order: item.order ?? index,
          dayNumber: item.dayNumber ?? 1,
          image: item.image,
          category: item.category,
          travelTimeToNext: item.travelTimeToNext,
        };
      })
      .filter((s): s is StopWithLocation => s !== null);
  }, [tour.experiences]);

  const availableDays = useMemo(
    () => Array.from(new Set(stops.map((stop) => stop.dayNumber))).sort((a, b) => a - b),
    [stops]
  );
  const [selectedDay, setSelectedDay] = useState(1);

  const visibleStops = useMemo(
    () => stops.filter((stop) => stop.dayNumber === selectedDay),
    [stops, selectedDay]
  );

  const mapMarkers: MapMarker[] = useMemo(() => {
    return visibleStops.map((stop, index) => ({
      id: stop.id,
      coordinate: { latitude: stop.latitude, longitude: stop.longitude },
      title: stop.title,
      order: index + 1,
      category: stop.category,
      selected: index === selectedStopIndex,
      onPress: () => setSelectedStopIndex(index),
    }));
  }, [visibleStops, selectedStopIndex]);

  const straightRoutes = useMemo(() => {
    const orderedStops = [...visibleStops].sort((a, b) => a.order - b.order);
    const coordinates = firstLocation
      ? [firstLocation, ...orderedStops]
      : orderedStops;
    return coordinates.length > 1 ? [coordinates] : [];
  }, [visibleStops, firstLocation]);

  const [routes, setRoutes] = useState<{ coordinates: typeof straightRoutes[number] }[]>(
    straightRoutes.map((coordinates) => ({ coordinates }))
  );
  const [loadingDirections, setLoadingDirections] = useState(false);

  useEffect(() => {
    if (straightRoutes.length === 0) {
      setRoutes([]);
      return;
    }

    let cancelled = false;
    setLoadingDirections(true);
    Promise.all(straightRoutes.map((coordinates) => fetchWalkingRoute(coordinates)))
      .then((resolvedRoutes) => {
        if (!cancelled) {
          setRoutes(resolvedRoutes.map((coordinates) => ({ coordinates })));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDirections(false);
      });

    return () => {
      cancelled = true;
    };
  }, [straightRoutes]);

  const mapRegion = useMemo(() => {
    return getRegionForCoordinates(
      visibleStops.length > 0 ? visibleStops : stops,
      firstLocation
    );
  }, [visibleStops, stops, firstLocation]);

  const currentStop = visibleStops[selectedStopIndex] || visibleStops[0];

  const handlePrevStop = () => {
    if (selectedStopIndex > 0) {
      setSelectedStopIndex(selectedStopIndex - 1);
    }
  };

  const handleNextStop = () => {
    if (selectedStopIndex < visibleStops.length - 1) {
      setSelectedStopIndex(selectedStopIndex + 1);
    }
  };

  return (
    <Box flex={1} position='relative' bg='$backgroundDark900'>
      {/* Interactive Map */}
      {mapRegion ? (
        <MapView
          isStatic={false}
          zoomable={true}
          initialRegion={mapRegion}
          markers={mapMarkers}
          routes={routes}
        />
      ) : (
        <Box flex={1} justifyContent='center' alignItems='center'>
          <Spinner size='large' color='$primary500' />
        </Box>
      )}

      {/* Floating Top Route Info Bar */}
      <Box
        position='absolute'
        top={12}
        left={16}
        right={16}
        bg='rgba(255, 255, 255, 0.95)'
        p='$3'
        borderRadius='$2xl'
        shadowColor='$black'
        shadowOffset={{ width: 0, height: 2 }}
        shadowOpacity={0.12}
        shadowRadius={8}
        elevation={4}
        borderWidth={1}
        borderColor='$borderLight100'
        zIndex={10}
      >
        <HStack justifyContent='space-between' alignItems='center'>
          <VStack>
            <Text size='2xs' fontWeight='$bold' color='$textLight500' textTransform='uppercase'>
              Ruta a pie trazada
            </Text>
            <Heading size='xs' color='$textLight900' fontWeight='$bold'>
              {tour.totalDistance ? `${tour.totalDistance.toFixed(1)} km total` : '2.4 km total'} • {visibleStops.length} paradas
            </Heading>
          </VStack>

          <Button
            size='xs'
            variant='outline'
            action='secondary'
            borderRadius='$xl'
            borderColor='$borderLight200'
            onPress={onSwitchToItinerary}
          >
            <Icon as={List} size='xs' color='$textLight700' mr='$1' />
            <ButtonText size='xs' fontWeight='$bold' color='$textLight700'>
              Ver Lista
            </ButtonText>
          </Button>
        </HStack>

        {/* Multi-day selector if available */}
        {availableDays.length > 1 && (
          <HStack space='xs' mt='$2' pt='$2' borderTopWidth={1} borderTopColor='$borderLight100'>
            {availableDays.map((day) => (
              <Pressable
                key={day}
                onPress={() => {
                  setSelectedDay(day);
                  setSelectedStopIndex(0);
                }}
              >
                <Box
                  px='$3'
                  py='$1'
                  borderRadius='$full'
                  bg={day === selectedDay ? '$primary500' : '$backgroundLight100'}
                >
                  <Text
                    size='2xs'
                    fontWeight='$bold'
                    color={day === selectedDay ? '$white' : '$textLight700'}
                  >
                    Día {day}
                  </Text>
                </Box>
              </Pressable>
            ))}
          </HStack>
        )}
      </Box>

      {/* Floating Bottom Stop Card Preview */}
      {currentStop && (
        <Box
          position='absolute'
          bottom={16}
          left={16}
          right={16}
          bg='$white'
          p='$4'
          borderRadius='$3xl'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.16}
          shadowRadius={12}
          elevation={6}
          borderWidth={1}
          borderColor='$borderLight100'
          zIndex={10}
        >
          <HStack space='md' alignItems='center'>
            <Image
              source={{ uri: currentStop.image }}
              alt={currentStop.title}
              w={64}
              h={64}
              borderRadius={16}
              resizeMode='cover'
            />

            <VStack flex={1}>
              <HStack justifyContent='space-between' alignItems='center'>
                <Box bg='$primary50' px='$2' py='$0.5' borderRadius='$md'>
                  <Text size='2xs' fontWeight='$bold' color='$primary700'>
                    Parada {selectedStopIndex + 1} de {visibleStops.length}
                  </Text>
                </Box>
                <HStack space='xs'>
                  <Pressable
                    disabled={selectedStopIndex === 0}
                    opacity={selectedStopIndex === 0 ? 0.3 : 1}
                    onPress={handlePrevStop}
                    p='$1'
                  >
                    <Icon as={ChevronLeft} size='sm' color='$textLight600' />
                  </Pressable>
                  <Pressable
                    disabled={selectedStopIndex === visibleStops.length - 1}
                    opacity={selectedStopIndex === visibleStops.length - 1 ? 0.3 : 1}
                    onPress={handleNextStop}
                    p='$1'
                  >
                    <Icon as={ChevronRight} size='sm' color='$textLight600' />
                  </Pressable>
                </HStack>
              </HStack>

              <Heading
                size='sm'
                numberOfLines={1}
                color='$textLight900'
                style={{ fontFamily: FONT_DISPLAY }}
                mt='$1'
              >
                {currentStop.title}
              </Heading>
              <Text size='xs' color='$textLight500' numberOfLines={1}>
                {currentStop.travelTimeToNext
                  ? `🚶 ${currentStop.travelTimeToNext} min caminando a la siguiente parada`
                  : 'Punto de interés destacado'}
              </Text>
            </VStack>
          </HStack>

          <Button
            mt='$3'
            h={44}
            size='sm'
            variant='solid'
            action='primary'
            bg='$primary500'
            borderRadius='$2xl'
            onPress={() => {
              if (currentStop.activityId && !currentStop.activityId.startsWith('inline-')) {
                router.push(`/activities/${currentStop.activityId}`);
              }
            }}
          >
            <Icon as={Navigation} size='xs' color='$white' mr='$1.5' />
            <ButtonText size='xs' fontWeight='$bold' color='$white'>
              Ver detalles de esta Parada
            </ButtonText>
          </Button>
        </Box>
      )}
    </Box>
  );
};
