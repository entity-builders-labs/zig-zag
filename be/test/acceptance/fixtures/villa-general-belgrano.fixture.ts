import { PlanningActivityCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export const VGB_CANDIDATES: PlanningActivityCandidate[] = [
  {
    activityId: 'vgb-centro-historico',
    kind: 'NEIGHBORHOOD_WALK',
    title: 'Centro Histórico y Arquitectura Alpina',
    durationMinutes: 90,
    semanticScore: 0.96,
    qualityScore: 0.94,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -31.9772, lng: -64.5564 },
    },
    formats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'vgb-cerro-de-la-virgen',
    kind: 'ROUTE',
    title: 'Sendero al Cerro de la Virgen y Pico Alemán',
    durationMinutes: 120,
    semanticScore: 0.93,
    qualityScore: 0.92,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -31.9689, lng: -64.5422 },
    },
    formats: [ExperienceFormat.THEMATIC_ROUTES],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'vgb-cerveceria-artesanal',
    kind: 'POI',
    title: 'Degustación en Cervecería Artesanal Tradicional',
    durationMinutes: 75,
    semanticScore: 0.9,
    qualityScore: 0.89,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -31.9785, lng: -64.5581 },
    },
    formats: [ExperienceFormat.POINT_VISITS, ExperienceFormat.EXPERIENCES],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        '1': [{ startMinutesFromMidnight: 12 * 60, endMinutesFromMidnight: 23 * 60 }],
        '2': [{ startMinutesFromMidnight: 12 * 60, endMinutesFromMidnight: 23 * 60 }],
        '3': [{ startMinutesFromMidnight: 12 * 60, endMinutesFromMidnight: 23 * 60 }],
        '4': [{ startMinutesFromMidnight: 12 * 60, endMinutesFromMidnight: 23 * 60 }],
        '5': [{ startMinutesFromMidnight: 12 * 60, endMinutesFromMidnight: 23 * 60 }],
        '6': [{ startMinutesFromMidnight: 12 * 60, endMinutesFromMidnight: 23 * 60 }],
        '0': [{ startMinutesFromMidnight: 12 * 60, endMinutesFromMidnight: 23 * 60 }],
      },
    },
  },
  {
    activityId: 'vgb-paseo-de-los-arroyos',
    kind: 'NEIGHBORHOOD_WALK',
    title: 'Paseo de los Arroyos',
    durationMinutes: 60,
    semanticScore: 0.88,
    qualityScore: 0.87,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -31.9811, lng: -64.5612 },
    },
    formats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
    openingHours: { status: 'unknown' },
  },
];
