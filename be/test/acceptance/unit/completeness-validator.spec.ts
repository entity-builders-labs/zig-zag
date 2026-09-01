import { TourCompletenessValidator } from 'src/modules/tours/services/tour-completeness-validator.service';
import { TravelPace } from 'src/modules/tours/interfaces/tour-generation.interface';

describe('Unit Acceptance: Tour Completeness Validator (TC-VAL-01 to TC-VAL-03)', () => {
  let validator: TourCompletenessValidator;

  beforeEach(() => {
    validator = new TourCompletenessValidator();
  });

  it('TC-VAL-01: valid itinerary with sufficient meaningful hours passes completeness', () => {
    const result = validator.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      viableUnusedCandidateCount: 5,
      selectedActivities: [
        {
          activityId: 'act-1',
          dayNumber: 1,
          durationHours: 2.5,
          isMeal: false,
        },
        {
          activityId: 'act-2',
          dayNumber: 1,
          durationHours: 2.0,
          isMeal: false,
        },
      ],
    });

    expect(result.complete).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('TC-VAL-02: thin day with viable unused candidates fails completeness', () => {
    const result = validator.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      viableUnusedCandidateCount: 10,
      selectedActivities: [
        {
          activityId: 'act-1',
          dayNumber: 1,
          durationHours: 0.5,
          isMeal: false,
        },
      ],
    });

    expect(result.complete).toBe(false);
    expect(result.issues.some((i) => i.dayNumber === 1)).toBe(true);
  });

  it('TC-VAL-03: thin day passes when candidate pool is genuinely exhausted (viableUnusedCandidateCount === 0)', () => {
    const result = validator.validate({
      requestedDays: 1,
      travelPace: TravelPace.MODERATE,
      isFoodFocusedIntent: false,
      viableUnusedCandidateCount: 0,
      selectedActivities: [
        {
          activityId: 'act-1',
          dayNumber: 1,
          durationHours: 0.5,
          isMeal: false,
        },
      ],
    });

    // Feasibility > Padding: if pool is exhausted, validator does not flag false positive
    expect(result.complete).toBe(true);
  });
});
