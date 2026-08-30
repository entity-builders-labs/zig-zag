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
    themes: ['wine', 'gastronomy', 'luxury'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        2: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        3: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        4: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        5: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        6: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        0: [], // Cerrado domingos
      },
    },
  },
  {
    activityId: 'sr-bodega-suter',
    kind: 'POI',
    title: 'Bodega Suter',
    durationMinutes: 75,
    semanticScore: 0.92,
    qualityScore: 0.9,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.612, lng: -68.375 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['wine', 'history'],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'sr-laberinto-borges',
    kind: 'POI',
    title: 'Laberinto de Borges',
    durationMinutes: 90,
    semanticScore: 0.95,
    qualityScore: 0.95,
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
    kind: 'COMPOSITE',
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
