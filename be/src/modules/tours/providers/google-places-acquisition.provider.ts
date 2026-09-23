import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  IPlacesApiService,
  PlaceData,
  PlacesProvider,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';
import {
  AcquisitionProviderResult,
  QualityEvidence,
  SourceObservation,
  SourceObservationGeo,
} from '../interfaces/experience-acquisition.interface';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';
import { placesAcquisitionLabel } from '../utils/places-external-identity.util';

export const DISALLOWED_GOOGLE_PLACES_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'lodging',
  'hotel',
  'motel',
  'supermarket',
  'grocery_or_supermarket',
  'convenience_store',
  'store',
  'clothing_store',
  'department_store',
  'shopping_mall',
  'bank',
  'atm',
  'gas_station',
  'parking',
  'pharmacy',
  'drugstore',
  'hospital',
  'doctor',
  'dentist',
  'school',
  'university',
  'real_estate_agency',
  'car_repair',
  'car_dealer',
  'car_rental',
  'laundry',
  'post_office',
  'finance',
  'insurance_agency',
]);

// Safe generic tourism types: a result carrying one of these is an admissible
// tourism Experience candidate even when the caller supplied no explicit
// `searchTypes` (a generic Places refill). Deliberately excludes commercial
// food/nightlife categories — a nearby crawl must not turn arbitrary cafes,
// bars, restaurants or bakeries into Experiences just because Google returned
// them ("Starbucks problem").
export const SAFE_GENERIC_TOURISM_TYPES = new Set([
  'tourist_attraction',
  'museum',
  'art_gallery',
  'park',
  'national_park',
  'historical_landmark',
  'historical_place',
  'church',
  'place_of_worship',
  'zoo',
  'aquarium',
  'amusement_park',
  'observation_deck',
  'visitor_center',
  'cultural_center',
  'campground',
  'winery',
]);

// Contextual commercial types: only admissible when the acquisition plan
// explicitly asked for them via `searchTypes` (e.g. a `cafe`/`bar` deficit
// routed by the planner). Never admitted on a generic, type-less refill.
export const CONTEXTUAL_GOOGLE_PLACES_TYPES = new Set([
  'restaurant',
  'cafe',
  'bakery',
  'bar',
  'night_club',
]);

// Full known-type vocabulary (safe + contextual). Retained for callers that
// want the union; admission itself is driven by the two sets above, not this.
export const DEFAULT_ALLOWED_GOOGLE_PLACES_TYPES = new Set([
  ...SAFE_GENERIC_TOURISM_TYPES,
  ...CONTEXTUAL_GOOGLE_PLACES_TYPES,
]);

interface PlaceWithProvider {
  place: PlaceData;
  provider: PlacesProvider;
}

export interface GooglePlacesAcquireOptions {
  searchTypes?: string[];
  query?: string;
  radiusMeters?: number;
  center?: { latitude: number; longitude: number };
  maxResultCount?: number;
}

@Injectable()
export class GooglePlacesAcquisitionProvider {
  private readonly logger = new Logger(GooglePlacesAcquisitionProvider.name);

  constructor(
    @Inject('PlacesApiService')
    private readonly placesApi: IPlacesApiService,
  ) {}

  async acquire(
    destination: ExperienceDiscoveryScope,
    options?: GooglePlacesAcquireOptions,
  ): Promise<AcquisitionProviderResult<SourceObservation>> {
    try {
      const lat = options?.center?.latitude ?? destination?.latitude;
      const lng = options?.center?.longitude ?? destination?.longitude;
      const hasCoordinates =
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;

      let places: PlaceWithProvider[] = [];

      if (hasCoordinates) {
        const radius =
          options?.radiusMeters ?? destination?.radiusMeters ?? 5000;
        const result = await this.placesApi.searchNearby({
          latitude: lat!,
          longitude: lng!,
          radius,
          includedPrimaryTypes: options?.searchTypes,
          maxResultCount: options?.maxResultCount ?? 20,
          rankPreference: 'POPULARITY',
        });
        places = (result.data ?? []).map((place) => ({
          place,
          provider: result.provenance.provider,
        }));
      } else if (options?.query || destination?.destinationName) {
        const textQuery = options?.query ?? destination?.destinationName ?? '';
        const searchTypes = options?.searchTypes?.filter(Boolean) ?? [];
        const maxResultCount = options?.maxResultCount ?? 5;

        if (searchTypes.length === 1) {
          const result = await this.placesApi.searchText({
            textQuery,
            includedType: searchTypes[0],
            strictTypeFiltering: true,
            maxResultCount,
          });
          places = (result.data ?? []).map((place) => ({
            place,
            provider: result.provenance.provider,
          }));
        } else if (searchTypes.length > 1) {
          const seenPlaceIds = new Set<string>();
          const collectedPlaces: PlaceWithProvider[] = [];
          for (const searchType of searchTypes) {
            const result = await this.placesApi.searchText({
              textQuery,
              includedType: searchType,
              strictTypeFiltering: true,
              maxResultCount,
            });
            for (const place of result.data ?? []) {
              if (place.id && !seenPlaceIds.has(place.id)) {
                seenPlaceIds.add(place.id);
                collectedPlaces.push({
                  place,
                  provider: result.provenance.provider,
                });
                if (collectedPlaces.length >= maxResultCount) {
                  break;
                }
              }
            }
            if (collectedPlaces.length >= maxResultCount) {
              break;
            }
          }
          places = collectedPlaces;
        } else {
          const result = await this.placesApi.searchText({
            textQuery,
            maxResultCount,
          });
          places = (result.data ?? []).map((place) => ({
            place,
            provider: result.provenance.provider,
          }));
        }
      } else {
        return {
          status: 'success',
          value: [],
        };
      }

      const observations: SourceObservation[] = [];
      for (const { place, provider } of places) {
        const placeId = place.id;
        if (!placeId) continue;

        if (!this.isAdmissible(place, options?.searchTypes)) {
          continue;
        }

        const displayName = place.displayName?.text?.trim();
        const name = place.name?.trim();
        const title =
          displayName && displayName.length > 0
            ? displayName
            : name && name.length > 0
              ? name
              : undefined;
        if (!title) {
          continue;
        }

        const geo = this.validateCoordinates(place.location);
        const acquisitionProvider = placesAcquisitionLabel(provider);

        observations.push({
          provider: acquisitionProvider,
          externalId: placeId,
          evidenceKey: `${acquisitionProvider}:${placeId}`,
          evidenceType: 'place',
          title,
          description: place.formattedAddress,
          geo,
          originationCapabilities: [
            'SINGLE_PLACE',
          ] satisfies AcquisitionEvidenceRequirement[],
          // Normalized at the adapter boundary (docs/architecture/
          // engineering-principles.md §1/§3) -- a missing rating is
          // `undefined`, never a fabricated `0`. Geoapify-shaped places
          // that lack `rating` correctly produce no rating evidence here.
          qualityEvidence: this.qualityEvidenceFor(place),
          // Adapter-boundary normalization: the place's own real website URL
          // is a typed fact (`SourceObservation.sourceUrl`), never left
          // inside `metadata` for downstream code to decode.
          sourceUrl: place.websiteUri,
          metadata: {
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            primaryType: place.primaryType,
            types: place.types,
            openingHoursWeekdayText: place.openingHoursWeekdayText,
            priceLevel: place.priceLevel,
            businessStatus: place.businessStatus,
            editorialSummary: place.editorialSummary?.text,
            primaryTypeDisplayName: place.primaryTypeDisplayName?.text,
          },
        });
      }

      return {
        status: 'success',
        value: observations,
      };
    } catch (error: any) {
      // `this.placesApi.provider` is the real configured backend (Google or
      // Geoapify) -- known synchronously even when the call threw before
      // returning provenance, so this diagnostic must name it instead of
      // assuming Google from this class's historical name.
      const providerLabel = placesProviderLabel(this.placesApi.provider);
      this.logger.warn(
        `${providerLabel} acquisition failed: ${error?.message ?? String(error)}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error?.message ?? `${providerLabel} acquisition failed`,
      };
    }
  }

  private validateCoordinates(loc?: {
    latitude?: number;
    longitude?: number;
  }): SourceObservationGeo | undefined {
    if (!loc) return undefined;
    const { latitude, longitude } = loc;
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return undefined;
    }
    return { latitude, longitude };
  }

  /**
   * Adapter-boundary normalization (docs/architecture/
   * engineering-principles.md §1/§3): reads `PlaceData`'s already-typed
   * `rating`/`userRatingCount` directly -- never a `metadata` decode, never
   * a provider-name branch. Google and Geoapify share this one method
   * because both are `IPlacesApiService` implementations returning the
   * SAME `PlaceData` shape; a missing rating (Geoapify's normal case) is
   * `undefined`, never `0`.
   */
  private qualityEvidenceFor(place: PlaceData): QualityEvidence | undefined {
    if (typeof place.rating !== 'number' || !Number.isFinite(place.rating)) {
      return undefined;
    }
    return {
      consumerRating: {
        value: place.rating,
        ...(typeof place.userRatingCount === 'number'
          ? { reviewCount: place.userRatingCount }
          : {}),
      },
    };
  }

  private isAdmissible(place: PlaceData, requestedTypes?: string[]): boolean {
    const rawTypes = [place.primaryType, ...(place.types ?? [])].filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0,
    );

    if (rawTypes.length === 0) {
      return false;
    }

    // Explicit plan-driven request: admissible only against exactly what was
    // asked for (which may legitimately include a contextual commercial type).
    // Generic refill (no `searchTypes`): admissible only against safe generic
    // tourism types — a contextual `cafe`/`bar`/`restaurant`/`bakery`/
    // `night_club` is never admitted unless the plan explicitly requested it.
    const hasExplicitRequest = !!requestedTypes && requestedTypes.length > 0;
    const allowedSet = hasExplicitRequest
      ? new Set(requestedTypes)
      : SAFE_GENERIC_TOURISM_TYPES;

    const hasAllowed = rawTypes.some((t) => allowedSet.has(t));
    if (!hasAllowed) {
      return false;
    }

    // A broad/commercial-only result is never sufficient on its own.
    const onlyDisallowed = rawTypes.every((t) =>
      DISALLOWED_GOOGLE_PLACES_TYPES.has(t),
    );
    if (onlyDisallowed) {
      return false;
    }

    return true;
  }
}
