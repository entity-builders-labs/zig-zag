import {
  DailyPlanningInput,
  PlanningActivityCandidate,
  DailyPlanningWindow,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import {
  ExperienceFormat,
  MobilityPreferences,
  TravelPace,
  TransportationMode,
} from 'src/modules/tours/interfaces/tour-generation.interface';
import { DestinationResolution } from 'src/modules/tours/services/destination-resolution.service';

export class TourInputBuilder {
  private input: DailyPlanningInput;

  constructor() {
    const defaultDest: DestinationResolution = {
      scale: 'point',
      attemptedQueries: ['Buenos Aires, Argentina'],
    };

    this.input = {
      destination: defaultDest,
      requestedDays: 3,
      candidates: [],
      mobility: {
        allowedTransportationModes: [
          TransportationMode.WALKING,
          TransportationMode.PUBLIC_TRANSPORT,
        ],
        maxWalkingDistancePerDayMeters: 6000,
        maxContinuousWalkingDistanceMeters: 1500,
        travelPace: TravelPace.MODERATE,
        accessibilityNeeds: [],
      },
      travelPace: TravelPace.MODERATE,
      planningWindow: {
        startMinutesFromMidnight: 9 * 60, // 09:00
        endMinutesFromMidnight: 20 * 60, // 20:00
      },
      startDates: ['2026-09-07T00:00:00.000Z'], // Monday
    };
  }

  static aTourInput(): TourInputBuilder {
    return new TourInputBuilder();
  }

  withDays(days: number): this {
    return this.withRequestedDays(days);
  }

  withRequestedDays(days: number): this {
    this.input.requestedDays = days;
    return this;
  }

  withDestination(dest: DestinationResolution): this {
    this.input.destination = dest;
    return this;
  }

  withCandidates(candidates: PlanningActivityCandidate[]): this {
    this.input.candidates = candidates;
    return this;
  }

  addCandidates(...candidates: PlanningActivityCandidate[]): this {
    this.input.candidates.push(...candidates);
    return this;
  }

  withMobility(mobility: Partial<MobilityPreferences>): this {
    this.input.mobility = {
      allowedTransportationModes: mobility.allowedTransportationModes ?? [
        TransportationMode.WALKING,
      ],
      maxWalkingDistancePerDayMeters:
        mobility.maxWalkingDistancePerDayMeters ?? 6000,
      maxContinuousWalkingDistanceMeters:
        mobility.maxContinuousWalkingDistanceMeters ?? 1500,
      travelPace: mobility.travelPace ?? TravelPace.MODERATE,
      accessibilityNeeds: mobility.accessibilityNeeds ?? [],
    };
    return this;
  }

  withTravelPace(pace: TravelPace): this {
    this.input.travelPace = pace;
    return this;
  }

  withPlanningWindow(
    windowOrStart: DailyPlanningWindow | number,
    end?: number,
  ): this {
    if (typeof windowOrStart === 'number' && typeof end === 'number') {
      this.input.planningWindow = {
        startMinutesFromMidnight: windowOrStart,
        endMinutesFromMidnight: end,
      };
    } else if (typeof windowOrStart === 'object') {
      this.input.planningWindow = windowOrStart;
    }
    return this;
  }

  withRequestedFormats(
    formatsOrFirst: ExperienceFormat[] | ExperienceFormat,
    ...rest: ExperienceFormat[]
  ): this {
    if (Array.isArray(formatsOrFirst)) {
      this.input.requestedFormats = formatsOrFirst;
    } else {
      this.input.requestedFormats = [formatsOrFirst, ...rest];
    }
    return this;
  }

  withStartDates(datesOrFirst: string[] | string, ...rest: string[]): this {
    if (Array.isArray(datesOrFirst)) {
      this.input.startDates = datesOrFirst;
    } else {
      this.input.startDates = [datesOrFirst, ...rest];
    }
    return this;
  }

  build(): DailyPlanningInput {
    return { ...this.input };
  }
}
