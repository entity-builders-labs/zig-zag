import { TransportationMode } from '../interfaces/tour-generation.interface';
import { OriginBoundOpenDestinationScope } from '../interfaces/day-trip.interface';
import { evaluateDayTripFeasibility } from './day-trip-feasibility.util';

function scope(
  overrides: Partial<OriginBoundOpenDestinationScope> = {},
): OriginBoundOpenDestinationScope {
  return {
    kind: 'origin_bound_open',
    origin: {
      label: 'Buenos Aires',
      latitude: -34.6037,
      longitude: -58.3816,
    },
    maxOutboundTravelMinutes: 180,
    maxReturnTravelMinutes: 180,
    departureWindow: {
      earliestMinutesFromMidnight: 7 * 60,
      latestMinutesFromMidnight: 9 * 60,
    },
    returnWindow: {
      earliestMinutesFromMidnight: 18 * 60,
      latestMinutesFromMidnight: 23 * 60,
    },
    overnightPolicy: 'same_day_only',
    allowedTransportationModes: [TransportationMode.DRIVING],
    ...overrides,
  };
}

describe('evaluateDayTripFeasibility', () => {
  it('accepts a same-day escape only when outbound, experience and return fit', () => {
    const result = evaluateDayTripFeasibility({
      scope: scope(),
      departureMinutesFromMidnight: 8 * 60,
      outboundTravelMinutes: 90,
      experienceDurationMinutes: 7 * 60,
      returnTravelMinutes: 90,
    });

    expect(result.feasible).toBe(true);
    expect(result.overnight).toBe(false);
    expect(result.arrivalBackAtOriginMinutesFromMidnight).toBe(18 * 60);
    expect(result.reasonCodes).toEqual([]);
  });

  it('rejects a destination that cannot return inside the requested same-day window', () => {
    const result = evaluateDayTripFeasibility({
      scope: scope(),
      departureMinutesFromMidnight: 9 * 60,
      outboundTravelMinutes: 170,
      experienceDurationMinutes: 10 * 60,
      returnTravelMinutes: 170,
    });

    expect(result.feasible).toBe(false);
    expect(result.reasonCodes).toContain('RETURN_AFTER_WINDOW');
  });

  it('rejects crossing midnight when the request does not allow overnight', () => {
    const result = evaluateDayTripFeasibility({
      scope: scope({
        returnWindow: {
          earliestMinutesFromMidnight: 18 * 60,
          latestMinutesFromMidnight: 26 * 60,
        },
      }),
      departureMinutesFromMidnight: 8 * 60,
      outboundTravelMinutes: 160,
      experienceDurationMinutes: 12 * 60,
      returnTravelMinutes: 160,
    });

    expect(result.overnight).toBe(true);
    expect(result.reasonCodes).toContain('OVERNIGHT_NOT_ALLOWED');
  });

  it('allows overnight only when the canonical scope explicitly enables it', () => {
    const result = evaluateDayTripFeasibility({
      scope: scope({
        overnightPolicy: 'allow_overnight',
        returnWindow: {
          earliestMinutesFromMidnight: 18 * 60,
          latestMinutesFromMidnight: 26 * 60,
        },
      }),
      departureMinutesFromMidnight: 8 * 60,
      outboundTravelMinutes: 120,
      experienceDurationMinutes: 12 * 60,
      returnTravelMinutes: 120,
    });

    expect(result.feasible).toBe(true);
    expect(result.overnight).toBe(true);
  });

  it('enforces outbound and return travel caps independently', () => {
    const result = evaluateDayTripFeasibility({
      scope: scope(),
      departureMinutesFromMidnight: 8 * 60,
      outboundTravelMinutes: 181,
      experienceDurationMinutes: 2 * 60,
      returnTravelMinutes: 181,
    });

    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'OUTBOUND_TRAVEL_LIMIT_EXCEEDED',
        'RETURN_TRAVEL_LIMIT_EXCEEDED',
      ]),
    );
  });
});
