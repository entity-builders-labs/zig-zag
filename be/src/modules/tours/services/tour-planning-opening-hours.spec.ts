import { TourPlanningFeasibilityValidatorService } from './tour-planning-feasibility-validator.service';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';
import { GREEDY_PLANNING_POLICY_VERSIONS } from '../constants/planning-policy-versions';
import {
  LEGACY_DURATION_PROVENANCE,
  LEGACY_HOURS_PROVENANCE,
  legacyHoursByDay,
  planningDaysFixture,
  planningInputFixture,
  singleVisitCandidate,
} from '../fixtures/planning-input.fixture';

describe('TourPlanningFeasibilityValidatorService opening-hours defense', () => {
  it('rejects a final routed schedule outside known opening hours', () => {
    const validator = new TourPlanningFeasibilityValidatorService();
    // 2026-09-07 is a Monday; the museum opens 09:00-10:00 on Mondays.
    const days = planningDaysFixture(1, {
      startDate: '2026-09-07',
      window: {
        startMinutesFromMidnight: 9 * 60,
        endMinutesFromMidnight: 20 * 60,
      },
    });
    const input = planningInputFixture({
      days,
      candidates: [
        singleVisitCandidate({
          experienceId: 'museum',
          title: 'Museum',
          durationMinutes: 60,
          lat: -34.6,
          lng: -58.4,
          preferenceRank: 1,
          openingHoursByDay: legacyHoursByDay(
            {
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
            days,
          ),
        }),
      ],
    });
    const solution: DailyPlanningSolution = {
      days: [
        {
          dayNumber: 1,
          date: days[0].date,
          experiences: [
            {
              experienceId: 'museum',
              startMinutesFromMidnight: 11 * 60,
              endMinutesFromMidnight: 12 * 60,
              travelFromPrevious: null,
              duration: { minutes: 60, provenance: LEGACY_DURATION_PROVENANCE },
              openingHours: {
                status: 'UNKNOWN',
                provenance: LEGACY_HOURS_PROVENANCE,
              },
              bindingConstraints: [],
            },
          ],
          totalExperienceMinutes: 60,
          totalTravelMinutes: 0,
          totalWalkingMinutes: 0,
          utilizationMinutes: 180,
          residual: { dayNumber: 1, availableMinutes: 480, meaningful: true },
          firstLastMileTravel: 'EXCLUDED_NO_ANCHOR',
        },
      ],
      unselected: [],
      inputErrors: [],
      score: 1,
      metadata: {
        solver: 'test',
        policies: GREEDY_PLANNING_POLICY_VERSIONS,
        approximateTravel: false,
        routing: {
          externalEstimateCount: 0,
          internalEstimateCount: 0,
          approximateEstimateCount: 0,
          fallbackCount: 0,
          providerCounts: {},
        },
        legs: { byMode: {}, providerBacked: 0, approximate: 0 },
        constraints: {
          days,
          allowedTransportationModes: input.mobility.allowedTransportationModes,
          maxWalkingDistancePerDayMeters:
            input.mobility.maxWalkingDistancePerDayMeters,
          maxContinuousWalkingDistanceMeters:
            input.mobility.maxContinuousWalkingDistanceMeters,
          cycling: null,
          travelPace: input.travelPace,
        },
      },
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
