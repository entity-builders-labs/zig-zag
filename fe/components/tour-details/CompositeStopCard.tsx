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
import { Footprints, Milestone, Sparkles } from 'lucide-react-native';
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
  stopNumber,
  editable = false,
  selectedComponentIds,
  onToggleComponent,
}: {
  data: TourStopComposite;
  isLast: boolean;
  stopNumber?: number;
  // Pre-confirmation review screen mode: renders a checklist instead of a
  // plain numbered list, letting the user exclude a stop for this tour
  // instance only (never the shared variant's own content).
  editable?: boolean;
  selectedComponentIds?: Set<string>;
  onToggleComponent?: (componentId: string) => void;
}) => {
  const orderedComponents = [...data.components].sort(
    (a, b) => a.order - b.order
  );
  const waypointCoordinates = orderedComponents
    .map((w) => w.component)
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
  const boundary = data.boundary as any;
  const isOwnRouteBoundary = boundary?.type === 'LineString';
  const polygonParts = !isOwnRouteBoundary
    ? geoJsonBoundaryToPolygonParts(
        boundary?.type === 'Polygon' || boundary?.type === 'MultiPolygon'
          ? boundary
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

  // The walking path between this stop's components (not the boundary itself)
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
  const KindIcon = KIND_ICONS[data.kind] || Sparkles;

  // No flex={1} — see the comment in TourStopCard.tsx; this card in
  // particular has by far the tallest natural content of any row type
  // (map + waypoint list), so it's the one that visibly overflowed.
  return (
    <HStack testID={`composite-stop-${data.experienceSnapshotId}`}>
      {/* Timeline Node — rose accent, distinguishing a composite/experience */}
      <Box width={36} alignItems='center' position='relative'>
        <Box height={16} width={2} bg='$borderLight300' />
        <Box
          width={24}
          height={24}
          borderRadius='$full'
          bg='$tertiary600'
          borderWidth={2}
          borderColor='$white'
          zIndex={1}
          alignItems='center'
          justifyContent='center'
          shadowColor='$tertiary500'
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.4}
          shadowRadius={4}
          elevation={3}
        >
          {stopNumber ? (
            <Text size='2xs' fontWeight='$bold' color='$white'>
              {stopNumber}
            </Text>
          ) : (
            <Icon as={KindIcon} size='2xs' color='$white' />
          )}
        </Box>
        {!isLast && <Box flex={1} width={2} bg='$borderLight300' />}
      </Box>

      {/* Card Content */}
      <Box flex={1} pb='$4' pl='$2' pr='$2'>
        <Box
          bg='$white'
          borderRadius='$2xl'
          overflow='hidden'
          borderWidth={1.5}
          borderColor='$tertiary200'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.06}
          shadowRadius={6}
          elevation={2}
        >
          {/* Mini-map view for composite boundary or waypoint route */}
          <Box height={180} width='100%' position='relative' overflow='hidden' bg='$backgroundLight100'>
            {mapRegion ? (
              <MapView
                isStatic
                zoomable={false}
                initialRegion={mapRegion}
                instanceId={`composite-${data.experienceSnapshotId}`}
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
              <Box flex={1} bg='$backgroundLight100' alignItems='center' justifyContent='center'>
                <Icon as={KindIcon} size='xl' color='$tertiary400' />
              </Box>
            )}
          </Box>

          <VStack p='$3.5'>
            <HStack justifyContent='space-between' alignItems='center' mb='$1.5'>
              <HStack space='xs' alignItems='center'>
                <Box
                  bg='$tertiary50'
                  px='$2.5'
                  py='$0.5'
                  borderRadius='$full'
                  borderWidth={1}
                  borderColor='$tertiary200'
                >
                  <Text size='2xs' fontWeight='$bold' color='$tertiary700'>
                    ✨ {KIND_LABELS[data.kind] || data.kind}
                  </Text>
                </Box>
                {orderedComponents.length > 0 && (
                  <Box
                    bg='$backgroundLight100'
                    px='$2'
                    py='$0.5'
                    borderRadius='$full'
                  >
                    <Text size='2xs' fontWeight='$medium' color='$textLight600'>
                      {orderedComponents.length} componentes
                    </Text>
                  </Box>
                )}
              </HStack>
            </HStack>

            <Heading
              size='sm'
              numberOfLines={2}
              color='$textLight900'
              style={{ fontFamily: FONT_DISPLAY }}
            >
              {data.title}
            </Heading>

            {data.themeReasoning && (
              <Box
                mt='$2'
                p='$2.5'
                bg='$tertiary50'
                borderRadius='$lg'
                borderLeftWidth={3}
                borderLeftColor='$tertiary500'
              >
                <Text
                  size='2xs'
                  color='$tertiary900'
                  fontStyle='italic'
                  numberOfLines={3}
                >
                  💡 {data.themeReasoning}
                </Text>
              </Box>
            )}

            {/* Waypoints Sub-List */}
            {orderedComponents.length > 0 && editable ? (
              <VStack mt='$3' space='xs' testID={`composite-components-${data.experienceSnapshotId}`}>
                {orderedComponents.map((w, index) => {
                  const isChecked =
                    selectedComponentIds?.has(w.component.id) ?? true;
                  return (
                    <Pressable
                      key={w.component.id}
                      onPress={() => onToggleComponent?.(w.component.id)}
                      testID={`component-checkbox-${w.component.id}`}
                    >
                      <HStack
                        space='sm'
                        alignItems='center'
                        p='$2'
                        bg='$backgroundLight50'
                        borderRadius='$lg'
                        borderWidth={1}
                        borderColor='$borderLight100'
                      >
                        <Box
                          width={18}
                          height={18}
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
                        <Text size='xs' fontWeight='$medium' color='$textLight800' flex={1}>
                          {index + 1}. {w.component.name}
                        </Text>
                      </HStack>
                    </Pressable>
                  );
                })}
                {(selectedComponentIds?.size ?? 0) < MIN_SELECTED_WAYPOINTS && (
                  <Text size='2xs' color='$error600' mt='$1'>
                    Elegí al menos {MIN_SELECTED_WAYPOINTS} paradas — si no,
                    se mantiene el recorrido completo.
                  </Text>
                )}
              </VStack>
            ) : (
              orderedComponents.length > 0 && (
                <VStack mt='$3' space='xs'>
                  <Text size='2xs' fontWeight='$bold' color='$textLight400' textTransform='uppercase' letterSpacing={0.5} mb='$1'>
                    Paradas de esta experiencia:
                  </Text>
                  {orderedComponents.map((w, index) => (
                    <HStack
                      key={w.component.id}
                      space='sm'
                      alignItems='center'
                      p='$2'
                      bg='$backgroundLight50'
                      borderRadius='$lg'
                      borderWidth={1}
                      borderColor='$borderLight100'
                    >
                      <Box
                        width={18}
                        height={18}
                        borderRadius='$full'
                        bg='$tertiary100'
                        alignItems='center'
                        justifyContent='center'
                      >
                        <Text size='2xs' fontWeight='$bold' color='$tertiary800'>
                          {index + 1}
                        </Text>
                      </Box>
                      <Text
                        size='xs'
                        fontWeight='$medium'
                        color='$textLight800'
                        numberOfLines={1}
                        flex={1}
                      >
                          {w.component.name}
                      </Text>
                    </HStack>
                  ))}
                </VStack>
              )
            )}

            {data.badges.length > 0 && (
              <HStack space='xs' mt='$2' flexWrap='wrap'>
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

          </VStack>
        </Box>
      </Box>
    </HStack>
  );
};
