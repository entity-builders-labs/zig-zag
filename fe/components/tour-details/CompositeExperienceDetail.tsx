import React, { useEffect, useMemo, useState } from 'react';
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
import { ArrowLeft, Compass } from 'lucide-react-native';
import { Map as MapView } from '../../features/map';
import { fetchWalkingRoute } from '../../features/map/directions';
import { getRegionForCoordinates } from '../../features/map/utils';
import { ExperienceDetail } from '../../api/experiences';
import { getPhotoGallery } from './utils';
import { FONT_DISPLAY } from '@/constants/typography';

// There is no structural `kind` on an Experience — this is a friendly label
// derived from its soft intent facets, purely presentational.
const INTENT_LABELS: Record<string, string> = {
  walk: 'Caminata de Barrio',
  route_like: 'Ruta Temática',
  visit: 'Visita',
  food: 'Gastronomía',
  nightlife: 'Vida Nocturna',
  day_trip: 'Escapada de un Día',
};

const THEME_LABELS: Record<string, string> = {
  history: 'Historia',
  art: 'Arte',
  food: 'Gastronomía',
  nature: 'Naturaleza',
  architecture: 'Arquitectura',
  nightlife: 'Vida Nocturna',
  tango: 'Tango',
  culture: 'Cultura',
};

export const CompositeExperienceDetail = ({
  experience,
}: {
  experience: ExperienceDetail;
}) => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'map' | 'photos'>('photos');
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const orderedComponents = useMemo(
    () =>
      [...experience.components].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      ),
    [experience.components]
  );

  const gallery = getPhotoGallery(experience.photos, experience.type);

  const componentCoordinates = orderedComponents
    .filter(
      (c): c is typeof c & { geoEntity: { latitude: number; longitude: number } } =>
        c.geoEntity.latitude != null && c.geoEntity.longitude != null
    )
    .map((c) => ({
      latitude: c.geoEntity.latitude,
      longitude: c.geoEntity.longitude,
    }));

  // Same pattern as CompositeStopCard: an Experience has no persisted
  // boundary/route geometry of its own today, so the walking path between
  // components is computed client-side — nothing to persist here.
  const [routeCoordinates, setRouteCoordinates] = useState(componentCoordinates);
  useEffect(() => {
    if (componentCoordinates.length < 2) return;
    let cancelled = false;
    fetchWalkingRoute(componentCoordinates).then((coordinates) => {
      if (!cancelled) setRouteCoordinates(coordinates);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedComponents.map((c) => c.geoEntityId).join(',')]);

  const mapRegion = getRegionForCoordinates(componentCoordinates);

  const intentLabel = (experience.intents ?? [])
    .map((intent) => INTENT_LABELS[intent])
    .find(Boolean);
  const themeLabel = (experience.themes ?? [])
    .map((theme) => THEME_LABELS[theme])
    .find(Boolean);

  const screenWidth = Dimensions.get('window').width;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Box flex={1} bg='#F8FAFC'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Box height={260} width='$full' position='relative' bg='$black'>
            {activeTab === 'photos' && gallery.length > 0 ? (
              <>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const offset = e.nativeEvent.contentOffset.x;
                    setActivePhotoIndex(Math.round(offset / screenWidth));
                  }}
                >
                  {gallery.map((photoUrl, index) => (
                    <Box key={index} width={screenWidth} height={260}>
                      <Image
                        source={{ uri: photoUrl }}
                        alt={experience.name}
                        w='$full'
                        h='$full'
                        resizeMode='cover'
                      />
                    </Box>
                  ))}
                </ScrollView>
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
                            ? '$tertiary500'
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
                instanceId={`experience-detail-${experience.id}`}
                markers={[]}
                routes={
                  routeCoordinates.length > 1 ? [{ coordinates: routeCoordinates }] : []
                }
                polygons={[]}
              />
            ) : (
              <Box flex={1} bg='$backgroundLight100' />
            )}

            <Box position='absolute' top={50} left={20} zIndex={10}>
              <Button
                size='sm'
                variant='solid'
                action='secondary'
                bg='rgba(255,255,255,0.9)'
                onPress={() => {
                  if (router.canGoBack()) router.back();
                  else router.replace('/(tabs)');
                }}
                borderRadius='$full'
                p='$2'
                testID='composite-experience-back-button'
              >
                <Icon as={ArrowLeft} color='$secondary950' size='xl' />
              </Button>
            </Box>

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
                  bg={activeTab === 'photos' ? '$tertiary500' : 'transparent'}
                >
                  <Text color='$white' fontSize='$2xs' fontWeight='$bold'>
                    Fotos ({gallery.length})
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setActiveTab('map')}
                  px='$2.5'
                  py='$1'
                  rounded='$full'
                  bg={activeTab === 'map' ? '$tertiary500' : 'transparent'}
                >
                  <Text color='$white' fontSize='$2xs' fontWeight='$bold'>
                    Mapa
                  </Text>
                </Pressable>
              </HStack>
            )}
          </Box>

          <VStack p='$4' space='md'>
            <Heading size='xl' style={{ fontFamily: FONT_DISPLAY }}>
              {experience.name}
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
                  🚶 {intentLabel || 'Experiencia de varias paradas'}
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
              {orderedComponents.length > 0 && (
                <Box
                  bg='$emerald50'
                  borderWidth={1}
                  borderColor='$emerald200'
                  borderRadius='$full'
                  px='$3'
                  py='$1'
                >
                  <Text size='xs' fontWeight='$bold' color='$emerald800'>
                    📍 {orderedComponents.length} paradas
                  </Text>
                </Box>
              )}
            </HStack>

            {experience.description && (
              <VStack mt='$2' space='xs'>
                <Text
                  size='2xs'
                  fontWeight='$bold'
                  color='$textLight400'
                  textTransform='uppercase'
                  letterSpacing={1}
                >
                  Sobre esta experiencia
                </Text>
                <Text size='sm' color='$textLight700' lineHeight='$md'>
                  {experience.description}
                </Text>
              </VStack>
            )}

            {orderedComponents.length > 0 && (
              <VStack mt='$3' space='sm'>
                <Text
                  size='2xs'
                  fontWeight='$bold'
                  color='$textLight400'
                  textTransform='uppercase'
                  letterSpacing={1}
                >
                  Itinerario ({orderedComponents.length} paradas)
                </Text>
                {orderedComponents.map((component, index) => (
                  <Box
                    key={component.geoEntityId || index}
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
                      <Box position='relative'>
                        <Box
                          w={44}
                          h={44}
                          rounded='$lg'
                          bg='$amber100'
                          alignItems='center'
                          justifyContent='center'
                        >
                          <Compass size={20} color='#D97706' />
                        </Box>
                        <Box
                          position='absolute'
                          top={-4}
                          left={-4}
                          w={20}
                          h={20}
                          rounded='$full'
                          bg='$tertiary500'
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
                      <VStack flex={1} space='xs'>
                        <Text
                          size='sm'
                          fontWeight='$bold'
                          color='$textLight900'
                          numberOfLines={1}
                        >
                          {component.geoEntity.name}
                        </Text>
                        {component.geoEntity.address && (
                          <Text size='2xs' color='$textLight400' numberOfLines={1}>
                            📍 {component.geoEntity.address}
                          </Text>
                        )}
                      </VStack>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            )}
          </VStack>
        </ScrollView>
      </Box>
    </>
  );
};
