import { PlanningExperienceCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';

export const VILLA_GENERAL_BELGRANO_CANDIDATES: PlanningExperienceCandidate[] =
  Array.from({ length: 12 }, (_, i) => ({
    experienceId: 'villa_general_belgrano-' + i,
    title: 'VILLA_GENERAL_BELGRANO Experience ' + i,
    durationMinutes: 60 + (i % 3) * 30,
    semanticScore: 0.9 - i * 0.01,
    qualityScore: 0.85,
    themes: i % 2 ? ['culture'] : ['nature'],
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6 + i * 0.001, lng: -58.4 + i * 0.001 },
    },
    openingHours: { status: 'unknown' },
  }));

export const VGB_CANDIDATES = VILLA_GENERAL_BELGRANO_CANDIDATES;
