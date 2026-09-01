import * as fc from 'fast-check';
import {
  PlanningActivityCandidate,
  NormalizedOpeningHours,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export const arbitraryOpeningHours = (): fc.Arbitrary<NormalizedOpeningHours> =>
  fc.oneof(
    fc.constant<NormalizedOpeningHours>({ status: 'unknown' }),
    fc.record({
      status: fc.constant<'known'>('known'),
      rangesByWeekday: fc.dictionary(
        fc.integer({ min: 0, max: 6 }).map(String),
        fc.array(
          fc.record({
            startMinutesFromMidnight: fc.integer({ min: 8 * 60, max: 12 * 60 }),
            endMinutesFromMidnight: fc.integer({ min: 14 * 60, max: 22 * 60 }),
          }),
          { minLength: 0, maxLength: 2 },
        ),
      ),
    }),
  );

export const arbitraryCandidate = (
  idPrefix = 'cand',
): fc.Arbitrary<PlanningActivityCandidate> =>
  fc.record({
    activityId: fc
      .stringMatching(/^[a-z0-9-]{6,12}$/)
      .map((id) => `${idPrefix}-${id}`),
    kind: fc.constant<'POI'>('POI'),
    title: fc.lorem({ maxCount: 3 }),
    durationMinutes: fc.integer({ min: 30, max: 180 }),
    semanticScore: fc.double({ min: 0.1, max: 1.0, noNaN: true }),
    qualityScore: fc.double({ min: 0.1, max: 1.0, noNaN: true }),
    spatialFootprint: fc.record({
      type: fc.constant<'POINT'>('POINT'),
      centroid: fc.record({
        lat: fc.double({ min: -34.7, max: -34.5, noNaN: true }),
        lng: fc.double({ min: -58.5, max: -58.3, noNaN: true }),
      }),
    }),
    formats: fc.subarray<ExperienceFormat>(
      [
        ExperienceFormat.POINT_VISITS,
        ExperienceFormat.NEIGHBORHOOD_WALKS,
        ExperienceFormat.THEMATIC_ROUTES,
      ],
      { minLength: 1 },
    ),
    openingHours: arbitraryOpeningHours(),
  });

export const arbitraryCandidatePool = (
  minCount = 5,
  maxCount = 30,
): fc.Arbitrary<PlanningActivityCandidate[]> =>
  fc.uniqueArray(arbitraryCandidate(), {
    minLength: minCount,
    maxLength: maxCount,
    selector: (c) => c.activityId,
  });
