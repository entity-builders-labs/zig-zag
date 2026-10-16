import { PlanningExperienceCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { toPointCandidate } from '../builders/point-footprints.util';

export const ROSARIO_CANDIDATES: PlanningExperienceCandidate[] = Array.from(
  { length: 12 },
  (_, i) =>
    toPointCandidate({
      experienceId: 'rosario-' + i,
      title: 'ROSARIO Experience ' + i,
      durationMinutes: 60 + (i % 3) * 30,
      // Fixture order is the preference order.
      preferenceRank: i + 1,
      spatialFootprint: {
        type: 'POINT',
        centroid: { lat: -34.6 + i * 0.001, lng: -58.4 + i * 0.001 },
      },
      openingHours: { status: 'unknown' },
    }),
);
