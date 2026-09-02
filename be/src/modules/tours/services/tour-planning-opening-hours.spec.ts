import { TourPlanningFeasibilityValidatorService } from './tour-planning-feasibility-validator.service';
import { TransportationMode, TravelPace } from '../interfaces/tour-generation.interface';

describe('TourPlanningFeasibilityValidatorService opening-hours defense', () => {
  it('rejects a final routed schedule outside known opening hours', () => {
    const validator = new TourPlanningFeasibilityValidatorService();
    const input: any = {
      destination: {},
      requestedDays: 1,
      candidates: [
        {
          experienceId: 'museum',
          title: 'Museum',
          durationMinutes: 60,
          spatialFootprint: {
            type: 'POINT',
            centroid: { lat: -34.6, lng: -58.4 },
          },
          semanticScore: 1,
          openingHours: {
            status: 'known',
            rangesByWeekday: {
              1: [
                {
                  startMinutesFromMidnight: 9 * 60,
                  endMinutesFromMidnight: 10 * 60,
                },
              ],
            },
          },
        },
      ],
      mobility: {
        allowedTransportationModes: [TransportationMode.WALKING],
        maxWalkingDistancePerDayMeters: 10000,
        maxContinuousWalkingDistanceMeters: 3000,
        travelPace: TravelPace.MODERATE,
        accessibilityNeeds: [],
      },
      travelPace: TravelPace.MODERATE,
      planningWindow: {
        startMinutesFromMidnight: 9 * 60,
        endMinutesFromMidnight: 20 * 60,
      },
      startDates: ['2026-09-07'],
    };
    const solution: any = {
      days: [
        {
          dayNumber: 1,
          experiences: [
            {
              experienceId: 'museum',
              startMinutesFromMidnight: 11 * 60,
              endMinutesFromMidnight: 12 * 60,
            },
          ],
          totalExperienceMinutes: 60,
          totalTravelMinutes: 0,
          totalWalkingMinutes: 0,
          utilizationMinutes: 180,
        },
      ],
      unselected: [],
      score: 1,
      metadata: { solver: 'test', approximateTravel: false },
    };

    const result = validator.validate(solution, input);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OPENING_HOURS_INCOMPATIBLE' }),
      ]),
    );
  });
});
