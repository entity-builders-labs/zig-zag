import {
  CatalogCandidate,
  CatalogCandidateRejectionReason,
  CatalogCandidateValidationContext,
} from '../interfaces/catalog-candidate-validation.interface';
import { primaryTypesForAcquisitionCategory } from '@integrations/google-places/utils/catalog-place-taxonomy';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';

export const SUPPORTED_CATALOG_PLACE_TYPES = new Set([
  'museum',
  'history_museum',
  'art_museum',
  'art_gallery',
  'tourist_attraction',
  'historical_landmark',
  'historical_place',
  'cultural_landmark',
  'monument',
  'sculpture',
  'plaza',
  'observation_deck',
  'church',
  'place_of_worship',
  'park',
  'national_park',
  'nature_preserve',
  'hiking_area',
  'hiking_trail',
  'natural_feature',
  'beach',
  'restaurant',
  'cafe',
  'bakery',
  'food_market',
  'food_court',
  'bar',
  'night_club',
  'lounge',
  'karaoke',
  'amusement_park',
  'movie_theater',
  'performing_arts_theater',
  'bowling_alley',
  'casino',
]);

const ADDRESS_ONLY_TYPES = new Set([
  'street_address',
  'route',
  'premise',
  'subpremise',
  'postal_code',
  'intersection',
  'neighborhood',
  'locality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'country',
]);

const GENERIC_NAMES = new Set([
  'architecture',
  'arquitectura',
  'architectures',
  'arquitecturas',
  'building',
  'edificio',
  'monument',
  'monumento',
  'point of interest',
  'punto de interes',
  'tourist attraction',
  'atraccion turistica',
  'unnamed',
  'unnamed road',
  'sin nombre',
  'unknown',
]);

const PERMANENTLY_CLOSED_STATUSES = new Set([
  'CLOSED_PERMANENTLY',
  'PERMANENTLY_CLOSED',
]);

/**
 * Google occasionally assigns a catalog-supported primary type to an entity
 * whose additional structured types reveal a different real-world identity.
 * Keep these rules narrow and type-based: they protect the catalog from
 * contradictions such as a school returned as a church without introducing
 * locale- or name-specific blacklists.
 */
const CONFLICTING_TYPES_BY_PRIMARY_TYPE: Record<string, ReadonlySet<string>> = {
  church: new Set(['school', 'educational_institution']),
  place_of_worship: new Set(['school', 'educational_institution']),
  park: new Set(['campground', 'lodging', 'rv_park']),
};

export interface CatalogIdentityValidationResult {
  accepted: boolean;
  normalizedName: string;
  rejectionReasons: CatalogCandidateRejectionReason[];
}

export class CatalogIdentityValidator {
  validate(
    candidate: CatalogCandidate,
    context: CatalogCandidateValidationContext = {},
  ): CatalogIdentityValidationResult {
    const rejectionReasons: CatalogCandidateRejectionReason[] = [];
    const normalizedName = this.normalize(candidate.name ?? '');
    const providerTypes = candidate.providerTypes ?? [];

    if (!normalizedName) rejectionReasons.push('empty_name');
    if (!candidate.externalId?.trim()) {
      rejectionReasons.push('missing_provider_id');
    }

    const coordinatesAreValid =
      Number.isFinite(candidate.latitude) &&
      Number.isFinite(candidate.longitude) &&
      (candidate.latitude as number) >= -90 &&
      (candidate.latitude as number) <= 90 &&
      (candidate.longitude as number) >= -180 &&
      (candidate.longitude as number) <= 180;
    if (!coordinatesAreValid) {
      rejectionReasons.push('invalid_coordinates');
    } else if (
      context.destinationBoundary &&
      !geometryContainsPoint(
        context.destinationBoundary,
        candidate.longitude as number,
        candidate.latitude as number,
      )
    ) {
      rejectionReasons.push('outside_destination_boundary');
    }

    if (
      candidate.businessStatus &&
      PERMANENTLY_CLOSED_STATUSES.has(candidate.businessStatus.toUpperCase())
    ) {
      rejectionReasons.push('permanently_closed');
    }

    const isAddressOnly =
      providerTypes.length > 0 &&
      providerTypes.every((type) => ADDRESS_ONLY_TYPES.has(type));
    if (isAddressOnly) {
      rejectionReasons.push('address_only');
    } else if (
      providerTypes.length === 0 ||
      !providerTypes.some((type) => SUPPORTED_CATALOG_PLACE_TYPES.has(type))
    ) {
      rejectionReasons.push('unsupported_type');
    }

    const acquisitionTypes = context.acquisitionOperation
      ? context.acquisitionOperation.providerOperation === 'nearby'
        ? (context.acquisitionOperation.requestedPrimaryTypes ?? [])
        : primaryTypesForAcquisitionCategory(
            context.acquisitionOperation.category,
          )
      : [];
    if (acquisitionTypes.length > 0) {
      const returnedCategoryEvidence = candidate.providerPrimaryType
        ? [candidate.providerPrimaryType]
        : providerTypes;
      if (
        !returnedCategoryEvidence.some((type) =>
          (acquisitionTypes as readonly string[]).includes(type),
        )
      ) {
        rejectionReasons.push('unsupported_primary_type');
      }
    }

    const conflictingTypes = candidate.providerPrimaryType
      ? CONFLICTING_TYPES_BY_PRIMARY_TYPE[candidate.providerPrimaryType]
      : undefined;
    if (
      conflictingTypes &&
      providerTypes.some((type) => conflictingTypes.has(type))
    ) {
      rejectionReasons.push('conflicting_provider_types');
    }

    if (normalizedName && GENERIC_NAMES.has(normalizedName)) {
      rejectionReasons.push('generic_name');
    }

    return {
      accepted: rejectionReasons.length === 0,
      normalizedName,
      rejectionReasons: [...new Set(rejectionReasons)],
    };
  }

  private normalize(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
