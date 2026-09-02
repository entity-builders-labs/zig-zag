import * as fc from 'fast-check';
import { PlanningExperienceCandidate, NormalizedOpeningHours } from 'src/modules/tours/interfaces/daily-planning.interface';

export const arbitraryOpeningHours = (): fc.Arbitrary<NormalizedOpeningHours> => fc.constant({ status: 'unknown' as const });
export const arbitraryCandidate = (prefix = 'experience'): fc.Arbitrary<PlanningExperienceCandidate> => fc.record({
  experienceId: fc.uuid().map(id => `${prefix}-${id}`), title: fc.string({ minLength: 3, maxLength: 30 }),
  durationMinutes: fc.integer({ min: 30, max: 180 }), semanticScore: fc.double({ min: 0.1, max: 1, noNaN: true }),
  qualityScore: fc.double({ min: 0.1, max: 1, noNaN: true }), themes: fc.array(fc.constantFrom('nature','culture','food'), { maxLength: 3 }),
  spatialFootprint: fc.record({ type: fc.constant<'POINT'>('POINT'), centroid: fc.record({ lat: fc.double({ min: -34.7, max: -34.5, noNaN: true }), lng: fc.double({ min: -58.5, max: -58.3, noNaN: true }) }) }),
  openingHours: arbitraryOpeningHours(),
});
export const arbitraryCandidatePool = (minCount = 5, maxCount = 30): fc.Arbitrary<PlanningExperienceCandidate[]> => fc.uniqueArray(arbitraryCandidate(), { minLength: minCount, maxLength: maxCount, selector: c => c.experienceId });
