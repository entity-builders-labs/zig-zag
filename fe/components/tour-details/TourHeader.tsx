import React, { useEffect, useState } from 'react';
import { Dimensions } from 'react-native';
import { Map as MapView } from '../../features/map';
import { Marker as MapMarker } from '../../features/map/types';
import { getRegionForCoordinates } from '../../features/map/utils';
import { fetchWalkingRoute } from '../../features/map/directions';
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
  Spinner,
  Pressable,
  Text,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Tour } from '../../api/tours';
import { getImage } from './utils';
import { FONT_DISPLAY } from '@/constants/typography';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const COLLAPSED_HEIGHT = SCREEN_HEIGHT * 0.4;
const EXPANDED_HEIGHT = SCREEN_HEIGHT * 0.75;

interface StopWithLocation {
  latitude: number;
  longitude: number;
  title: string;
  order: number;
  dayNumber: number;
}

export const TourHeader = ({
  tour,
  expanded = false,
}: {
  tour: Tour;
  expanded?: boolean;
}) => {
  const router = useRouter();
  const firstActivity = tour.activities?.[0]?.activity;
  const imageUri = tour.coverImage || getImage(firstActivity?.photos);

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

  // All stops with resolvable coordinates, to plot the full itinerary
  // instead of a single pin at the tour's destination.
  const stops: StopWithLocation[] = (tour.activities || [])
    .map((stop) => {
      const latitude = stop.activity?.latitude ?? stop.activityLatitude;
      const longitude = stop.activity?.longitude ?? stop.activityLongitude;
      if (latitude == null || longitude == null) return null;
      return {
        latitude,
        longitude,
        title: stop.activity?.name || stop.activityName || 'Actividad',
        order: stop.order,
        dayNumber: stop.dayNumber ?? 1,
      };
    })
    .filter((stop): stop is StopWithLocation => stop !== null);

  // Multi-day tours mix every day's pins/route together unless narrowed down
  // to one day at a time — otherwise a 3-day tour shows a tangle of 15
  // stops with no way to tell which ones belong to which day.
  const availableDays = React.useMemo(
    () => Array.from(new Set(stops.map((stop) => stop.dayNumber))).sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tour.id, tour.activities]
  );
  const [selectedDay, setSelectedDay] = useState(1);
  const visibleStops = React.useMemo(
    () => stops.filter((stop) => stop.dayNumber === selectedDay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tour.id, tour.activities, selectedDay]
  );

  const stopMarkers: MapMarker[] = visibleStops.map((stop, index) => ({
    id: `stop-${index}`,
    coordinate: { latitude: stop.latitude, longitude: stop.longitude },
    title: stop.title,
    order: stop.order,
  }));

  const mapRegion = getRegionForCoordinates(
    visibleStops.length > 0 ? visibleStops : stops,
    firstLocation
  );
  const mapMarkers: MapMarker[] =
    stopMarkers.length > 0
      ? stopMarkers
      : firstLocation
        ? [{ id: 'tour-location', coordinate: firstLocation, title: tour.name }]
        : [];

  // One connected line for the selected day, starting from the tour's
  // destination point and passing through that day's stops in order.
  const straightRoutes = React.useMemo(() => {
    const orderedStops = [...visibleStops].sort((a, b) => a.order - b.order);
    const coordinates = firstLocation
      ? [firstLocation, ...orderedStops]
      : orderedStops;
    return coordinates.length > 1 ? [coordinates] : [];
    // tour.activities is included deliberately: when this header is shown
    // for a tour that's still generating (e.g. navigated to straight from
    // the wizard), activities starts at [] and arrives later via polling.
    // Keying only on tour.id meant this never recomputed once real stops
    // showed up — the route stayed empty forever for that render's tour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id, tour.activities, selectedDay]);

  const [routes, setRoutes] = useState<{ coordinates: typeof straightRoutes[number] }[]>(
    straightRoutes.map((coordinates) => ({ coordinates }))
  );
  const [loadingDirections, setLoadingDirections] = useState(false);

  // Fetch the real walking route regardless of collapsed/expanded — the
  // recorrido should be visible everywhere, not just once the map view is
  // opened.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [straightRoutes]);

  // Get tags from metadata or fallback to first activity type
  const tags =
    tour.metadata?.tags ||
    (firstActivity?.type
      ? [firstActivity.type]
      : tour.activities?.[0]?.activityType
        ? [tour.activities[0].activityType]
        : ['']);
  return (
    <Box
      height={expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT}
      width='$full'
      position='relative'
    >
      {/* Background Image or Static Map */}
      {mapRegion ? (
        <MapView
          isStatic
          zoomable={expanded}
          initialRegion={mapRegion}
          markers={mapMarkers}
          routes={routes}
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

      {loadingDirections && (
        <Box
          position='absolute'
          top={50}
          right={20}
          bg='rgba(255,255,255,0.9)'
          borderRadius='$full'
          p='$2'
        >
          <Spinner size='small' color='$primary500' />
        </Box>
      )}

      {/* Gradient overlay + full title/tags — only when collapsed, so it
          doesn't shade half of a map the user is trying to actually read */}
      {!expanded && (
        <Box
          position='absolute'
          bottom={0}
          left={0}
          right={0}
          height='50%'
          bg='$black'
          opacity={0.6}
        />
      )}

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

      {/* Day selector — only worth showing once expanded (room to interact)
          and only for multi-day tours (nothing to switch between otherwise) */}
      {expanded && availableDays.length > 1 && (
        <HStack
          position='absolute'
          top={50}
          left={0}
          right={0}
          justifyContent='center'
          space='sm'
          zIndex={10}
          // This row spans the full width at the same top offset as the back
          // button (left:20). Without box-none, the row's own empty space —
          // everywhere that isn't actually one of the day pills — swallows
          // clicks meant for whatever's underneath, including the back
          // button, since it ties the back button's zIndex and is declared
          // later in the tree (later wins the tie).
          pointerEvents='box-none'
        >
          {availableDays.map((day) => (
            <Pressable key={day} onPress={() => setSelectedDay(day)} testID={`tour-day-${day}`}>
              <Box
                px='$3'
                py='$1.5'
                borderRadius='$full'
                bg={day === selectedDay ? '$primary500' : 'rgba(255,255,255,0.9)'}
              >
                <Text
                  color={day === selectedDay ? '$white' : '$textLight800'}
                  fontWeight='$semibold'
                  size='sm'
                >
                  Día {day}
                </Text>
              </Box>
            </Pressable>
          ))}
        </HStack>
      )}

      {expanded ? (
        <Box
          position='absolute'
          bottom={0}
          left={0}
          right={0}
          bg='rgba(0,0,0,0.85)'
          px='$4'
          py='$3'
        >
          <Heading
            color='$white'
            size='md'
            fontWeight='$bold'
            numberOfLines={1}
            style={{ fontFamily: FONT_DISPLAY }}
          >
            {tour.name}
          </Heading>
        </Box>
      ) : (
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
          <Heading
            color='$white'
            size='3xl'
            fontWeight='$bold'
            mt='$2'
            style={{ fontFamily: FONT_DISPLAY }}
          >
            {tour.name}
          </Heading>
        </VStack>
      )}
    </Box>
  );
};
