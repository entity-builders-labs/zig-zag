import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronUp, MapPin, Footprints, ArrowLeft } from 'lucide-react-native';
import { fetchTourById, Tour } from '../../api/tours';
import { useSSE } from '../../api/hooks/useSSE';
import { TourHeader } from '../../components/tour-details/TourHeader';
import { TourMapView } from '../../components/tour-details/TourMapView';
import { QuickStatsBar } from '../../components/tour-details/QuickStatsBar';
import { SmartConnector } from '../../components/tour-details/SmartConnector';
import { TourStopCard } from '../../components/tour-details/TourStopCard';
import { CompositeStopCard } from '../../components/tour-details/CompositeStopCard';
import { DayHeader } from '../../components/tour-details/DayHeader';
import { GenerationPipeline } from '../../components/tour-details/GenerationPipeline';
import { ItinerarySkeleton } from '../../components/tour-details/ItinerarySkeleton';
import {
  formatGenerationBitacora,
  GenerationBitacora,
  GenerationTrace,
} from '../../components/tour-details/GenerationBitacora';
import { TourStop } from '../../components/tour-details/types';
import { transformExperiencesToStops } from '../../components/tour-details/build-stops';
import { FONT_DISPLAY } from '@/constants/typography';
import { copyTextToClipboard } from '@/utils/copy-to-clipboard';

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tour, setTour] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<TourStop[]>([]);
  const [isGeneratingExperiences, setIsGeneratingExperiences] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string>('');
  const [generationError, setGenerationError] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/saved');
    }
  };

  const generationTrace: GenerationTrace | null = useMemo(() => {
    if (!tour?.metadata) return null;
    let meta = tour.metadata;
    if (typeof meta === 'string') {
      try {
        meta = JSON.parse(meta);
      } catch {
        return null;
      }
    }
    return (meta as any)?.generationTrace ?? null;
  }, [tour?.metadata]);

  const [showBitacora, setShowBitacora] = useState(false);
  const [bitacoraCopyStatus, setBitacoraCopyStatus] = useState<
    'idle' | 'copied' | 'failed'
  >('idle');

  useEffect(() => {
    if (bitacoraCopyStatus === 'idle') return;
    const timeoutId = setTimeout(() => setBitacoraCopyStatus('idle'), 2000);
    return () => clearTimeout(timeoutId);
  }, [bitacoraCopyStatus]);

  const handleBitacoraPress = async () => {
    setShowBitacora((visible) => !visible);
    if (generationTrace) {
      try {
        await copyTextToClipboard(
          formatGenerationBitacora(generationTrace)
        );
        setBitacoraCopyStatus('copied');
      } catch {
        setBitacoraCopyStatus('failed');
      }
    }
  };

  // Whether THIS mount actually watched generation go from in-progress to
  // completed (as opposed to loading an already-completed tour straight
  // away, e.g. reopening it later from the tours list) — only in the former
  // case do we redirect into the pre-confirmation review screen, and only
  // once per mount.
  const wasGeneratingOnLoadRef = useRef(false);
  const redirectedToReviewRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<Tour> | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectAfterRefetchRef = useRef(false);

  const applyTourData = useCallback(
    (data: Tour, recordInitialState = false, redirectIfCompleted = false) => {
      const metadata = data.metadata as any;
      const generationStatus = metadata?.generationStatus;
      const experiences = data.experiences || [];
      const stillGenerating =
        (generationStatus === 'generating' || generationStatus === 'pending') &&
        experiences.length === 0;

      setTour(data);
      setIsGeneratingExperiences(stillGenerating);
      setGenerationMessage(metadata?.generationMessage || '');
      setGenerationError(
        generationStatus === 'failed' ? metadata?.generationError || '' : '',
      );
      if (recordInitialState) wasGeneratingOnLoadRef.current = stillGenerating;

      if (
        redirectIfCompleted &&
        wasGeneratingOnLoadRef.current &&
        !redirectedToReviewRef.current &&
        generationStatus !== 'generating' &&
        generationStatus !== 'pending' &&
        experiences.length > 0
      ) {
        redirectedToReviewRef.current = true;
        router.replace(`/tours/${id}/review`);
      }
    },
    [id, router],
  );

  const refreshTour = useCallback(
    async (recordInitialState = false, redirectIfCompleted = false) => {
      if (!id) return null;
      if (!refreshPromiseRef.current) {
        refreshPromiseRef.current = fetchTourById(id).finally(() => {
          refreshPromiseRef.current = null;
        });
      }
      const data = await refreshPromiseRef.current;
      applyTourData(data, recordInitialState, redirectIfCompleted);
      return data;
    },
    [applyTourData, id],
  );

  const scheduleReconciliation = useCallback(
    (redirectIfCompleted = false) => {
      redirectAfterRefetchRef.current =
        redirectAfterRefetchRef.current || redirectIfCompleted;
      if (refetchTimerRef.current) return;
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        const shouldRedirect = redirectAfterRefetchRef.current;
        redirectAfterRefetchRef.current = false;
        refreshTour(false, shouldRedirect).catch((error) =>
          console.error('Failed to reconcile tour state:', error),
        );
      }, 150);
    },
    [refreshTour],
  );

  useEffect(() => {
    setStops(
      transformExperiencesToStops(tour?.experiences, tour?.totalDays),
    );
  }, [tour?.experiences, tour?.totalDays]);

  useEffect(() => {
    const loadTour = async () => {
      if (!id) return;
      try {
        setLoading(true);
        await refreshTour(true, false);
      } catch (error) {
        console.error('Failed to fetch tour:', error);
      } finally {
        setLoading(false);
      }
    };

    void loadTour();
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, [id, refreshTour]);

  const { connectionState, isForeground } = useSSE(
    id ? `/notifications/tours/${id}/stream` : null,
    {
    enabled: !!id,
    onOpen: () => scheduleReconciliation(false),
    onEvent: (eventName, payload) => {
      if (eventName === 'tour.progress') {
        if (payload.message) setGenerationMessage(payload.message);
        if (payload.status === 'completed' || payload.status === 'failed') {
          setIsGeneratingExperiences(false);
        } else if (payload.status === 'generating' || payload.status === 'pending') {
          setIsGeneratingExperiences(() => {
            if (tour?.experiences && tour.experiences.length > 0) return false;
            return true;
          });
        }
        if (payload.coverImage) {
          setTour((prevTour) => {
            if (!prevTour) return prevTour;
            return { ...prevTour, coverImage: payload.coverImage };
          });
        }
        scheduleReconciliation(false);
      } else if (eventName === 'tour.completed') {
        setIsGeneratingExperiences(false);
        setGenerationMessage(payload.message || 'Itinerario generado con éxito');
        scheduleReconciliation(true);
      } else if (eventName === 'tour.failed') {
        setIsGeneratingExperiences(false);
        setGenerationError(payload.message || 'No se pudo generar el itinerario');
        scheduleReconciliation(false);
      } else if (eventName === 'experience.media.updated') {
        const { experienceId, mediaUpdatedAt, photos } = payload;
        if (experienceId && mediaUpdatedAt) {
          setTour((prevTour) => {
            if (!prevTour || !prevTour.experiences) return prevTour;
            const updatedExperiences = prevTour.experiences.map((snapshot) => {
              const currentExperience = snapshot.experience;
              if (!currentExperience || currentExperience.id !== experienceId) {
                return snapshot;
              }
              const currentUpdatedAt = currentExperience.mediaUpdatedAt;
              if (
                currentUpdatedAt &&
                Date.parse(currentUpdatedAt) >= Date.parse(mediaUpdatedAt)
              ) {
                return snapshot;
              }
              return {
                ...snapshot,
                experience: {
                  ...currentExperience,
                  mediaUpdatedAt,
                  // The push carries the raw enriched photo list; keep any
                  // previously-resolved primaryPhoto/source until the next
                  // full fetch re-resolves the presentation server-side.
                  mediaPresentation: Array.isArray(photos)
                    ? { ...currentExperience.mediaPresentation, photos }
                    : currentExperience.mediaPresentation,
                },
              };
            });
            return { ...prevTour, experiences: updatedExperiences };
          });
        } else {
          scheduleReconciliation(false);
        }
      }
    },
    },
  );

  // Safety net polling fallback (only runs if actively generating)
  useEffect(() => {
    if (
      !id ||
      !isGeneratingExperiences ||
      !isForeground ||
      (connectionState !== 'failed' && connectionState !== 'disconnected')
    ) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        await refreshTour(false, true);
      } catch (error) {
        console.error('Polling fallback error:', error);
      }
    }, 5000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [
    connectionState,
    id,
    isForeground,
    isGeneratingExperiences,
    refreshTour,
  ]);

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

      <Box flex={1} bg='$backgroundLight50'>
        {/* Sticky Top Header with Safe Area, Back Button & Segmented Control */}
          <Box
            pt={Math.max(insets.top, 12)}
            pb='$2.5'
            px='$3'
            bg='$white'
            borderBottomWidth={1}
            borderBottomColor='$borderLight100'
            zIndex={20}
          >
            <HStack space='sm' alignItems='center'>
              <Pressable
                onPress={handleBack}
                w={40}
                h={40}
                borderRadius='$full'
                bg='$backgroundLight100'
                alignItems='center'
                justifyContent='center'
                testID='tour-header-back-button'
                accessibilityLabel='Volver'
              >
                <Icon as={ArrowLeft} size='md' color='$textLight800' />
              </Pressable>

              <HStack
                flex={1}
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
                      Itinerario ({stopCount})
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
                      Mapa 🗺️
                    </Text>
                  </HStack>
                </Pressable>
              </HStack>
            </HStack>
          </Box>

          {viewMode === 'map' ? (
            <TourMapView
              tour={tour}
              onSwitchToItinerary={() => setViewMode('list')}
            />
          ) : (
            <>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 110 }}
              >
                <TourHeader
                  tour={tour}
                  expanded={false}
                  isGenerating={isGeneratingExperiences}
                />

                <Box position='relative' zIndex={10}>
                  <QuickStatsBar tour={tour} />
                </Box>

                <VStack mt='$6' px='$4'>
                  {/* Generation Bitácora & Execution Trace */}
                  {generationTrace && (
                    <Box mb='$4'>
                      <GenerationBitacora trace={generationTrace} />
                    </Box>
                  )}

                  {/* Formatos pedidos que no se pudieron cubrir — visible para
                      cualquier usuario, no sólo en la Bitácora __DEV__-only. */}
                  {Array.isArray(tour?.metadata?.completenessNotice) &&
                    tour.metadata.completenessNotice.length > 0 && (
                      <Box
                        mb='$4'
                        p='$4'
                        bg='$warning50'
                        borderRadius='$xl'
                        borderWidth={1}
                        borderColor='$warning200'
                      >
                        {tour.metadata.completenessNotice.map(
                          (notice: string, index: number) => (
                            <Text
                              key={index}
                              size='sm'
                              color='$warning700'
                              mb={
                                index <
                                tour.metadata.completenessNotice.length - 1
                                  ? '$1'
                                  : undefined
                              }
                            >
                              {notice}
                            </Text>
                          ),
                        )}
                      </Box>
                    )}

                  {isGeneratingExperiences && stops.length === 0 ? (
                    <VStack space='md'>
                      <Box
                        p='$8'
                        alignItems='center'
                        justifyContent='center'
                        bg='$white'
                        borderRadius='$2xl'
                        borderWidth={1}
                        borderColor='$borderLight100'
                        shadowColor='$black'
                        shadowOffset={{ width: 0, height: 2 }}
                        shadowOpacity={0.06}
                        shadowRadius={8}
                        elevation={2}
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
                      <ItinerarySkeleton showHeaderCard={false} />
                    </VStack>
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
                        No hay experiencias disponibles para este tour
                      </Text>
                    </Box>
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

            {/* Dev-only, inline accordion for the generation bitácora */}
            {__DEV__ && generationTrace && (
              <Box mb='$4' px='$4'>
                <Pressable
                  onPress={handleBitacoraPress}
                  testID='bitacora-toggle'
                >
                  <HStack alignItems='center' space='xs'>
                    <Text size='xs' color='$tertiary600'>
                      {bitacoraCopyStatus === 'copied'
                        ? '✓ Bitácora copiada'
                        : bitacoraCopyStatus === 'failed'
                          ? 'No se pudo copiar la bitácora'
                          : '🐛 Bitácora de generación (dev)'}
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
                    trace={generationTrace}
                  />
                )}
              </Box>
            )}

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
                  onPress={() => setViewMode('map')}
                >
                  <ButtonText color='$white' fontWeight='$bold' size='md'>
                    Comenzar Recorrido a Pie
                  </ButtonText>
                  <Icon as={MapPin} color='$white' ml='$2' />
                </Button>
              </Box>
            </>
          )}
      </Box>
    </>
  );
}
