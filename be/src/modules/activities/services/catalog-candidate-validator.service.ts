import { Injectable } from '@nestjs/common';
import { PlacesProvider } from '@integrations/google-places/interfaces/places-api.interface';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';

export type CatalogCandidateRejectionReason =
  | 'empty_name'
  | 'missing_provider_id'
  | 'invalid_coordinates'
  | 'outside_destination_boundary'
  | 'permanently_closed'
  | 'unsupported_type'
  | 'generic_name'
  | 'address_only'
  | 'insufficient_quality';

export interface CatalogCandidate {
  provider: PlacesProvider;
  externalId?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  providerTypes?: string[];
  formattedAddress?: string | null;
  businessStatus?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
}

export interface CatalogCandidateValidationContext {
  destinationBoundary?: GeoJsonGeometry;
}

export interface CatalogCandidateValidationResult {
  accepted: boolean;
  normalizedName: string;
  rejectionReasons: CatalogCandidateRejectionReason[];
}

export const SUPPORTED_CATALOG_PLACE_TYPES = new Set([
  'museum',
  'art_gallery',
  'tourist_attraction',
  'historical_landmark',
  'historical_place',
  'church',
  'place_of_worship',
  'park',
  'natural_feature',
  'hiking_trail',
  'campground',
  'restaurant',
  'cafe',
  'bakery',
  'food_market',
  'bar',
  'night_club',
  'lounge',
  'karaoke',
  'amusement_park',
  'movie_theater',
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

const TRUSTED_INSTITUTION_TYPES = new Set([
  'museum',
  'art_gallery',
  'historical_landmark',
  'historical_place',
  'church',
  'place_of_worship',
  'park',
  'campground',
  'amusement_park',
  'movie_theater',
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

@Injectable()
export class CatalogCandidateValidatorService {
  validate(
    candidate: CatalogCandidate,
    context: CatalogCandidateValidationContext = {},
  ): CatalogCandidateValidationResult {
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

    if (normalizedName && GENERIC_NAMES.has(normalizedName)) {
      rejectionReasons.push('generic_name');
    }

    if (!this.hasMinimumProviderQuality(candidate, providerTypes)) {
      rejectionReasons.push('insufficient_quality');
    }

    return {
      accepted: rejectionReasons.length === 0,
      normalizedName,
      rejectionReasons: [...new Set(rejectionReasons)],
    };
  }

  private hasMinimumProviderQuality(
    candidate: CatalogCandidate,
    providerTypes: string[],
  ): boolean {
    if (candidate.provider === 'geoapify') {
      // Geoapify does not expose ratings or review counts. Require the two
      // independent signals it does provide: a mapped type and an address.
      return (
        providerTypes.some((type) => SUPPORTED_CATALOG_PLACE_TYPES.has(type)) &&
        !!candidate.formattedAddress?.trim()
      );
    }

    const ratingCount = candidate.ratingCount ?? 0;
    const hasReviewEvidence = Number.isFinite(ratingCount) && ratingCount > 0;
    const isTrustedInstitution = providerTypes.some((type) =>
      TRUSTED_INSTITUTION_TYPES.has(type),
    );
    return hasReviewEvidence || isTrustedInstitution;
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
