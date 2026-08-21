import React, { useEffect, useState } from 'react';
import {
  HStack,
  Box,
  VStack,
  Heading,
  Text,
  Badge,
  BadgeText,
  CheckIcon,
  Icon,
  Pressable,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { Footprints, Milestone, Sparkles, ChevronRight } from 'lucide-react-native';
import { Map as MapView } from '../../features/map';
import { fetchWalkingRoute } from '../../features/map/directions';
import {
  geoJsonBoundaryToPolygonParts,
  lineStringToCoordinates,
} from '../../features/map/geojson';
import { getRegionForCoordinates } from '../../features/map/utils';
import { TourStopComposite } from './types';
import { FONT_DISPLAY } from '../../constants/typography';

const KIND_LABELS: Record<TourStopComposite['kind'], string> = {
  NEIGHBORHOOD_WALK: 'Caminata',
  ROUTE: 'Recorrido',
  EXPERIENCE: 'Experiencia',
};

const KIND_ICONS: Record<TourStopComposite['kind'], typeof Footprints> = {
  NEIGHBORHOOD_WALK: Footprints,
  ROUTE: Milestone,
  EXPERIENCE: Sparkles,
};

// Minimum viable stop count for an edited subset — mirrors
// MIN_WAYPOINTS_FOR_MULTI_STOP on the backend (composite-activity-
// verification.util.ts). Below this, the pre-confirmation review screen
// blocks that stop's exclusion and falls back to the full snapshot.
const MIN_SELECTED_WAYPOINTS = 2;

export const CompositeStopCard = ({
  data,
  isLast,
  editable = false,
  selectedWaypointIds,
  onToggleWaypoint,
}: {
  data: TourStopComposite;
  isLast: boolean;
  // Pre-confirmation review screen mode: renders a checklist instead of a
  // plain numbered list, letting the user exclude a stop for this tour
  // instance only (never the shared variant's own content).
  editable?: boolean;
  selectedWaypointIds?: Set<string>;
  onToggleWaypoint?: (waypointActivityId: string) => void;
}) => {
  const orderedWaypoints = [...data.waypoints].sort(
    (a, b) => a.order - b.order
  );
  const waypointCoordinates = orderedWaypoints
    .map((w) => w.waypointActivity)
    .filter(
      (a): a is { id: string; name: string; latitude: number; longitude: number } =>
        a.latitude != null && a.longitude != null
    )
    .map((a) => ({ latitude: a.latitude, longitude: a.longitude }));

  // A top-level `route`'s own boundary IS the experience's trace (e.g.
  // "Pasear por Caminito") — it goes straight to the map as a route/polyline,
  // never through the polygons pipeline (which would render it as a closed
  // shape it isn't). Any other boundary shape (Polygon/MultiPolygon, from a
  // variant materialized inside an AREA) renders as a polygon instead.
  const isOwnRouteBoundary = data.boundary?.type === 'LineString';
  const polygonParts = !isOwnRouteBoundary
    ? geoJsonBoundaryToPolygonParts(
        data.boundary?.type === 'Polygon' || data.boundary?.type === 'MultiPolygon'
          ? data.boundary
          : null
      )
    : [];

  const [routeCoordinates, setRouteCoordinates] = useState<
    { latitude: number; longitude: number }[]
  >(
    isOwnRouteBoundary
      ? lineStringToCoordinates(data.boundary as any)
      : waypointCoordinates
  );

  // The walking path BETWEEN this stop's waypoints (not the boundary itself)
  // is computed client-side, same as the tour-level route in TourHeader —
  // there's nothing to persist here, it's cheap to recompute on render.
  useEffect(() => {
    if (isOwnRouteBoundary) {
      setRouteCoordinates(lineStringToCoordinates(data.boundary as any));
      return;
    }
    if (waypointCoordinates.length < 2) return;

    let cancelled = false;
    fetchWalkingRoute(waypointCoordinates).then((coordinates) => {
      if (!cancelled) setRouteCoordinates(coordinates);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id, isOwnRouteBoundary, JSON.stringify(waypointCoordinates)]);

  const framingPoints =
    polygonParts.length > 0
      ? polygonParts.flatMap((p) => p.outer)
      : routeCoordinates.length > 0
        ? routeCoordinates
        : waypointCoordinates;
  const mapRegion = getRegionForCoordinates(framingPoints);
  const router = useRouter();
  const KindIcon = KIND_ICONS[data.kind] || Sparkles;

  // No flex={1} — see the comment in TourStopCard.tsx; this card in
  // particular has by far the tallest natural content of any row type
  // (map + waypoint list), so it's the one that visibly overflowed.
  return (
    <HStack testID={`composite-stop-${data.tourActivityId}`}>
      {/* Timeline Node — rose accent, distinguishing a composite/experience
          stop from a plain POI's brass node (TourStopCard) at a glance. */}
      <Box width={40} alignItems='center' position='relative'>
        <Box height={20} width={2} bg='$borderLight300' />
        <Box
          width={16}
          height={16}
          borderRadius='$full'
          bg='$tertiary500'
          borderWidth={3}
          borderColor='$white'
          zIndex={1}
          shadowColor='$tertiary500'
          shadowOffset={{ width: 0, height: 0 }}
          shadowOpacity={0.5}
          shadowRadius={4}
        />
        {!isLast && <Box flex={1} width={2} bg='$borderLight300' />}
      </Box>

      {/* Card Content */}
      <Box flex={1} pb='$6' pr='$4'>
        <Box
          bg='$white'
          borderRadius='$xl'
          overflow='hidden'
          borderWidth={1}
          borderColor='$borderLight100'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 1 }}
          shadowOpacity={0.05}
          shadowRadius={3}
          elevation={2}
        >
          {/* Taller than a typical POI thumbnail — a walk's waypoints are
              often spread north-south along streets more than east-west,
              and fitBounds() must zoom out enough to fit that whole span
              within whatever height it's given; a short box forces a much
              more zoomed-out (and misleadingly wide) view than the walk's
              actual footprint needs. */}
          <Box height={200} width='100%' position='relative' overflow='hidden'>
            {mapRegion ? (
              <MapView
                isStatic
                zoomable={false}
                initialRegion={mapRegion}
                instanceId={`composite-${data.tourActivityId}`}
                // Without this, an unset `markers` prop falls back to
                // *every* activity in the app's global search context (see
                // features/map/index.web.tsx) — not this composite's own
                // waypoints — which is what was blowing the fitBounds
                // calculation out to cover the whole province.
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
          </Box>

          {/* Rose accent bar — marks this card as a composite/experience
              stop, matches the mockup's .composite-card::before */}
          <Box position='relative'>
            <Box
              position='absolute'
              left={0}
              top={8}
              bottom={8}
              width={3}
              borderRadius='$full'
              bg='$tertiary500'
            />
            <VStack p='$3' pl='$4'>
              <HStack space='sm' alignItems='flex-start'>
                <Box
                  width={34}
                  height={34}
                  borderRadius='$md'
                  bg='$tertiary500'
                  alignItems='center'
                  justifyContent='center'
                >
                  <Icon as={KindIcon} size='sm' color='$white' />
                </Box>
                <VStack flex={1}>
                  <Heading
                    size='sm'
                    numberOfLines={1}
                    ellipsizeMode='tail'
                    style={{ fontFamily: FONT_DISPLAY }}
                  >
                    {data.title}
                  </Heading>
                  <Badge
                    size='sm'
                    variant='outline'
                    borderRadius='$sm'
                    borderColor='$tertiary300'
                    bg='$tertiary50'
                    alignSelf='flex-start'
                    mt='$1'
                  >
                    <BadgeText fontSize='$2xs' color='$tertiary700'>
                      {KIND_LABELS[data.kind] || data.kind}
                    </BadgeText>
                  </Badge>
                </VStack>
              </HStack>

              {data.themeReasoning && (
                <Text
                  size='xs'
                  color='$textLight500'
                  fontStyle='italic'
                  numberOfLines={3}
                  mt='$2'
                  pl='$2'
                  borderLeftWidth={2}
                  borderLeftColor='$borderLight200'
                >
                  {data.themeReasoning}
                </Text>
              )}

            {orderedWaypoints.length > 0 && editable ? (
              <VStack mt='$2' space='xs' testID={`composite-waypoints-${data.tourActivityId}`}>
                {/* Custom rose checkbox, not Gluestack's <Checkbox> — its
                    checked-state color is hardcoded to the primary (brass)
                    token inside @gluestack-ui/config's theme with no
                    per-instance override hook, and this checkbox is
                    specifically the composite/experience accent (rose)
                    everywhere else on this card. */}
                {orderedWaypoints.map((w, index) => {
                  const isChecked =
                    selectedWaypointIds?.has(w.waypointActivity.id) ?? true;
                  return (
                    <Pressable
                      key={w.waypointActivity.id}
                      onPress={() => onToggleWaypoint?.(w.waypointActivity.id)}
                      testID={`waypoint-checkbox-${w.waypointActivity.id}`}
                    >
                      <HStack space='sm' alignItems='center'>
                        <Box
                          width={16}
                          height={16}
                          borderRadius='$sm'
                          borderWidth={1.5}
                          borderColor='$tertiary500'
                          bg={isChecked ? '$tertiary500' : 'transparent'}
                          alignItems='center'
                          justifyContent='center'
                        >
                          {isChecked && (
                            <Icon as={CheckIcon} size='2xs' color='$white' />
                          )}
                        </Box>
                        <Text size='sm' color='$textLight800'>
                          {index + 1}. {w.waypointActivity.name}
                        </Text>
                      </HStack>
                    </Pressable>
                  );
                })}
                {(selectedWaypointIds?.size ?? 0) < MIN_SELECTED_WAYPOINTS && (
                  <Text size='2xs' color='$error600' mt='$1'>
                    Elegí al menos {MIN_SELECTED_WAYPOINTS} paradas — si no,
                    se mantiene el recorrido completo.
                  </Text>
                )}
              </VStack>
            ) : (
              orderedWaypoints.length > 0 && (
                <VStack mt='$2' space='xs'>
                  {orderedWaypoints.map((w) => (
                    <HStack
                      key={w.waypointActivity.id}
                      space='xs'
                      alignItems='center'
                    >
                      <Box
                        width={5}
                        height={5}
                        borderRadius='$full'
                        bg='$tertiary500'
                      />
                      <Text
                        size='xs'
                        color='$textLight700'
                        numberOfLines={1}
                        flex={1}
                      >
                        {w.waypointActivity.name}
                      </Text>
                    </HStack>
                  ))}
                </VStack>
              )
            )}

            {data.badges.length > 0 && (
              <HStack space='xs' mt='$2'>
                {data.badges.map((badge, idx) => (
                  <Badge
                    key={idx}
                    size='sm'
                    action={badge.action}
                    variant='outline'
                    borderRadius='$sm'
                  >
                    <BadgeText fontSize='$2xs'>{badge.text}</BadgeText>
                  </Badge>
                ))}
              </HStack>
            )}

            {!editable && (
              <Pressable
                onPress={() => router.push(`/activities/${data.id}`)}
                mt='$2'
              >
                <HStack alignItems='center' space='xs'>
                  <Text size='xs' color='$tertiary600' fontWeight='$bold'>
                    Ver recorrido completo
                  </Text>
                  <Icon as={ChevronRight} size='xs' color='$tertiary600' />
                </HStack>
              </Pressable>
            )}
            </VStack>
          </Box>
        </Box>
      </Box>
    </HStack>
  );
};
