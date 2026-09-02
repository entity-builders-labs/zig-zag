import { Tour } from '../../api/tours';
import { isCompositeKind } from '../../features/activities/composite';
import { getImage, getBadges } from './utils';
import { TourStop } from './types';

export type TourActivityItem = NonNullable<Tour['activities']>[number];

/** Presentation projection for canonical V2 snapshots. The UI consumes the
 * snapshot's own component coordinates and never relies on mutable Activity
 * rows when a TourExperience is present. */
export function transformExperiencesToStops(
  experiences: Tour['experiences'],
  totalDays?: number,
): TourStop[] {
  if (!experiences?.length) return [];
  const items: TourActivityItem[] = experiences.map((snapshot, index) => {
    const exp = snapshot.experience;
    const first = snapshot.components[0];
    return {
      id: snapshot.id,
      order: snapshot.order ?? index,
      dayNumber: snapshot.dayNumber ?? undefined,
      notes: snapshot.notes ?? exp?.description,
      activityName: exp?.canonicalName || exp?.name || 'Experiencia',
      activityType: 'EXPERIENCE',
      activityLatitude: first?.latitude,
      activityLongitude: first?.longitude,
      activity: {
        id: snapshot.experienceId,
        name: exp?.canonicalName || exp?.name || 'Experiencia',
        description: exp?.description,
        type: 'EXPERIENCE',
        latitude: first?.latitude,
        longitude: first?.longitude,
        kind: 'EXPERIENCE',
        waypoints: snapshot.components.map((component, componentIndex) => ({
          order: component.order ?? componentIndex,
          waypointActivity: {
            id: component.geoEntityId,
            name: component.name,
            latitude: component.latitude,
            longitude: component.longitude,
          },
        })),
      },
      waypoints: snapshot.components.map((component, componentIndex) => ({
        order: component.order ?? componentIndex,
        waypointActivity: {
          id: component.geoEntityId,
          name: component.name,
          latitude: component.latitude,
          longitude: component.longitude,
        },
      })),
    } as TourActivityItem;
  });
  return transformActivitiesToStops(items, totalDays);
}

// A composite pick (neighborhood_walk/route/experience) renders as a
// TourStopComposite instead of a plain TourStopLocation — its themeReasoning
// was persisted into TourActivity.notes at generation time (see
// tour-activity-generation.service.ts), and its waypoints come from THIS
// stop's TourActivityWaypoint snapshot (item.waypoints), never the shared
// variant's current/live content, so the card stays stable in time. Shared
// between the tour detail screen and the pre-confirmation review screen so
// both render the exact same stop list from the exact same data.
export function buildStop(item: TourActivityItem, id: string): TourStop | null {
  const activity = item.activity;
  const activityName =
    activity?.name || item.activityName || 'Unknown Activity';
  if (!activityName) return null;

  if (activity && isCompositeKind(activity.kind)) {
    return {
      type: 'composite',
      id,
      tourActivityId: item.id,
      title: activityName,
      themeReasoning: item.notes,
      kind: activity.kind as Exclude<
        NonNullable<typeof activity.kind>,
        'POI' | 'AREA'
      >,
      boundary: activity.boundary,
      waypoints: item.waypoints || [],
      badges: getBadges(activity),
    };
  }

  return {
    type: 'location',
    id,
    title: activityName,
    image: getImage(activity?.photos),
    description: activity?.description || item.notes,
    badges: getBadges(activity || { type: item.activityType }),
  };
}

// Transforms activities to stops, grouping by day if needed.
export function transformActivitiesToStops(
  activities: Tour['activities'],
  totalDays?: number
): TourStop[] {
  if (!activities || activities.length === 0) {
    return [];
  }

  const shouldGroupByDay =
    totalDays !== undefined && totalDays !== null && totalDays > 1;

  // Check if we have dayNumber in activities
  const hasDayNumbers = activities.some(
    (item) => item.dayNumber !== undefined && item.dayNumber !== null
  );

  // If we shouldn't group by day or don't have day numbers, use original behavior
  if (!shouldGroupByDay || !hasDayNumbers) {
    const transformedStops: TourStop[] = [];
    activities.forEach((item, index) => {
      const activityId = item.activity?.id || `inline-${index}`;
      const stop = buildStop(item, activityId);
      if (!stop) return;

      transformedStops.push(stop);

      if (index < activities.length - 1) {
        const duration = item.travelTimeToNext
          ? `${Math.round(item.travelTimeToNext)} min`
          : '10 min';

        transformedStops.push({
          type: 'transport',
          id: `t-${index}`,
          mode: 'walk',
          label: 'Caminata',
          duration: duration,
        });
      }
    });
    return transformedStops;
  }

  // Group by day
  const stops: TourStop[] = [];
  const activitiesByDay = new Map<number, typeof activities>();
  const activitiesWithoutDay: typeof activities = [];

  // Separate activities with and without dayNumber
  activities.forEach((item) => {
    if (item.dayNumber !== undefined && item.dayNumber !== null) {
      const dayNumber = item.dayNumber;
      if (!activitiesByDay.has(dayNumber)) {
        activitiesByDay.set(dayNumber, []);
      }
      activitiesByDay.get(dayNumber)!.push(item);
    } else {
      activitiesWithoutDay.push(item);
    }
  });

  // Helper function to add activities for a day
  const addActivitiesForDay = (
    dayActivities: typeof activities,
    dayNumber: number | null
  ) => {
    dayActivities.forEach((item, index) => {
      const activityId =
        item.activity?.id || `inline-${dayNumber ?? 'extra'}-${index}`;
      const stop = buildStop(item, activityId);
      if (!stop) return;

      stops.push(stop);

      // Add transport only if not last activity of the day
      if (index < dayActivities.length - 1) {
        const duration = item.travelTimeToNext
          ? `${Math.round(item.travelTimeToNext)} min`
          : '10 min';

        stops.push({
          type: 'transport',
          id: `t-${dayNumber ?? 'extra'}-${index}`,
          mode: 'walk',
          label: 'Caminata',
          duration: duration,
        });
      }
    });
  };

  // Sort days and add activities with dayNumber
  const sortedDays = Array.from(activitiesByDay.keys()).sort((a, b) => a - b);

  sortedDays.forEach((dayNumber) => {
    const dayActivities = activitiesByDay.get(dayNumber)!;

    // Add day header
    stops.push({
      type: 'day-header',
      id: `day-${dayNumber}`,
      dayNumber: dayNumber,
      title: `Día ${dayNumber}`,
    });

    // Add activities for this day
    addActivitiesForDay(dayActivities, dayNumber);
  });

  // Add activities without dayNumber at the end
  if (activitiesWithoutDay.length > 0) {
    addActivitiesForDay(activitiesWithoutDay, null);
  }

  return stops;
}
