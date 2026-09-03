import { TransportationMode } from './tour-generation.interface';

export type OvernightPolicy = 'same_day_only' | 'allow_overnight';

export interface DayTripOrigin {
  label: string;
  latitude: number;
  longitude: number;
}

export interface DayTripClockWindow {
  /** Minutes from local midnight. */
  earliestMinutesFromMidnight: number;
  /** Minutes from local midnight. May exceed 1440 only when overnight is allowed. */
  latestMinutesFromMidnight: number;
}

export interface OriginBoundOpenDestinationScope {
  kind: 'origin_bound_open';
  origin: DayTripOrigin;
  maxOutboundTravelMinutes: number;
  maxReturnTravelMinutes: number;
  departureWindow: DayTripClockWindow;
  returnWindow: DayTripClockWindow;
  overnightPolicy: OvernightPolicy;
  allowedTransportationModes: TransportationMode[];
}

export interface DestinationBoundScope {
  kind: 'destination_bound';
}

export type TourDiscoveryScope =
  | DestinationBoundScope
  | OriginBoundOpenDestinationScope;

export interface DayTripFeasibilityInput {
  scope: OriginBoundOpenDestinationScope;
  departureMinutesFromMidnight: number;
  outboundTravelMinutes: number;
  experienceDurationMinutes: number;
  returnTravelMinutes: number;
}

export interface DayTripFeasibilityResult {
  feasible: boolean;
  arrivalAtDestinationMinutesFromMidnight: number;
  departDestinationMinutesFromMidnight: number;
  arrivalBackAtOriginMinutesFromMidnight: number;
  overnight: boolean;
  reasonCodes: Array<
    | 'DEPARTURE_OUTSIDE_WINDOW'
    | 'OUTBOUND_TRAVEL_LIMIT_EXCEEDED'
    | 'RETURN_TRAVEL_LIMIT_EXCEEDED'
    | 'RETURN_AFTER_WINDOW'
    | 'OVERNIGHT_NOT_ALLOWED'
  >;
}
