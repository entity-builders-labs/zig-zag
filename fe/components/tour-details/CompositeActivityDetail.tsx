import React, { useMemo } from 'react';
import { ScrollView } from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Icon,
} from '@gluestack-ui/themed';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Map as MapView } from '../../features/map';
import {
  geoJsonBoundaryToPolygonParts,
  lineStringToCoordinates,
} from '../../features/map/geojson';
import { getRegionForCoordinates } from '../../features/map/utils';
import { ActivityDetail } from '../../api/activities';
import { ActivityKind } from '../../features/activities/composite';
import { FONT_DISPLAY } from '@/constants/typography';

const KIND_LABELS: Partial<Record<ActivityKind, string>> = {
  NEIGHBORHOOD_WALK: 'Caminata',
  ROUTE: 'Recorrido',
  EXPERIENCE: 'Experiencia',
};

// Mirrors be/prisma/schema.prisma's VariantTheme enum.
const THEME_LABELS: Record<string, string> = {
  HISTORY: 'Historia',
  ART: 'Arte',
  FOOD: 'Comida',
  NATURE: 'Naturaleza',
  ARCHITECTURE: 'Arquitectura',
  NIGHTLIFE: 'Vida nocturna',
  SHOPPING: 'Compras',
  FAMILY: 'Familia',
  TANGO: 'Tango',
  PHOTOGRAPHY: 'Fotografía',
  QUICK: 'Corta',
  DEEP_DIVE: 'A fondo',
};

// The full detail screen for a composite variant (walk/route/experience) —
// reached from a CompositeStopCard's "Ver recorrido completo" link. This is
// the variant's OWN page, not a specific tour's context, so it shows the
// variant's current waypoints (this activity's own compositeWaypoints, via
// GET /activities/:id) rather than any one tour's frozen snapshot.
export const CompositeActivityDetail = ({
  activity,
}: {
  activity: ActivityDetail;
}) => {
  const router = useRouter();
  const orderedWaypoints = useMemo(
    () => [...(activity.waypoints || [])].sort((a, b) => a.order - b.order),
    [activity.waypoints]
  );

  const isOwnRouteBoundary = activity.boundary?.type === 'LineString';
  const polygonParts = !isOwnRouteBoundary
    ? geoJsonBoundaryToPolygonParts(
        activity.boundary?.type === 'Polygon' ||
          activity.boundary?.type === 'MultiPolygon'
          ? activity.boundary
          : null
      )
    : [];
  const routeCoordinates = isOwnRouteBoundary
    ? lineStringToCoordinates(activity.boundary as any)
    : orderedWaypoints
        .map((w) => w.waypointActivity)
        .filter(
          (a): a is { id: string; name: string; latitude: number; longitude: number } =>
            a.latitude != null && a.longitude != null
        )
        .map((a) => ({ latitude: a.latitude, longitude: a.longitude }));

  const framingPoints =
    polygonParts.length > 0
      ? polygonParts.flatMap((p) => p.outer)
      : routeCoordinates;
  const mapRegion = getRegionForCoordinates(framingPoints);

  const kindLabel = KIND_LABELS[activity.kind as ActivityKind] || activity.kind;
  const themeLabel = activity.variantTheme
    ? THEME_LABELS[activity.variantTheme] || activity.variantTheme
    : undefined;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Box flex={1} bg='$backgroundLight50'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Box height={200} width='$full' position='relative'>
            {mapRegion ? (
              <MapView
                isStatic
                zoomable={false}
                initialRegion={mapRegion}
                instanceId={`activity-detail-${activity.id}`}
                markers={[]}
                routes={
                  polygonParts.length === 0 && routeCoordinates.length > 1
                    ? [{ coordinates: routeCoordinates }]
                    : []
                }
                polygons={polygonParts.map((p) => ({
                  coordinates: p.outer,
                  holes: p.holes,
                }))}
              />
            ) : (
              <Box flex={1} bg='$backgroundLight100' />
            )}
            <Box position='absolute' top={50} left={20} zIndex={10}>
              <Button
                size='sm'
                variant='solid'
                action='secondary'
                bg='rgba(255,255,255,0.85)'
                onPress={() => router.back()}
                borderRadius='$full'
                p='$2'
              >
                <Icon as={ArrowLeft} color='$secondary950' size='xl' />
              </Button>
            </Box>
          </Box>

          <VStack p='$4' space='sm'>
            <Heading size='xl' style={{ fontFamily: FONT_DISPLAY }}>
              {activity.name}
            </Heading>

            <HStack space='xs' flexWrap='wrap'>
              <Box
                bg='$tertiary50'
                borderRadius='$full'
                px='$3'
                py='$1'
              >
                <Text size='xs' fontWeight='$bold' color='$tertiary700'>
                  {kindLabel}
                </Text>
              </Box>
              {themeLabel && (
                <Box bg='$tertiary50' borderRadius='$full' px='$3' py='$1'>
                  <Text size='xs' fontWeight='$bold' color='$tertiary700'>
                    {themeLabel}
                  </Text>
                </Box>
              )}
            </HStack>

            {activity.description && (
              <VStack mt='$3' space='xs'>
                <Text
                  size='2xs'
                  fontWeight='$bold'
                  color='$textLight400'
                  textTransform='uppercase'
                  letterSpacing={1}
                >
                  Por qué recomendamos esto
                </Text>
                <Text size='sm' color='$textLight700' lineHeight='$sm'>
                  {activity.description}
                </Text>
              </VStack>
            )}

            {orderedWaypoints.length > 0 && (
              <VStack mt='$4' space='sm'>
                <Text
                  size='2xs'
                  fontWeight='$bold'
                  color='$textLight400'
                  textTransform='uppercase'
                  letterSpacing={1}
                >
                  Recorrido
                </Text>
                {orderedWaypoints.map((w, index) => (
                  <HStack
                    key={w.waypointActivity.id}
                    space='sm'
                    alignItems='center'
                  >
                    <Box
                      width={22}
                      height={22}
                      borderRadius='$full'
                      bg='$tertiary500'
                      alignItems='center'
                      justifyContent='center'
                    >
                      <Text size='2xs' fontWeight='$bold' color='$white'>
                        {index + 1}
                      </Text>
                    </Box>
                    <Text size='sm' color='$textLight800' flex={1}>
                      {w.waypointActivity.name}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            )}
          </VStack>
        </ScrollView>
      </Box>
    </>
  );
};
