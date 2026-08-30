import { PlanningActivityCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export const BUENOS_AIRES_CANDIDATES: PlanningActivityCandidate[] = [
  // Zona San Telmo / Monserrat (Centro Histórico)
  {
    activityId: 'ba-plaza-de-mayo',
    kind: 'POI',
    title: 'Plaza de Mayo y Cabildo',
    durationMinutes: 60,
    semanticScore: 0.98,
    qualityScore: 0.95,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6083, lng: -58.3712 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['history', 'architecture', 'culture'],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'ba-catedral-metropolitana',
    kind: 'POI',
    title: 'Catedral Metropolitana',
    durationMinutes: 45,
    semanticScore: 0.9,
    qualityScore: 0.88,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6075, lng: -58.3732 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['history', 'architecture', 'religion'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        2: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        3: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        4: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        5: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        6: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1020 }],
        0: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1020 }],
      },
    },
  },
  {
    activityId: 'ba-mercado-san-telmo',
    kind: 'POI',
    title: 'Mercado de San Telmo',
    durationMinutes: 75,
    semanticScore: 0.94,
    qualityScore: 0.92,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6186, lng: -58.3727 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['gastronomy', 'antiques', 'culture'],
    openingHours: { status: 'unknown' },
  },
  {
    activityId: 'ba-san-telmo-walk',
    kind: 'COMPOSITE',
    title: 'Paseo Histórico de Adoquines de San Telmo',
    durationMinutes: 90,
    semanticScore: 0.96,
    qualityScore: 0.94,
    spatialFootprint: {
      type: 'AREA',
      centroid: { lat: -34.618, lng: -58.371 },
    },
    formats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
    themes: ['history', 'architecture', 'culture'],
    familyId: 'family-san-telmo-walks',
    variantKey: 'walk-full',
  },

  // Zona Recoleta / Retiro
  {
    activityId: 'ba-cementerio-recoleta',
    kind: 'POI',
    title: 'Cementerio de la Recoleta',
    durationMinutes: 75,
    semanticScore: 0.95,
    qualityScore: 0.96,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.5878, lng: -58.3927 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['history', 'architecture', 'culture'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1020 }],
        2: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1020 }],
        3: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1020 }],
        4: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1020 }],
        5: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1020 }],
        6: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1020 }],
        0: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1020 }],
      },
    },
  },
  {
    activityId: 'ba-museo-bellas-artes',
    kind: 'POI',
    title: 'Museo Nacional de Bellas Artes (MNBA)',
    durationMinutes: 90,
    semanticScore: 0.93,
    qualityScore: 0.95,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.584, lng: -58.393 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['art', 'culture', 'museum'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [], // Cerrado los Lunes
        2: [{ startMinutesFromMidnight: 660, endMinutesFromMidnight: 1200 }],
        3: [{ startMinutesFromMidnight: 660, endMinutesFromMidnight: 1200 }],
        4: [{ startMinutesFromMidnight: 660, endMinutesFromMidnight: 1200 }],
        5: [{ startMinutesFromMidnight: 660, endMinutesFromMidnight: 1200 }],
        6: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1200 }],
        0: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 1200 }],
      },
    },
  },
  {
    activityId: 'ba-teatro-colon',
    kind: 'POI',
    title: 'Teatro Colón',
    durationMinutes: 60,
    semanticScore: 0.97,
    qualityScore: 0.98,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6011, lng: -58.3831 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['architecture', 'music', 'culture'],
    openingHours: { status: 'unknown' },
  },

  // Zona Palermo
  {
    activityId: 'ba-jardin-botanico',
    kind: 'POI',
    title: 'Jardín Botánico Carlos Thays',
    durationMinutes: 60,
    semanticScore: 0.88,
    qualityScore: 0.9,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.582, lng: -58.417 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['nature', 'family', 'relax'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [], // Cerrado Lunes
        2: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        3: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        4: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        5: [{ startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 }],
        6: [{ startMinutesFromMidnight: 570, endMinutesFromMidnight: 1080 }],
        0: [{ startMinutesFromMidnight: 570, endMinutesFromMidnight: 1080 }],
      },
    },
  },
  {
    activityId: 'ba-malba',
    kind: 'POI',
    title: 'MALBA (Museo de Arte Latinoamericano)',
    durationMinutes: 90,
    semanticScore: 0.94,
    qualityScore: 0.96,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.5772, lng: -58.4038 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['art', 'culture', 'museum'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1200 }],
        2: [], // Cerrado Martes
        3: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1200 }],
        4: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1200 }],
        5: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1200 }],
        6: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1200 }],
        0: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 1200 }],
      },
    },
  },
  {
    activityId: 'ba-parrilla-don-julio',
    kind: 'POI',
    title: 'Parrilla Don Julio',
    durationMinutes: 90,
    semanticScore: 0.92,
    qualityScore: 0.97,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.5888, lng: -58.424 },
    },
    formats: [ExperienceFormat.POINT_VISITS],
    themes: ['gastronomy', 'food'],
    openingHours: {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 960 }, { startMinutesFromMidnight: 1140, endMinutesFromMidnight: 1440 }],
        2: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 960 }, { startMinutesFromMidnight: 1140, endMinutesFromMidnight: 1440 }],
        3: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 960 }, { startMinutesFromMidnight: 1140, endMinutesFromMidnight: 1440 }],
        4: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 960 }, { startMinutesFromMidnight: 1140, endMinutesFromMidnight: 1440 }],
        5: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 960 }, { startMinutesFromMidnight: 1140, endMinutesFromMidnight: 1440 }],
        6: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 960 }, { startMinutesFromMidnight: 1140, endMinutesFromMidnight: 1440 }],
        0: [{ startMinutesFromMidnight: 720, endMinutesFromMidnight: 960 }, { startMinutesFromMidnight: 1140, endMinutesFromMidnight: 1440 }],
      },
    },
  },
];
