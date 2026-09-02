import { PlanningExperienceCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';

export const BUENOS_AIRES_CANDIDATES: PlanningExperienceCandidate[] = Array.from({ length: 12 }, (_, i) => ({
  experienceId: 'buenos_aires-' + i,
  title: 'BUENOS_AIRES Experience ' + i,
  durationMinutes: 60 + (i % 3) * 30,
  semanticScore: 0.9 - i * 0.01,
  qualityScore: 0.85,
  themes: i % 2 ? ['culture'] : ['nature'],
  spatialFootprint: { type: 'POINT', centroid: { lat: -34.6 + i * 0.001, lng: -58.4 + i * 0.001 } },
  openingHours: { status: 'unknown' },
}));

