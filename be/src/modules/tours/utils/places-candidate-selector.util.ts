import { PlaceData } from '@integrations/google-places/interfaces/places-api.interface';
import { calculateDistance, Coordinates } from '@shared/utils/distance.utils';
import { normalizeGeoName } from './nominatim-match.util';

/**
 * Canonical Places candidate selector — single policy authority for choosing
 * among destination-compatible Places results.
 *
 * Among results with usable coordinates: an exact (normalized) name match
 * wins over provider rank; with more than one exact match (a real
 * chain/franchise with multiple branches, all genuinely sharing that exact
 * name), the one closest to the destination wins — this is the same
 * distance-first tie-break `bestNominatimMatch` already uses elsewhere.
 * Falls back to rank-0 only when no result's name matches the hint at all,
 * preserving prior behavior for the fuzzy case (still independently verified
 * afterward by `IdentityVerifier`).
 */
export function selectBestPlaceCandidate(
  hintName: string,
  results: PlaceData[],
  destinationPoint?: Coordinates,
): PlaceData | undefined {
  const withCoordinates = results.filter(
    (place) =>
      Number.isFinite(place.location?.latitude) &&
      Number.isFinite(place.location?.longitude),
  );
  if (withCoordinates.length === 0) return undefined;

  const needle = normalizeGeoName(hintName);
  const exactMatches = withCoordinates.filter(
    (place) =>
      normalizeGeoName(place.displayName?.text || place.name || '') === needle,
  );
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    if (!destinationPoint) return exactMatches[0];
    return exactMatches.reduce((closest, candidate) =>
      calculateDistance(destinationPoint, {
        latitude: candidate.location!.latitude,
        longitude: candidate.location!.longitude,
      }) <
      calculateDistance(destinationPoint, {
        latitude: closest.location!.latitude,
        longitude: closest.location!.longitude,
      })
        ? candidate
        : closest,
    );
  }
  return withCoordinates[0];
}
