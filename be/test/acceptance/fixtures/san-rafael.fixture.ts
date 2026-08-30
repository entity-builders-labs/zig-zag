import { ActivityKind } from '@prisma/client';
import { PlanningActivityCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export const SAN_RAFAEL_CANDIDATES: PlanningActivityCandidate[] = [
  // Rama Caída - Circuito de Bodegas Boutique
  {
    activityId: 'sr-bodega-bianchi',
    kind: 'POI',
    title: 'Bodegas Valentín Bianchi',
    durationMinutes: 90,
    semanticScore: 0.98,
    qualityScore: 0.96,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.618, lng: -68.397 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['wine', 'gastronomy', 'boutique'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        2: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        3: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        4: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        5: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        6: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        0: [],
      },
    },
  },
  {
    activityId: 'sr-finca-los-alamos',
    kind: 'POI',
    title: 'Finca Los Álamos & Laberinto de Borges',
    durationMinutes: 90,
    semanticScore: 0.95,
    qualityScore: 0.94,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.632, lng: -68.375 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['literature', 'nature', 'wine'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1140 }],
        2: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1140 }],
        3: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1140 }],
        4: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1140 }],
        5: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1140 }],
        6: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1140 }],
        0: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1140 }],
      },
    },
  },
  {
    activityId: 'sr-plaza-francia',
    kind: 'POI',
    title: 'Parque Hipólito Yrigoyen y Plaza Francia',
    durationMinutes: 60,
    semanticScore: 0.91,
    qualityScore: 0.9,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.655, lng: -68.278 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['nature', 'culture', 'literature'],
    openingHours: { status: 'unknown' },
  },

  // Cañón del Atuel & Valle Grande (Distancia de conducción)
  {
    activityId: 'sr-canon-del-atuel',
    kind: ActivityKind.ROUTE,
    title: 'Ruta Escénica del Cañón del Atuel',
    durationMinutes: 180,
    semanticScore: 0.99,
    qualityScore: 0.98,
    spatialFootprint: {
      type: 'LINE',
      centroid: { lat: -34.82, lng: -68.58 },
    },
    formats: [ExperienceFormat.THEMATIC_ROUTES],
    themes: ['nature', 'adventure', 'landscape'],
  },
  {
    activityId: 'sr-dique-valle-grande',
    kind: 'POI',
    title: 'Dique y Embalse Valle Grande',
    durationMinutes: 90,
    semanticScore: 0.94,
    qualityScore: 0.92,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.815, lng: -68.495 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['nature', 'water', 'landscape'],
  },
];
