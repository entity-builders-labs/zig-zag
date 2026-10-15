import {
  DailyPlanningInput,
  PlanningExperienceCandidate,
  DailyPlanningWindow,
  PlanningMobilityConstraints,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import {
  TravelPace,
  TransportationMode,
} from 'src/modules/tours/interfaces/tour-generation.interface';
import { GREEDY_PLANNING_POLICY_VERSIONS } from 'src/modules/tours/constants/planning-policy-versions';
import { buildPlanningDays } from 'src/modules/tours/utils/planning-days.util';
import { resolveForDays } from './point-footprints.util';

export class TourInputBuilder {
  private requestedDays = 3;
  private startDates: string[] = ['2026-09-07T00:00:00.000Z']; // Monday
  private planningWindow: DailyPlanningWindow = {
    startMinutesFromMidnight: 9 * 60, // 09:00
    endMinutesFromMidnight: 20 * 60, // 20:00
  };
  private candidates: PlanningExperienceCandidate[] = [];
  private mobility: PlanningMobilityConstraints = {
    allowedTransportationModes: [
      TransportationMode.WALKING,
      TransportationMode.PUBLIC_TRANSPORT,
    ],
    maxWalkingDistancePerDayMeters: 6000,
    maxContinuousWalkingDistanceMeters: 1500,
    cycling: null,
  };
  private travelPace = TravelPace.MODERATE;

  static aTourInput(): TourInputBuilder {
    return new TourInputBuilder();
  }

  withDays(days: number): this {
    return this.withRequestedDays(days);
  }

  withRequestedDays(days: number): this {
    this.requestedDays = days;
    return this;
  }

  withCandidates(candidates: PlanningExperienceCandidate[]): this {
    this.candidates = candidates;
    return this;
  }

  addCandidates(...candidates: PlanningExperienceCandidate[]): this {
    this.candidates.push(...candidates);
    return this;
  }

  withMobility(mobility: Partial<PlanningMobilityConstraints>): this {
    this.mobility = {
      allowedTransportationModes: mobility.allowedTransportationModes ?? [
        TransportationMode.WALKING,
      ],
      maxWalkingDistancePerDayMeters:
        mobility.maxWalkingDistancePerDayMeters ?? 6000,
      maxContinuousWalkingDistanceMeters:
        mobility.maxContinuousWalkingDistanceMeters ?? 1500,
      cycling: mobility.cycling ?? null,
    };
    return this;
  }

  withTravelPace(pace: TravelPace): this {
    this.travelPace = pace;
    return this;
  }

  withPlanningWindow(
    windowOrStart: DailyPlanningWindow | number,
    end?: number,
  ): this {
    if (typeof windowOrStart === 'number' && typeof end === 'number') {
      this.planningWindow = {
        startMinutesFromMidnight: windowOrStart,
        endMinutesFromMidnight: end,
      };
    } else if (typeof windowOrStart === 'object') {
      this.planningWindow = windowOrStart;
    }
    return this;
  }

  withStartDates(datesOrFirst: string[] | string, ...rest: string[]): this {
    this.startDates = Array.isArray(datesOrFirst)
      ? datesOrFirst
      : [datesOrFirst, ...rest];
    return this;
  }

  build(): DailyPlanningInput {
    const days = buildPlanningDays({
      requestedDays: this.requestedDays,
      startDates: this.startDates,
      window: this.planningWindow,
    });
    return {
      days,
      candidates: this.candidates.map((candidate) =>
        resolveForDays(candidate, days),
      ),
      mobility: { ...this.mobility },
      travelPace: this.travelPace,
      policies: GREEDY_PLANNING_POLICY_VERSIONS,
    };
  }
}
