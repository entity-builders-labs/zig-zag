import React, { useEffect, useState } from 'react';
import { ScrollView, ActivityIndicator } from 'react-native';
import {
  Box,
  VStack,
  Heading,
  Text,
  Button,
  ButtonText,
  Spinner,
} from '@gluestack-ui/themed';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  fetchTourById,
  updateTourActivityWaypoints,
  Tour,
} from '../../../api/tours';
import { TourStop, TourStopComposite } from '../../../components/tour-details/types';
import { transformActivitiesToStops, transformExperiencesToStops } from '../../../components/tour-details/build-stops';
import { TourStopCard } from '../../../components/tour-details/TourStopCard';
import { CompositeStopCard } from '../../../components/tour-details/CompositeStopCard';
import { FONT_DISPLAY } from '@/constants/typography';

const MIN_SELECTED_WAYPOINTS = 2;

export default function TourReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<TourStop[]>([]);
  // tourActivityId -> set of waypointActivityId currently checked. Seeded
  // from each composite stop's full snapshot (everything checked by
  // default) — unchecking is the only way to exclude something.
  const [selections, setSelections] = useState<Map<string, Set<string>>>(
    new Map()
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data: Tour = await fetchTourById(id);
        const activities = data.activities || [];
        const experiences = data.experiences || [];

        // Nothing to review here (e.g. reached directly via URL before
        // generation actually finished) — fall back to the normal detail
        // screen rather than showing an empty review.
        const metadata = data.metadata as any;
        if (metadata?.generationStatus !== 'completed' || (activities.length === 0 && experiences.length === 0)) {
          router.replace(`/tours/${id}`);
          return;
        }

        const transformedStops = experiences.length
          ? transformExperiencesToStops(experiences, data.totalDays)
          : transformActivitiesToStops(activities, data.totalDays);
        setStops(transformedStops);

        const initialSelections = new Map<string, Set<string>>();
        for (const stop of transformedStops) {
          if (stop.type === 'composite') {
            initialSelections.set(
              stop.tourActivityId,
              new Set(stop.waypoints.map((w) => w.waypointActivity.id))
            );
          }
        }
        setSelections(initialSelections);
      } catch (error) {
        console.error('Failed to load tour for review:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, router]);

  const compositeStops = stops.filter(
    (s): s is TourStopComposite => s.type === 'composite'
  );

  const toggleWaypoint = (tourActivityId: string, waypointId: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(tourActivityId) ?? []);
      if (current.has(waypointId)) {
        current.delete(waypointId);
      } else {
        current.add(waypointId);
      }
      next.set(tourActivityId, current);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!id) return;
    setConfirming(true);
    try {
      // Only PATCH stops that actually changed from their full snapshot —
      // confirming without touching anything must not fire any request.
      // A stop whose edited selection dropped below the minimum keeps its
      // full snapshot instead (same fallback the backend itself applies),
      // so there's nothing meaningful to send for it either.
      const patchTargets = compositeStops.filter((stop) => {
        const selected = selections.get(stop.tourActivityId);
        if (!selected) return false;
        if (selected.size < MIN_SELECTED_WAYPOINTS) return false;
        const original = new Set(
          stop.waypoints.map((w) => w.waypointActivity.id)
        );
        return (
          selected.size !== original.size ||
          [...selected].some((wid) => !original.has(wid))
        );
      });

      await Promise.all(
        patchTargets.map((stop) =>
          updateTourActivityWaypoints(
            id,
            stop.tourActivityId,
            Array.from(selections.get(stop.tourActivityId) || [])
          )
        )
      );

      router.replace(`/tours/${id}`);
    } catch (error) {
      console.error('Failed to confirm tour waypoint edits:', error);
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <Box flex={1} bg='$backgroundLight50' justifyContent='center' alignItems='center'>
        <ActivityIndicator size='large' color='#C89B3C' />
      </Box>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Box flex={1} bg='$backgroundLight50'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
        >
          <VStack p='$4' space='xs'>
            <Heading
              size='lg'
              color='$textLight900'
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Revisá tu recorrido
            </Heading>
            <Text size='sm' color='$textLight500'>
              Podés destildar alguna parada de las caminatas/experiencias
              antes de confirmar tu tour.
            </Text>
          </VStack>

          <VStack px='$4'>
            {stops.map((item) => {
              if (item.type === 'location' || item.type === 'composite') {
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
                    editable
                    selectedWaypointIds={selections.get(item.tourActivityId)}
                    onToggleWaypoint={(waypointId) =>
                      toggleWaypoint(item.tourActivityId, waypointId)
                    }
                  />
                ) : (
                  <TourStopCard key={item.id} data={item} isLast={isLastStop} />
                );
              }
              return null;
            })}
          </VStack>
        </ScrollView>

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
            testID='confirm-tour-button'
            size='lg'
            variant='solid'
            action='primary'
            bg='$primary500'
            borderRadius='$2xl'
            h={52}
            isDisabled={confirming}
            onPress={handleConfirm}
          >
            {confirming ? (
              <Spinner size='small' color='$white' />
            ) : (
              <ButtonText color='$white' fontWeight='$bold'>
                Confirmar Recorrido
              </ButtonText>
            )}
          </Button>
        </Box>
      </Box>
    </>
  );
}
