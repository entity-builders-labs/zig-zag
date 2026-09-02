import { Tour, TourExperience } from '../../api/tours';
import { getImage, getBadges } from './utils';
import { TourStop } from './types';

/** Converts immutable TourExperience snapshots into presentation stops. */
export function transformExperiencesToStops(experiences: Tour['experiences'], totalDays?: number): TourStop[] {
  if (!experiences?.length) return [];
  const stops = experiences.map(buildExperienceStop).filter((stop): stop is Exclude<TourStop, { type: 'day-header' | 'transport' }> => !!stop);
  if (!totalDays || totalDays <= 1) return stops;
  const result: TourStop[] = [];
  let day: number | undefined;
  for (const stop of stops) {
    const source = experiences.find((item) => item.id === stop.id);
    if (source?.dayNumber && source.dayNumber !== day) {
      day = source.dayNumber;
      result.push({ type: 'day-header', id: `day-${day}`, dayNumber: day, title: `Día ${day}` });
    }
    result.push(stop);
  }
  return result;
}

function buildExperienceStop(snapshot: TourExperience): TourStop | null {
  const experience = snapshot.experience;
  const title = experience?.canonicalName || experience?.name || 'Experiencia';
  const badges = getBadges({ type: 'EXPERIENCE', metadata: { themes: experience?.themes } });
  if (snapshot.components && snapshot.components.length > 1) {
    return {
      type: 'composite', id: snapshot.id, tourActivityId: snapshot.id, title,
      themeReasoning: snapshot.notes, kind: 'EXPERIENCE' as any,
      waypoints: snapshot.components.map((component, index) => ({
        order: component.order ?? index,
        waypointActivity: { id: component.geoEntityId, name: component.name, latitude: component.latitude, longitude: component.longitude },
      })) as any, badges,
    };
  }
  return { type: 'location', id: snapshot.id, title, image: getImage(undefined, 0, experience?.themes?.[0]), description: experience?.description || snapshot.notes, badges };
}
