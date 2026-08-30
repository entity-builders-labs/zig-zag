import { ActivityKind } from '@prisma/client';
import { PlanningActivityCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export const VILLA_GENERAL_BELGRANO_CANDIDATES: PlanningActivityCandidate[] = [
  {
    activityId: 'vgb-paseo-arroyos',
    kind: ActivityKind.NEIGHBORHOOD_WALK,
    title: 'Paseo de los Arroyos y Sendero Natural',
    durationMinutes: 90,
    semanticScore: 0.96,
    qualityScore: 0.94,
    spatialFootprint: {
      type: 'LINE',
      centroid: { lat: -31.977, lng: -64.558 },
    },
    formats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
    themes: ['nature', 'hiking', 'alpine'],
  },
  {
    activityId: 'vgb-cerveceria-berna',
    kind: 'POI',
    title: 'Cervecería Artesanal Berna',
    durationMinutes: 75,
    semanticScore: 0.92,
    qualityScore: 0.9,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -31.979, lng: -64.556 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['beer', 'gastronomy', 'craft'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1440 }],
        2: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1440 }],
        3: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1440 }],
        4: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1440 }],
        5: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1440 }],
        6: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1440 }],
        0: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1440 }],
      },
    },
  },
  {
    activityId: 'vgb-pozo-verde',
    kind: 'POI',
    title: 'Reserva Natural Pozo Verde',
    durationMinutes: 90,
    semanticScore: 0.94,
    qualityScore: 0.93,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -31.965, lng: -64.568 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['nature', 'forest', 'hiking'],
  },
];

export const VGB_CANDIDATES = VILLA_GENERAL_BELGRANO_CANDIDATES;

export const ROSARIO_CANDIDATES: PlanningActivityCandidate[] = [
  {
    activityId: 'ros-monumento-bandera',
    kind: 'POI',
    title: 'Monumento Histórico Nacional a la Bandera',
    durationMinutes: 75,
    semanticScore: 0.98,
    qualityScore: 0.97,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -32.9477, lng: -60.6304 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['history', 'monument', 'culture'],
    metadata: { source: 'osm' },
  },
  {
    activityId: 'ros-parque-espana',
    kind: 'POI',
    title: 'Parque de España y Centro Cultural',
    durationMinutes: 60,
    semanticScore: 0.91,
    qualityScore: 0.92,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -32.9372, lng: -60.6375 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['nature', 'river', 'culture'],
  },
];
