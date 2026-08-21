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
} from '@gluestack-ui/themed';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { fetchTourById, Tour } from '../../api/tours';
import { TourHeader } from '../../components/tour-details/TourHeader';
import { QuickStatsBar } from '../../components/tour-details/QuickStatsBar';
import { SmartConnector } from '../../components/tour-details/SmartConnector';
import { TourStopCard } from '../../components/tour-details/TourStopCard';
import { CompositeStopCard } from '../../components/tour-details/CompositeStopCard';
import { DayHeader } from '../../components/tour-details/DayHeader';
import { GenerationPipeline } from '../../components/tour-details/GenerationPipeline';
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
        if (activities.length > 0 || generationStatus === 'completed') {
          setTour(data);
          // Transform activities (with day grouping if needed)
          const transformedStops = transformActivitiesToStops(
            activities,
            data.totalDays
          );
          setStops(transformedStops);

          // We only just now watched this tour finish generating (this
          // mount's initial load found it still in progress) — if it
          // produced at least one composite stop worth reviewing, send the
          // user to the pre-confirmation review screen instead of landing
          // straight on the final detail view. Pure frontend navigation
          // decision, no backend status change involved.
          if (
            generationStatus === 'completed' &&
            wasGeneratingOnLoadRef.current &&
            !redirectedToReviewRef.current
          ) {
            const hasReviewableComposite = transformedStops.some(
              (stop) => stop.type === 'composite' && stop.waypoints.length > 0
            );
            if (hasReviewableComposite) {
              redirectedToReviewRef.current = true;
              router.replace(`/tours/${id}/review`);
            }
          }
        }

        // Stop polling once generation is no longer in progress — nothing
        // left to wait for, whether it succeeded, failed, or was never
        // triggered (e.g. a manually created tour with no generation flow).
        if (!stillGenerating) {
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('Failed to poll tour status:', error);
      }
    }, 3000); // Poll every 3 seconds

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
          <TourHeader tour={tour} expanded={viewMode === 'map'} />

          <Box position='relative' zIndex={10}>
            <QuickStatsBar tour={tour} />
          </Box>

          <VStack mt='$6' px='$4'>
            <HStack justifyContent='space-between' alignItems='center' mb='$4'>
              <Heading
                size='md'
                color='$textLight800'
                style={{ fontFamily: FONT_DISPLAY }}
              >
                Tu Recorrido
              </Heading>
              {!isGeneratingActivities &&
                !generationError &&
                stops.length > 0 && (
                  <HStack
                    bg='$backgroundLight100'
                    borderRadius='$full'
                    p='$1'
                    space='xs'
                  >
                    <Button
                      testID='view-toggle-list'
                      size='xs'
                      variant={viewMode === 'list' ? 'solid' : 'link'}
                      action='primary'
                      borderRadius='$full'
                      px='$3'
                      onPress={() => setViewMode('list')}
                    >
                      <ButtonText
                        size='xs'
                        color={viewMode === 'list' ? '$white' : '$textLight600'}
                      >
                        Lista
                      </ButtonText>
                    </Button>
                    <Button
                      testID='view-toggle-map'
                      size='xs'
                      variant={viewMode === 'map' ? 'solid' : 'link'}
                      action='primary'
                      borderRadius='$full'
                      px='$3'
                      onPress={() => setViewMode('map')}
                    >
                      <ButtonText
                        size='xs'
                        color={viewMode === 'map' ? '$white' : '$textLight600'}
                      >
                        Mapa
                      </ButtonText>
                    </Button>
                  </HStack>
                )}
            </HStack>

            {isGeneratingActivities ? (
              <Box
                p='$8'
                alignItems='center'
                justifyContent='center'
                bg='$backgroundLight100'
                borderRadius='$lg'
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
                bg='$backgroundLight100'
                borderRadius='$md'
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
                bg='$backgroundLight100'
                borderRadius='$md'
              >
                <Text color='$textLight600' textAlign='center'>
                  No hay actividades disponibles para este tour
                </Text>
              </Box>
            ) : viewMode === 'map' ? (
              <Box p='$4' alignItems='center'>
                <Text size='sm' color='$textLight500' textAlign='center'>
                  ↑ El mapa con el recorrido está arriba
                </Text>
              </Box>
            ) : (
              <VStack>
                {stops.map((item) => {
                  if (item.type === 'location' || item.type === 'composite') {
                    // Find if this is the last "real stop" (location or
                    // composite) — not counting day headers/transport
                    // connectors — so the timeline's bottom line only draws
                    // between actual stops.
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
                      />
                    ) : (
                      <TourStopCard
                        key={item.id}
                        data={item}
                        isLast={isLastStop}
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

        {/* Floating CTA — brass commit action, dark ink text/icon for
            contrast (matches the wizard's final-step button). */}
        <Box
          position='absolute'
          bottom={0}
          left={0}
          right={0}
          p='$4'
          bg='$backgroundLight50'
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
            <ButtonText color='$secondary950' fontWeight='$bold'>
              Comenzar Recorrido
            </ButtonText>
            <Icon as={MapPin} color='$secondary950' ml='$2' />
          </Button>
        </Box>
      </Box>
    </>
  );
}
