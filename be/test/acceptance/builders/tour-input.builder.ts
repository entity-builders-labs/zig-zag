import {
  DailyPlanningInput,
  PlanningActivityCandidate,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import {
  TransportationMode,
  ExperienceFormat,
  TravelPace,
  MobilityPreferences,
} from 'src/modules/tours/interfaces/tour-generation.interface';
import { DestinationResolution } from 'src/modules/tours/services/destination-resolution.service';

export class TourInputBuilder {
  private input: DailyPlanningInput = {
    destination: {
      scale: 'point',
      attemptedQueries: ['Buenos Aires, Argentina'],
    } as DestinationResolution,
    requestedDays: 1,
    candidates: [],
    planningWindow: {
      startMinutesFromMidnight: 9 * 60, // 09:00
      endMinutesFromMidnight: 18 * 60, // 18:00
    },
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
    requestedFormats: [ExperienceFormat.POINT_VISITS],
    travelPace: TravelPace.MODERATE,
    startDates: ['2026-09-07T00:00:00.000Z'], // Monday
  };

  withDays(days: number): this {
    this.input.requestedDays = days;
    return this;
  }

  withCandidates(candidates: PlanningActivityCandidate[]): this {
    this.input.candidates = candidates;
    return this;
  }

  withPlanningWindow(startMinutes: number, endMinutes: number): this {
    this.input.planningWindow = {
      startMinutesFromMidnight: startMinutes,
      endMinutesFromMidnight: endMinutes,
    };
    return this;
  }

  withMobility(mobility: Partial<MobilityPreferences>): this {
    this.input.mobility = { ...this.input.mobility, ...mobility };
    return this;
  }

  withRequestedFormats(formats: ExperienceFormat[]): this {
    this.input.requestedFormats = formats;
    return this;
  }

  withTravelPace(pace: TravelPace): this {
    this.input.travelPace = pace;
    this.input.mobility.travelPace = pace;
    return this;
  }

  withStartDates(dates: string[]): this {
    this.input.startDates = dates;
    return this;
  }

  build(): DailyPlanningInput {
    return JSON.parse(JSON.stringify(this.input));
  }
}
