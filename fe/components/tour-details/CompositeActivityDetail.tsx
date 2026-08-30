import React, { useMemo, useState } from 'react';
import { ScrollView, Dimensions } from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Image,
  Button,
  Icon,
  Pressable,
} from '@gluestack-ui/themed';
import { Stack, useRouter } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  ChevronRight,
  Sparkles,
  Compass,
} from 'lucide-react-native';
import { Map as MapView } from '../../features/map';
import {
  geoJsonBoundaryToPolygonParts,
  lineStringToCoordinates,
} from '../../features/map/geojson';
import { getRegionForCoordinates } from '../../features/map/utils';
import { ActivityDetail } from '../../api/activities';
import { ActivityKind } from '../../features/activities/composite';
import { getPhotoGallery } from './utils';
import { FONT_DISPLAY } from '@/constants/typography';

const KIND_LABELS: Partial<Record<ActivityKind, string>> = {
  NEIGHBORHOOD_WALK: 'Caminata de Barrio',
  ROUTE: 'Ruta Temática',
  EXPERIENCE: 'Experiencia',
};

const THEME_LABELS: Record<string, string> = {
  HISTORY: 'Historia',
  ART: 'Arte y Murales',
  FOOD: 'Gastronomía',
  NATURE: 'Naturaleza',
  ARCHITECTURE: 'Arquitectura',
  NIGHTLIFE: 'Vida Nocturna',
  SHOPPING: 'Compras',
  FAMILY: 'Familiar',
  TANGO: 'Tango',
  PHOTOGRAPHY: 'Fotografía',
  QUICK: 'Paseo Corto',
  DEEP_DIVE: 'Exploración a Fondo',
};

export const CompositeActivityDetail = ({
  activity,
}: {
  activity: ActivityDetail;
}) => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'map' | 'photos'>('photos');
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const orderedWaypoints = useMemo(
    () => [...(activity.waypoints || [])].sort((a, b) => a.order - b.order),
    [activity.waypoints]
  );

  const gallery = useMemo(() => {
    // If activity itself has photos, use them
    if (activity.photos && activity.photos.length > 0) {
      return getPhotoGallery(activity.photos, activity.type || 'walking');
    }
    // Otherwise gather all waypoint photos
    const waypointPhotos = orderedWaypoints.flatMap(
      (w) => w.waypointActivity?.photos || []
    );
    return getPhotoGallery(waypointPhotos, activity.type || 'walking');
  }, [activity.photos, orderedWaypoints, activity.type]);

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

  const screenWidth = Dimensions.get('window').width;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Box flex={1} bg='#F8FAFC'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Top Banner: Photo Gallery or Interactive Map */}
          <Box height={260} width='$full' position='relative' bg='$black'>
            {activeTab === 'photos' && gallery.length > 0 ? (
              <>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const offset = e.nativeEvent.contentOffset.x;
                    const index = Math.round(offset / screenWidth);
                    setActivePhotoIndex(index);
                  }}
                >
                  {gallery.map((photoUrl, index) => (
                    <Box
                      key={index}
                      width={screenWidth}
                      height={260}
                      position='relative'
                    >
                      <Image
                        source={{ uri: photoUrl }}
                        alt={activity.name}
                        w='$full'
                        h='$full'
                        resizeMode='cover'
                      />
                    </Box>
                  ))}
                </ScrollView>

                {/* Dots indicator */}
                {gallery.length > 1 && (
                  <HStack
                    position='absolute'
                    bottom={12}
                    left={0}
                    right={0}
                    justifyContent='center'
                    space='xs'
                  >
                    {gallery.map((_, idx) => (
                      <Box
                        key={idx}
                        w={activePhotoIndex === idx ? 16 : 6}
                        h={6}
                        rounded='$full'
                        bg={
                          activePhotoIndex === idx
                            ? '#F2994A'
                            : 'rgba(255,255,255,0.5)'
                        }
                      />
                    ))}
                  </HStack>
                )}
              </>
            ) : mapRegion ? (
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

            {/* Back Button */}
            <Box position='absolute' top={50} left={20} zIndex={10}>
              <Button
                size='sm'
                variant='solid'
                action='secondary'
                bg='rgba(255,255,255,0.9)'
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/(tabs)');
                  }
                }}
                borderRadius='$full'
                p='$2'
                testID='composite-back-button'
              >
                <Icon as={ArrowLeft} color='$secondary950' size='xl' />
              </Button>
            </Box>

            {/* Switch Map / Photos Tab */}
            {gallery.length > 0 && mapRegion && (
              <HStack
                position='absolute'
                top={50}
                right={20}
                zIndex={10}
                bg='rgba(0,0,0,0.6)'
                p='$1'
                rounded='$full'
                space='xs'
              >
                <Pressable
                  onPress={() => setActiveTab('photos')}
                  px='$2.5'
                  py='$1'
                  rounded='$full'
                  bg={activeTab === 'photos' ? '#F2994A' : 'transparent'}
                >
                  <Text
                    color='$white'
                    fontSize='$2xs'
                    fontWeight='$bold'
                  >
                    Fotos ({gallery.length})
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setActiveTab('map')}
                  px='$2.5'
                  py='$1'
                  rounded='$full'
                  bg={activeTab === 'map' ? '#F2994A' : 'transparent'}
                >
                  <Text
                    color='$white'
                    fontSize='$2xs'
                    fontWeight='$bold'
                  >
                    Mapa
                  </Text>
                </Pressable>
              </HStack>
            )}
          </Box>

          <VStack p='$4' space='md'>
            <Heading size='xl' style={{ fontFamily: FONT_DISPLAY }}>
              {activity.name}
            </Heading>

            <HStack space='xs' flexWrap='wrap'>
              <Box
                bg='$amber50'
                borderWidth={1}
                borderColor='$amber200'
                borderRadius='$full'
                px='$3'
                py='$1'
              >
                <Text size='xs' fontWeight='$bold' color='$amber800'>
                  🚶 {kindLabel}
                </Text>
              </Box>
              {themeLabel && (
                <Box
                  bg='$blue50'
                  borderWidth={1}
                  borderColor='$blue200'
                  borderRadius='$full'
                  px='$3'
                  py='$1'
                >
                  <Text size='xs' fontWeight='$bold' color='$blue800'>
                    ✨ {themeLabel}
                  </Text>
                </Box>
              )}
              {orderedWaypoints.length > 0 && (
                <Box
                  bg='$emerald50'
                  borderWidth={1}
                  borderColor='$emerald200'
                  borderRadius='$full'
                  px='$3'
                  py='$1'
                >
                  <Text size='xs' fontWeight='$bold' color='$emerald800'>
                    📍 {orderedWaypoints.length} paradas
                  </Text>
                </Box>
              )}
            </HStack>

            {activity.description && (
              <VStack mt='$2' space='xs'>
                <Text
                  size='2xs'
                  fontWeight='$bold'
                  color='$textLight400'
                  textTransform='uppercase'
                  letterSpacing={1}
                >
                  Sobre esta caminata
                </Text>
                <Text size='sm' color='$textLight700' lineHeight='$md'>
                  {activity.description}
                </Text>
              </VStack>
            )}

            {/* List of stops with real photos & navigation */}
            {orderedWaypoints.length > 0 && (
              <VStack mt='$3' space='sm'>
                <Text
                  size='2xs'
                  fontWeight='$bold'
                  color='$textLight400'
                  textTransform='uppercase'
                  letterSpacing={1}
                >
                  Itinerario del recorrido ({orderedWaypoints.length} paradas)
                </Text>
                {orderedWaypoints.map((w, index) => {
                  const wp = w.waypointActivity;
                  const wpPhoto = wp?.photos?.[0]?.thumbnail || wp?.photos?.[0]?.url;
                  return (
                    <Pressable
                      key={wp.id || index}
                      onPress={() => router.push(`/activities/${wp.id}` as any)}
                      bg='$white'
                      p='$3'
                      rounded='$xl'
                      borderWidth={1}
                      borderColor='$borderLight100'
                      shadowColor='$black'
                      shadowOffset={{ width: 0, height: 1 }}
                      shadowOpacity={0.05}
                      shadowRadius={3}
                    >
                      <HStack space='md' alignItems='center'>
                        {/* Number / Thumbnail */}
                        <Box position='relative'>
                          {wpPhoto ? (
                            <Image
                              source={{ uri: wpPhoto }}
                              alt={wp.name}
                              w={56}
                              h={56}
                              rounded='$lg'
                              resizeMode='cover'
                            />
                          ) : (
                            <Box
                              w={56}
                              h={56}
                              rounded='$lg'
                              bg='$amber100'
                              alignItems='center'
                              justifyContent='center'
                            >
                              <Compass size={24} color='#D97706' />
                            </Box>
                          )}
                          <Box
                            position='absolute'
                            top={-4}
                            left={-4}
                            w={20}
                            h={20}
                            rounded='$full'
                            bg='#F2994A'
                            alignItems='center'
                            justifyContent='center'
                            borderWidth={1.5}
                            borderColor='$white'
                          >
                            <Text size='2xs' fontWeight='$bold' color='$white'>
                              {index + 1}
                            </Text>
                          </Box>
                        </Box>

                        <VStack flex={1} space='2xs'>
                          <Text
                            size='sm'
                            fontWeight='$bold'
                            color='$textLight900'
                            numberOfLines={1}
                          >
                            {wp.name}
                          </Text>
                          {wp.type && (
                            <Text size='2xs' color='$textLight500'>
                              {wp.type}
                            </Text>
                          )}
                          {wp.formattedAddress && (
                            <Text
                              size='2xs'
                              color='$textLight400'
                              numberOfLines={1}
                            >
                              📍 {wp.formattedAddress}
                            </Text>
                          )}
                        </VStack>

                        <ChevronRight size={18} color='#94A3B8' />
                      </HStack>
                    </Pressable>
                  );
                })}
              </VStack>
            )}
          </VStack>
        </ScrollView>
      </Box>
    </>
  );
};
