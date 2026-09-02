import { TourCompletenessValidator } from './tour-completeness-validator.service';
import { TravelPace } from '../interfaces/tour-generation.interface';
import { TourCompletenessSelectedExperience } from '../interfaces/tour-completeness.interface';

describe('TourCompletenessValidator', () => {
  let service: TourCompletenessValidator;

  beforeEach(() => {
    service = new TourCompletenessValidator();
  });

  function experience(
    overrides: Partial<TourCompletenessSelectedExperience>,
  ): TourCompletenessSelectedExperience {
    return {
      experienceId: 'exp-1',
      dayNumber: 1,
      durationHours: 1,
      isMeal: false,
      ...overrides,
    };
  }

  it('flags a moderate 1-day tour with 2 short activities and many viable candidates left (Case A)', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [
        experience({ experienceId: 'museum', durationHours: 1.5 }),
        experience({ experienceId: 'restaurant', durationHours: 1, isMeal: true }),
      ],
      viableUnusedCandidateCount: 12,
    });

    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'UNDERFILLED_DAY', dayNumber: 1 }),
    ]);
  });

  it('accepts a moderate 1-day tour with 2 long composites filling most of the day (Case B)', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [
        experience({ experienceId: 'walk', durationHours: 3 }),
        experience({ experienceId: 'museum', durationHours: 3 }),
      ],
      viableUnusedCandidateCount: 12,
    });

    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags restaurant + short museum only, moderate pace, when the request is not food-focused', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [
        experience({ experienceId: 'museum', durationHours: 1 }),
        experience({
          experienceId: 'restaurant',
          durationHours: 1.5,
          isMeal: true,
        }),
      ],
      viableUnusedCandidateCount: 6,
    });

    expect(result.complete).toBe(false);
  });

  it('accepts a food-focused itinerary built mostly from meal/food-experience stops', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: true,
      selectedExperiences: [
        experience({ experienceId: 'market', durationHours: 1.5, isMeal: true }),
        experience({ experienceId: 'lunch', durationHours: 1.5, isMeal: true }),
        experience({ experienceId: 'dinner', durationHours: 1.5, isMeal: true }),
      ],
      viableUnusedCandidateCount: 6,
    });

    expect(result.complete).toBe(true);
  });

  it('accepts lower density for relaxed pace than it would for fast pace, same activities', () => {
    const selectedExperiences = [
      experience({ experienceId: 'poi-1', durationHours: 1 }),
      experience({ experienceId: 'poi-2', durationHours: 1 }),
    ];

    const relaxed = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.RELAXED,
      isFoodFocusedIntent: false,
      selectedExperiences,
      viableUnusedCandidateCount: 8,
    });
    const fast = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.FAST,
      isFoodFocusedIntent: false,
      selectedExperiences,
      viableUnusedCandidateCount: 8,
    });

    expect(relaxed.complete).toBe(true);
    expect(fast.complete).toBe(false);
  });

  it('flags a fast-pace day with only 2 short activities and viable candidates remaining', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.FAST,
      isFoodFocusedIntent: false,
      selectedExperiences: [
        experience({ experienceId: 'poi-1', durationHours: 1 }),
        experience({ experienceId: 'poi-2', durationHours: 1 }),
      ],
      viableUnusedCandidateCount: 10,
    });

    expect(result.complete).toBe(false);
  });

  it('does not flag a thin day when the candidate pool is genuinely exhausted', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [experience({ experienceId: 'poi-1', durationHours: 1 })],
      viableUnusedCandidateCount: 0,
    });

    expect(result.complete).toBe(true);
  });

  it('lets a single long neighborhood walk satisfy a moderate day despite a low item count', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [experience({ experienceId: 'walk', durationHours: 4 })],
      viableUnusedCandidateCount: 12,
    });

    expect(result.complete).toBe(true);
  });

  it('does not flag a fully empty result when the pool is exhausted (no-hallucination path)', () => {
    const result = service.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [],
      viableUnusedCandidateCount: 0,
    });

    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('identifies only the affected day in a multi-day tour with one filled and one under-filled day', () => {
    const result = service.validate({
      requestedDays: 2,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [
        experience({ experienceId: 'walk-day1', dayNumber: 1, durationHours: 4 }),
        experience({ experienceId: 'poi-day2', dayNumber: 2, durationHours: 1 }),
      ],
      viableUnusedCandidateCount: 8,
    });

    expect(result.complete).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual(
      expect.objectContaining({ dayNumber: 2, code: 'UNDERFILLED_DAY' }),
    );
  });

  it('flags a day the LLM omitted entirely when viable candidates remain', () => {
    const result = service.validate({
      requestedDays: 2,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      selectedExperiences: [
        experience({ experienceId: 'walk-day1', dayNumber: 1, durationHours: 4 }),
        // day 2 has no activities at all
      ],
      viableUnusedCandidateCount: 5,
    });

    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        dayNumber: 2,
        selectedExperienceCount: 0,
        code: 'UNDERFILLED_DAY',
      }),
    ]);
  });
});
