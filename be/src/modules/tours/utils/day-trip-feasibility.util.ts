import {
  DayTripFeasibilityInput,
  DayTripFeasibilityResult,
} from '../interfaces/day-trip.interface';

export function evaluateDayTripFeasibility(
  input: DayTripFeasibilityInput,
): DayTripFeasibilityResult {
  const reasons: DayTripFeasibilityResult['reasonCodes'] = [];
  const { scope } = input;

  if (
    input.departureMinutesFromMidnight <
      scope.departureWindow.earliestMinutesFromMidnight ||
    input.departureMinutesFromMidnight >
      scope.departureWindow.latestMinutesFromMidnight
  ) {
    reasons.push('DEPARTURE_OUTSIDE_WINDOW');
  }
  if (input.outboundTravelMinutes > scope.maxOutboundTravelMinutes) {
    reasons.push('OUTBOUND_TRAVEL_LIMIT_EXCEEDED');
  }
  if (input.returnTravelMinutes > scope.maxReturnTravelMinutes) {
    reasons.push('RETURN_TRAVEL_LIMIT_EXCEEDED');
  }

  const arrivalAtDestinationMinutesFromMidnight =
    input.departureMinutesFromMidnight + input.outboundTravelMinutes;
  const departDestinationMinutesFromMidnight =
    arrivalAtDestinationMinutesFromMidnight + input.experienceDurationMinutes;
  const arrivalBackAtOriginMinutesFromMidnight =
    departDestinationMinutesFromMidnight + input.returnTravelMinutes;
  const overnight = arrivalBackAtOriginMinutesFromMidnight >= 24 * 60;

  if (
    arrivalBackAtOriginMinutesFromMidnight >
    scope.returnWindow.latestMinutesFromMidnight
  ) {
    reasons.push('RETURN_AFTER_WINDOW');
  }
  if (overnight && scope.overnightPolicy === 'same_day_only') {
    reasons.push('OVERNIGHT_NOT_ALLOWED');
  }

  return {
    feasible: reasons.length === 0,
    arrivalAtDestinationMinutesFromMidnight,
    departDestinationMinutesFromMidnight,
    arrivalBackAtOriginMinutesFromMidnight,
    overnight,
    reasonCodes: reasons,
  };
}
