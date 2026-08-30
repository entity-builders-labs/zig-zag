import { PlanningActivityCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export const ROSARIO_CANDIDATES: PlanningActivityCandidate[] = [
  {
    activityId: 'ros-monumento-a-la-bandera',
    kind: 'POI',
    title: 'Monumento Histórico Nacional a la Bandera',
    durationMinutes: 90,
    semanticScore: 0.99,
    qualityScore: 0.98,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -32.9477, lng: -60.6305 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        '1': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 19 * 60 }],
        '2': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 19 * 60 }],
        '3': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 19 * 60 }],
        '4': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 19 * 60 }],
        '5': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 19 * 60 }],
        '6': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 19 * 60 }],
        '0': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 19 * 60 }],
      },
    },
  },
  {
    activityId: 'ros-parque-espana',
    kind: 'POI',
    title: 'Centro Cultural Parque de España & Costanera',
    durationMinutes: 75,
    semanticScore: 0.92,
    qualityScore: 0.93,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -32.9372, lng: -60.6361 },
    },
    formats: [ExperienceFormat.POINT_VISITS, ExperienceFormat.NEIGHBORHOOD_WALKS],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'ros-parque-independencia',
    kind: 'POI',
    title: 'Parque de la Independencia & Museo Castagnino',
    durationMinutes: 110,
    semanticScore: 0.91,
    qualityScore: 0.9,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -32.9555, lng: -60.6558 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        '1': [], // Closed Monday
        '2': [{ startMinutesFromMidnight: 13 * 60, endMinutesFromMidnight: 19 * 60 }],
        '3': [{ startMinutesFromMidnight: 13 * 60, endMinutesFromMidnight: 19 * 60 }],
        '4': [{ startMinutesFromMidnight: 13 * 60, endMinutesFromMidnight: 19 * 60 }],
        '5': [{ startMinutesFromMidnight: 13 * 60, endMinutesFromMidnight: 19 * 60 }],
        '6': [{ startMinutesFromMidnight: 13 * 60, endMinutesFromMidnight: 19 * 60 }],
        '0': [{ startMinutesFromMidnight: 13 * 60, endMinutesFromMidnight: 19 * 60 }],
      },
    },
  },
  {
    activityId: 'ros-bulevar-orono',
    kind: 'NEIGHBORHOOD_WALK',
    title: 'Paseo por Bulevar Oroño y Mansiones Históricas',
    durationMinutes: 80,
    semanticScore: 0.89,
    qualityScore: 0.88,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -32.9469, lng: -60.6489 },
    },
    formats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
    openingHours: { status: 'unknown' },
  },
];
