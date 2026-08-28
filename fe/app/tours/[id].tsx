import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, ActivityIndicator } from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Button,
  ButtonText,
  Icon,
  Text,
  Spinner,
  Pressable,
} from '@gluestack-ui/themed';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, MapPin, Footprints } from 'lucide-react-native';
import { fetchTourById, Tour } from '../../api/tours';
import { TourHeader } from '../../components/tour-details/TourHeader';
import { QuickStatsBar } from '../../components/tour-details/QuickStatsBar';
import { SmartConnector } from '../../components/tour-details/SmartConnector';
import { TourStopCard } from '../../components/tour-details/TourStopCard';
import { CompositeStopCard } from '../../components/tour-details/CompositeStopCard';
import { DayHeader } from '../../components/tour-details/DayHeader';
import { GenerationPipeline } from '../../components/tour-details/GenerationPipeline';
import { GenerationBitacora } from '../../components/tour-details/GenerationBitacora';
import { TourStop } from '../../components/tour-details/types';
import { transformActivitiesToStops } from '../../components/tour-details/build-stops';
import { FONT_DISPLAY } from '@/constants/typography';

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tour, setTour] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<TourStop[]>([]);
  const [isGeneratingActivities, setIsGeneratingActivities] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string>('');
  const [generationError, setGenerationError] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [showBitacora, setShowBitacora] = useState(false);

  // Whether THIS mount actually watched generation go from in-progress to
  // completed (as opposed to loading an already-completed tour straight
  // away, e.g. reopening it later from the tours list) — only in the former
  // case do we redirect into the pre-confirmation review screen, and only
  // once per mount.
  const wasGeneratingOnLoadRef = useRef(false);
  const redirectedToReviewRef = useRef(false);

  useEffect(() => {
    const loadTour = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await fetchTourById(id);
        setTour(data);

        // Check generation status
        const metadata = data.metadata as any;
        const generationStatus = metadata?.generationStatus;
        const activities = data.activities || [];

        // Only show loading if status is generating/pending AND no activities yet
        // If activities exist, even if status is still generating, show them
        const stillGenerating =
          (generationStatus === 'generating' ||
            generationStatus === 'pending') &&
          activities.length === 0;
        setIsGeneratingActivities(stillGenerating);
        wasGeneratingOnLoadRef.current = stillGenerating;
        setGenerationMessage(metadata?.generationMessage || '');
        setGenerationError(
          generationStatus === 'failed' ? metadata?.generationError || '' : ''
        );

        // Transform activities to stops (with day grouping if needed)
        const transformedStops = transformActivitiesToStops(
          activities,
          data.totalDays
        );
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

        // Still actively generating means: backend reports generating/pending
        // AND we don't have activities yet.
        const stillGenerating =
          (generationStatus === 'generating' ||
            generationStatus === 'pending') &&
          activities.length === 0;
        setIsGeneratingActivities(stillGenerating);
        setGenerationMessage(metadata?.generationMessage || '');
        setGenerationError(
          generationStatus === 'failed' ? metadata?.generationError || '' : ''
        );

        // If we have activities or generation completed, update the tour data
        if (activities.length > 0) {
          setTour(data);
          // Transform activities (with day grouping if needed)
          const transformedStops = transformActivitiesToStops(
            activities,
            data.totalDays
          );
          setStops(transformedStops);

          // If the tour JUST finished generating in this session (we saw it
          // while it was pending and now it has activities), steer the user
          // to the pre-confirmation review screen so they can review,
          // customize waypoint exclusions on composite stops, and confirm.
          if (
            wasGeneratingOnLoadRef.current &&
            !redirectedToReviewRef.current &&
            generationStatus !== 'generating' &&
            generationStatus !== 'pending'
          ) {
            redirectedToReviewRef.current = true;
            router.replace(`/tours/${id}/review`);
          }
        }

        // Stop polling once generation is no longer in progress — nothing
        // left to wait for, whether it succeeded, failed, or was never
        // triggered (e.g. a manually created tour with no generation flow).
        if (
          generationStatus !== 'generating' &&
          generationStatus !== 'pending'
        ) {
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => {
      clearInterval(pollInterval);
    };
  }, [id, router]);

  if (loading) {
    return (
      <Box
        flex={1}
        bg='$backgroundLight50'
        justifyContent='center'
        alignItems='center'
      >
        <ActivityIndicator size='large' color='#C89B3C' />
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
        p='$6'
      >
        <VStack space='md' alignItems='center'>
          <Text size='4xl'>🗺️</Text>
          <Heading size='md' color='$textLight900' style={{ fontFamily: FONT_DISPLAY }}>
            No pudimos encontrar este recorrido
          </Heading>
          <Text size='sm' color='$textLight500' textAlign='center'>
            El tour puede haber sido eliminado o no tenés permisos para verlo.
          </Text>
          <Button
            mt='$4'
            bg='$primary500'
            borderRadius='$2xl'
            onPress={() => router.push('/(tabs)/saved')}
          >
            <ButtonText color='$white' fontWeight='$bold'>
              Volver a Guardados
            </ButtonText>
          </Button>
        </VStack>
      </Box>
    );
  }

  const stopCount = stops.filter(
    (s) => s.type === 'location' || s.type === 'composite'
  ).length;

  let currentStopCounter = 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <Box flex={1} bg='$backgroundLight100' alignItems='center'>
        <Box
          w='$full'
          maxW={560}
          flex={1}
          bg='$backgroundLight50'
          position='relative'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.06}
          shadowRadius={16}
          elevation={4}
        >
          {/* Sticky Top Segmented Control (Itinerario vs Mapa de Ruta) */}
          <Box
            px='$4'
            py='$2.5'
            bg='$white'
            borderBottomWidth={1}
            borderBottomColor='$borderLight100'
            zIndex={20}
          >
            <HStack
              bg='$backgroundLight100'
              p='$1'
              borderRadius='$2xl'
              alignItems='center'
            >
              <Pressable
                flex={1}
                py='$2'
                borderRadius='$xl'
                bg={viewMode === 'list' ? '$white' : 'transparent'}
                shadowColor={viewMode === 'list' ? '$black' : 'transparent'}
                shadowOffset={{ width: 0, height: 1 }}
                shadowOpacity={viewMode === 'list' ? 0.08 : 0}
                shadowRadius={3}
                elevation={viewMode === 'list' ? 2 : 0}
                onPress={() => setViewMode('list')}
                testID='view-toggle-list'
              >
                <HStack space='xs' justifyContent='center' alignItems='center'>
                  <Icon
                    as={Footprints}
                    size='xs'
                    color={viewMode === 'list' ? '$primary600' : '$textLight500'}
                  />
                  <Text
                    size='xs'
                    fontWeight='$bold'
                    color={viewMode === 'list' ? '$textLight900' : '$textLight500'}
                  >
                    Itinerario ({stopCount} paradas)
                  </Text>
                </HStack>
              </Pressable>

              <Pressable
                flex={1}
                py='$2'
                borderRadius='$xl'
                bg={viewMode === 'map' ? '$white' : 'transparent'}
                shadowColor={viewMode === 'map' ? '$black' : 'transparent'}
                shadowOffset={{ width: 0, height: 1 }}
                shadowOpacity={viewMode === 'map' ? 0.08 : 0}
                shadowRadius={3}
                elevation={viewMode === 'map' ? 2 : 0}
                onPress={() => setViewMode('map')}
                testID='view-toggle-map'
              >
                <HStack space='xs' justifyContent='center' alignItems='center'>
                  <Icon
                    as={MapPin}
                    size='xs'
                    color={viewMode === 'map' ? '$primary600' : '$textLight500'}
                  />
                  <Text
                    size='xs'
                    fontWeight='$bold'
                    color={viewMode === 'map' ? '$textLight900' : '$textLight500'}
                  >
                    Mapa de Ruta 🗺️
                  </Text>
                </HStack>
              </Pressable>
            </HStack>
          </Box>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 110 }}
          >
            <TourHeader tour={tour} expanded={viewMode === 'map'} />

            {viewMode === 'list' && (
              <Box position='relative' zIndex={10}>
                <QuickStatsBar tour={tour} />
              </Box>
            )}

            <VStack mt={viewMode === 'map' ? '$4' : '$6'} px='$4'>
              {/* Dev-only, inline accordion for the generation bitácora */}
              {__DEV__ && (tour.metadata as any)?.generationTrace && (
                <Box mb='$4'>
                  <Pressable
                    onPress={() => setShowBitacora((v) => !v)}
                    testID='bitacora-toggle'
                  >
                    <HStack alignItems='center' space='xs'>
                      <Text size='xs' color='$tertiary600'>
                        🐛 Bitácora de generación (dev)
                      </Text>
                      <Icon
                        as={showBitacora ? ChevronUp : ChevronDown}
                        size='xs'
                        color='$tertiary600'
                      />
                    </HStack>
                  </Pressable>
                  {showBitacora && (
                    <GenerationBitacora
                      trace={(tour.metadata as any).generationTrace}
                    />
                  )}
                </Box>
              )}

              {isGeneratingActivities ? (
                <Box
                  p='$8'
                  alignItems='center'
                  justifyContent='center'
                  bg='$white'
                  borderRadius='$2xl'
                  borderWidth={1}
                  borderColor='$borderLight100'
                >
                  <Spinner size='large' color='$primary500' mb='$4' />
                  <Heading
                    size='sm'
                    color='$textLight900'
                    textAlign='center'
                    style={{ fontFamily: FONT_DISPLAY }}
                    mb='$1'
                  >
                    Armando tu recorrido
                  </Heading>
                  <Text
                    color='$textLight600'
                    textAlign='center'
                    fontWeight='$medium'
                    mb='$1'
                  >
                    Buscando lugares y relatos de tu destino
                  </Text>
                  <GenerationPipeline message={generationMessage} />
                </Box>
              ) : generationError ? (
                <Box
                  p='$8'
                  alignItems='center'
                  justifyContent='center'
                  bg='$white'
                  borderRadius='$2xl'
                  borderWidth={1}
                  borderColor='$borderLight100'
                >
                  <Text
                    color='$error600'
                    textAlign='center'
                    fontWeight='$medium'
                    mb='$2'
                  >
                    No pudimos generar este tour
                  </Text>
                  <Text size='sm' color='$textLight600' textAlign='center'>
                    {generationError}
                  </Text>
                </Box>
              ) : stops.length === 0 ? (
                <Box
                  p='$8'
                  alignItems='center'
                  justifyContent='center'
                  bg='$white'
                  borderRadius='$2xl'
                  borderWidth={1}
                  borderColor='$borderLight100'
                >
                  <Text color='$textLight600' textAlign='center'>
                    No hay actividades disponibles para este tour
                  </Text>
                </Box>
              ) : viewMode === 'map' ? (
                <VStack space='sm'>
                  <Text size='xs' color='$textLight500' fontWeight='$semibold' mb='$2'>
                    Paradas de este recorrido marcadas en el mapa:
                  </Text>
                  {(() => {
                    let counter = 0;
                    return stops.map((item) => {
                      if (item.type === 'location' || item.type === 'composite') {
                        counter++;
                        const stopItems = stops.filter(
                          (s) => s.type === 'location' || s.type === 'composite'
                        );
                        const isLastStop =
                          stopItems[stopItems.length - 1]?.id === item.id;
                        return item.type === 'composite' ? (
                          <CompositeStopCard
                            key={item.id}
                            data={item}
                            isLast={isLastStop}
                            stopNumber={counter}
                          />
                        ) : (
                          <TourStopCard
                            key={item.id}
                            data={item}
                            isLast={isLastStop}
                            stopNumber={counter}
                          />
                        );
                      }
                      return null;
                    });
                  })()}
                </VStack>
              ) : (
                <VStack>
                  {(() => {
                    let counter = 0;
                    return stops.map((item) => {
                      if (item.type === 'location' || item.type === 'composite') {
                        counter++;
                        const stopItems = stops.filter(
                          (s) => s.type === 'location' || s.type === 'composite'
                        );
                        const isLastStop =
                          stopItems[stopItems.length - 1]?.id === item.id;
                        return item.type === 'composite' ? (
                          <CompositeStopCard
                            key={item.id}
                            data={item}
                            isLast={isLastStop}
                            stopNumber={counter}
                          />
                        ) : (
                          <TourStopCard
                            key={item.id}
                            data={item}
                            isLast={isLastStop}
                            stopNumber={counter}
                          />
                        );
                      } else if (item.type === 'day-header') {
                        return <DayHeader key={item.id} data={item} />;
                      } else {
                        return <SmartConnector key={item.id} data={item} />;
                      }
                    });
                  })()}
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
            bg='rgba(255, 255, 255, 0.95)'
            borderTopWidth={1}
            borderTopColor='$borderLight100'
          >
            <Button
              size='lg'
              variant='solid'
              action='primary'
              bg='$primary500'
              borderRadius='$2xl'
              shadowColor='$primary500'
              shadowOffset={{ width: 0, height: 4 }}
              shadowOpacity={0.3}
              shadowRadius={8}
              elevation={5}
              h={52}
            >
              <ButtonText color='$white' fontWeight='$bold' size='md'>
                Comenzar Recorrido a Pie
              </ButtonText>
              <Icon as={MapPin} color='$white' ml='$2' />
            </Button>
          </Box>
        </Box>
      </Box>
    </>
  );
}
