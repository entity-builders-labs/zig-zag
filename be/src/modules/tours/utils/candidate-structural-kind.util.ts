import { PlaceFeatureClass } from '@integrations/google-places/interfaces/places-api.interface';
import { NominatimResult } from '@integrations/osm/interfaces/nominatim.interface';
import { CandidateStructuralKind } from '../interfaces/component-identity-context.interface';

/**
 * Provider-boundary normalization of a record's structural kind into the
 * provider-neutral `CandidateStructuralKind`. Coarse by design (a venue
 * versus a settlement, area, road or natural feature); unrecognized
 * structures stay UNKNOWN rather than defaulting to a venue.
 */

const OSM_SETTLEMENT_PLACES = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'isolated_dwelling',
  'locality',
  'suburb',
  'quarter',
  'neighbourhood',
  'borough',
  'farm',
]);

/** OSM primary keys whose features are named venues or businesses. */
const OSM_POINT_OF_INTEREST_KEYS = new Set([
  'amenity',
  'shop',
  'craft',
  'tourism',
  'leisure',
  'office',
  'healthcare',
  'club',
]);

/** An OSM feature's kind from its primary key and value. */
export function structuralKindFromOsm(
  key: string | undefined,
  value: string | undefined,
): CandidateStructuralKind {
  if (!key) return 'UNKNOWN';
  if (key === 'place') {
    return value && OSM_SETTLEMENT_PLACES.has(value) ? 'SETTLEMENT' : 'UNKNOWN';
  }
  if (key === 'boundary') return 'ADMINISTRATIVE_AREA';
  if (key === 'highway') return 'ROAD';
  if (key === 'natural' || key === 'waterway') return 'NATURAL_FEATURE';
  if (OSM_POINT_OF_INTEREST_KEYS.has(key)) return 'POINT_OF_INTEREST';
  return 'UNKNOWN';
}

/** Nominatim exposes the OSM primary key/value as `class`/`type`. */
export function structuralKindFromNominatim(
  result: Pick<NominatimResult, 'class' | 'type'>,
): CandidateStructuralKind {
  return structuralKindFromOsm(result.class, result.type);
}

/**
 * An OSM element's kind from its tags: a venue key outranks a `place` or
 * `natural` tag on the same element (a restaurant tagged with the hamlet it
 * sits in is still a restaurant).
 */
export function structuralKindFromOsmTags(
  tags: Record<string, string> | undefined,
): CandidateStructuralKind {
  if (!tags) return 'UNKNOWN';
  for (const key of OSM_POINT_OF_INTEREST_KEYS) {
    if (tags[key]) return 'POINT_OF_INTEREST';
  }
  for (const key of ['place', 'boundary', 'highway', 'natural', 'waterway']) {
    if (tags[key]) return structuralKindFromOsm(key, tags[key]);
  }
  return 'UNKNOWN';
}

/** A Places feature class (Geoapify Forward Geocoding). */
export function structuralKindFromPlaceFeatureClass(
  featureClass: PlaceFeatureClass | undefined,
): CandidateStructuralKind {
  switch (featureClass) {
    case 'point_of_interest':
      return 'POINT_OF_INTEREST';
    case 'administrative_area':
      return 'ADMINISTRATIVE_AREA';
    case 'street':
      return 'ROAD';
    default:
      return 'UNKNOWN';
  }
}
