import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';
import {
  AcquisitionProviderResult,
  SourceObservation,
  SourceObservationGeo,
} from '../interfaces/experience-acquisition.interface';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';

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

export const DEFAULT_ALLOWED_GOOGLE_PLACES_TYPES = new Set([
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
  'restaurant',
  'cafe',
  'bakery',
  'bar',
  'night_club',
  'campground',
  'winery',
]);

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

      let places: PlaceData[] = [];

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
        places = result.data ?? [];
      } else if (options?.query || destination?.destinationName) {
        const textQuery = options?.query ?? destination?.destinationName ?? '';
        const result = await this.placesApi.searchText({
          textQuery,
          maxResultCount: options?.maxResultCount ?? 5,
        });
        places = result.data ?? [];
      } else {
        return {
          status: 'success',
          value: [],
        };
      }

      const observations: SourceObservation[] = [];
      for (const place of places) {
        const placeId = place.id;
        if (!placeId) continue;

        if (!this.isAdmissible(place, options?.searchTypes)) {
          continue;
        }

        const geo = this.validateCoordinates(place.location);

        observations.push({
          provider: 'google_places',
          externalId: placeId,
          evidenceKey: `google_places:${placeId}`,
          evidenceType: 'place',
          title: place.displayName?.text ?? place.name ?? placeId,
          description: place.formattedAddress,
          geo,
          metadata: {
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            primaryType: place.primaryType,
            types: place.types,
            openingHoursWeekdayText: place.openingHoursWeekdayText,
          },
        });
      }

      return {
        status: 'success',
        value: observations,
      };
    } catch (error: any) {
      this.logger.warn(
        `Google Places acquisition failed: ${error?.message ?? String(error)}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error?.message ?? 'Google Places acquisition failed',
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

  private isAdmissible(place: PlaceData, requestedTypes?: string[]): boolean {
    const rawTypes = [place.primaryType, ...(place.types ?? [])].filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0,
    );

    if (rawTypes.length === 0) {
      return false;
    }

    const allowedSet =
      requestedTypes && requestedTypes.length > 0
        ? new Set(requestedTypes)
        : DEFAULT_ALLOWED_GOOGLE_PLACES_TYPES;

    const hasAllowed = rawTypes.some((t) => allowedSet.has(t));
    if (!hasAllowed) {
      return false;
    }

    const onlyDisallowed = rawTypes.every((t) =>
      DISALLOWED_GOOGLE_PLACES_TYPES.has(t),
    );
    if (onlyDisallowed) {
      return false;
    }

    return true;
  }
}
