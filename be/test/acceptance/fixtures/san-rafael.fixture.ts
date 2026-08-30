import { PlanningActivityCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export const SAN_RAFAEL_CANDIDATES: PlanningActivityCandidate[] = [
  {
    activityId: 'sr-canon-del-atuel',
    kind: 'ROUTE',
    title: 'Recorrido Cañón del Atuel',
    durationMinutes: 240,
    semanticScore: 0.99,
    qualityScore: 0.98,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.8258, lng: -68.4231 },
    },
    formats: [ExperienceFormat.THEMATIC_ROUTES],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'sr-valle-grande',
    kind: 'POI',
    title: 'Embalse Valle Grande',
    durationMinutes: 120,
    semanticScore: 0.95,
    qualityScore: 0.94,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.7825, lng: -68.4411 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'sr-bodega-bianchi',
    kind: 'POI',
    title: 'Bodegas Bianchi',
    durationMinutes: 90,
    semanticScore: 0.92,
    qualityScore: 0.93,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6191, lng: -68.3742 },
    },
    formats: [ExperienceFormat.POINT_VISITS, ExperienceFormat.EXPERIENCES],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        '1': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 17 * 60 }],
        '2': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 17 * 60 }],
        '3': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 17 * 60 }],
        '4': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 17 * 60 }],
        '5': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 17 * 60 }],
        '6': [{ startMinutesFromMidnight: 9 * 60, endMinutesFromMidnight: 13 * 60 }],
        '0': [], // Closed Sunday
      },
    },
  },
  {
    activityId: 'sr-laberinto-borges',
    kind: 'POI',
    title: 'Laberinto de Borges',
    durationMinutes: 90,
    semanticScore: 0.9,
    qualityScore: 0.91,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6492, lng: -68.2917 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        '1': [{ startMinutesFromMidnight: 10 * 60, endMinutesFromMidnight: 19 * 60 }],
        '2': [{ startMinutesFromMidnight: 10 * 60, endMinutesFromMidnight: 19 * 60 }],
        '3': [{ startMinutesFromMidnight: 10 * 60, endMinutesFromMidnight: 19 * 60 }],
        '4': [{ startMinutesFromMidnight: 10 * 60, endMinutesFromMidnight: 19 * 60 }],
        '5': [{ startMinutesFromMidnight: 10 * 60, endMinutesFromMidnight: 19 * 60 }],
        '6': [{ startMinutesFromMidnight: 10 * 60, endMinutesFromMidnight: 19 * 60 }],
        '0': [{ startMinutesFromMidnight: 10 * 60, endMinutesFromMidnight: 19 * 60 }],
      },
    },
  },
  {
    activityId: 'sr-plaza-francia',
    kind: 'POI',
    title: 'Plaza Francia & Parque Hipólito Yrigoyen',
    durationMinutes: 60,
    semanticScore: 0.82,
    qualityScore: 0.85,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6189, lng: -68.3417 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    openingHours: { status: 'unknown' },
  },
];
