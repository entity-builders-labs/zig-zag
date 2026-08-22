import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { CrawlLocationDto } from './dto/crawl-location.dto';
import { GooglePlaceDetails } from '../../activities/interfaces/google-places.interface';
import { ActivitiesService } from '../../activities/services/activities.service';
import { CreateActivityDto } from '../../activities/dto/create-activity.dto';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  IPlacesApiService,
  PlacesApiRequestError,
  PlacesCacheStatus,
  PlacesCrawlError,
  PlacesCrawlProvenance,
  PlacesProviderStatus,
  PlacesRequestProvenance,
  placesProviderLabel,
} from './interfaces/places-api.interface';
import { VectorStoreService } from 'src/shared/ai/services/vector-store.service';
import { priceLevelToNumber } from './utils/price-level.util';
import { calculateDistance } from 'src/shared/utils/distance.utils';
import { CatalogCandidateValidatorService } from '@activities/services/catalog-candidate-validator.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

interface PlaceWithMetadata extends GooglePlaceDetails {
  name: string;
  types: string[];
  address: string;
  location: {
    latitude: number;
    longitude: number;
  };
  reviews?: number;
  metadata: {
    preferredTime: string;
  };
}

export interface PlacesCrawlResult {
  activitiesIds: string[];
  fromCache: boolean;
  provenance: PlacesCrawlProvenance;
}

export interface PlacesCrawlAnchor {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface PlacesCrawlOptions {
  anchors?: PlacesCrawlAnchor[];
  destinationBoundary?: GeoJsonGeometry;
  requestedInterests?: string[];
  maxProviderCalls?: number;
  maxResultsPerCall?: number;
  totalBudgetMs?: number;
}

interface CatalogSearchConfig {
  type: string;
  keyword: string;
  minRating: number;
  preferredTime: string;
}

interface CatalogSearchGroup {
  category: string;
  searches: CatalogSearchConfig[];
}

const MAX_PROVIDER_CALLS = 12;
const MAX_RESULTS_PER_CALL = 10;
const TOTAL_REFILL_BUDGET_MS = 20_000;
const MAX_ANCHORS = 8;

const TEXT_SEARCH_TYPES = new Set([
  'point_of_interest',
  'natural_feature',
  'hiking_trail',
]);

const INTEREST_CATEGORIES: Record<string, string> = {
  history: 'cultural',
  culture: 'cultural',
  art: 'cultural',
  architecture: 'cultural',
  photography: 'cultural',
  nature: 'outdoor',
  outdoor: 'outdoor',
  beach: 'outdoor',
  hiking: 'outdoor',
  food: 'food',
  gastronomy: 'food',
  nightlife: 'nightlife',
  music: 'nightlife',
  entertainment: 'entertainment',
  family: 'entertainment',
};

const placesToSearch: CatalogSearchGroup[] = [
  {
    category: 'cultural',
    searches: [
      {
        type: 'tourist_attraction',
        keyword: 'historic cultural landmark',
        minRating: 4.0,
        preferredTime: 'day',
      },
      {
        type: 'museum',
        keyword: 'art history culture',
        minRating: 4.0,
        preferredTime: 'day',
      },
      {
        type: 'art_gallery',
        keyword: 'contemporary modern art',
        minRating: 4.0,
        preferredTime: 'day',
      },
    ],
  },
  {
    category: 'cultural', // Religious/historical places are part of cultural category
    searches: [
      {
        type: 'church',
        keyword: 'cathedral temple historic',
        minRating: 4.0,
        preferredTime: 'day',
      },
      {
        type: 'point_of_interest',
        keyword: 'historic monument heritage',
        minRating: 4.0,
        preferredTime: 'day',
      },
    ],
  },
  {
    category: 'outdoor',
    searches: [
      {
        type: 'park',
        keyword: 'national park nature reserve',
        minRating: 4.0,
        preferredTime: 'day',
      },
      {
        type: 'natural_feature',
        keyword: 'landscape scenic viewpoint',
        minRating: 4.0,
        preferredTime: 'day',
      },
      {
        type: 'hiking_trail',
        keyword: 'hiking trekking trail nature',
        minRating: 4.0,
        preferredTime: 'morning',
      },
      {
        type: 'campground',
        keyword: 'camping nature outdoor',
        minRating: 3.5,
        preferredTime: 'day',
      },
    ],
  },
  {
    category: 'food',
    searches: [
      {
        type: 'restaurant',
        keyword: 'fine dining local cuisine traditional',
        minRating: 4.2,
        preferredTime: 'evening',
      },
      {
        type: 'restaurant',
        keyword: 'popular authentic food',
        minRating: 4.0,
        preferredTime: 'lunch',
      },
      {
        type: 'cafe',
        keyword: 'coffee breakfast brunch',
        minRating: 4.0,
        preferredTime: 'morning',
      },
    ],
  },
  {
    category: 'nightlife',
    searches: [
      {
        type: 'bar',
        keyword: 'cocktail rooftop lounge',
        minRating: 4.0,
        preferredTime: 'night',
      },
      {
        type: 'bar',
        keyword: 'pub local beer craft',
        minRating: 4.0,
        preferredTime: 'night',
      },
    ],
  },
  {
    category: 'entertainment',
    searches: [
      {
        type: 'amusement_park',
        keyword: 'theme park entertainment family',
        minRating: 4.0,
        preferredTime: 'day',
      },
      {
        type: 'movie_theater',
        keyword: 'cinema entertainment',
        minRating: 4.0,
        preferredTime: 'evening',
      },
    ],
  },
];

// Definición de tipos de actividades conocidos y su mapeo con Google Places
const ActivityTypes = {
  CULTURAL: {
    name: 'cultural',
    includes: [
      'museum',
      'art_gallery',
      'tourist_attraction',
      'historical_landmark',
      'historical_place',
      'church',
      'place_of_worship',
    ],
    defaultDuration: 2.5,
    icon: '🏛️',
    description: 'Cultural and historical activities',
    timePreference: 'day',
  },
  OUTDOOR: {
    name: 'outdoor',
    includes: ['park', 'hiking_trail', 'natural_feature', 'campground'],
    defaultDuration: 3.0,
    icon: '🌳',
    description: 'Outdoor and nature activities',
    timePreference: 'day',
  },
  ENTERTAINMENT: {
    name: 'entertainment',
    includes: ['amusement_park', 'movie_theater', 'bowling_alley', 'casino'],
    defaultDuration: 4.0,
    icon: '🎭',
    description: 'Entertainment and fun activities',
    timePreference: 'evening',
  },
  FOOD: {
    name: 'food',
    includes: ['restaurant', 'cafe', 'bakery', 'food_market'],
    defaultDuration: 1.5,
    icon: '🍽️',
    description: 'Food and dining experiences',
    timePreference: 'any',
  },
  NIGHTLIFE: {
    name: 'nightlife',
    includes: ['bar', 'night_club', 'lounge', 'karaoke'],
    defaultDuration: 2.0,
    icon: '🌙',
    description: 'Nightlife and entertainment',
    timePreference: 'night',
  },
};

@Injectable()
export class GooglePlacesService implements OnModuleInit {
  private readonly SEARCH_RADIUS = 5000; // 5km radius for finding activities

  private readonly logger = new Logger(GooglePlacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly catalogCandidateValidator: CatalogCandidateValidatorService,
    @Inject('PlacesApiService') private readonly placesApi: IPlacesApiService,
  ) {}

  async onModuleInit() {
    const status = this.getProviderStatus();
    this.logger.log(
      `Catalog refill provider: ${placesProviderLabel(status.provider)}; ` +
        `available=${status.available}; cache=${
          status.cacheEnabled ? status.cacheMode : 'disabled'
        }`,
    );
    if (!status.available) {
      this.logger.warn(
        `${placesProviderLabel(status.provider)} is unavailable because its API key is not configured.`,
      );
    }
    await this.ensureKnownActivityTypes();
  }

  getProviderStatus(): PlacesProviderStatus {
    return this.placesApi.getStatus();
  }

  private mergeCacheStatus(
    current: PlacesCacheStatus,
    next: PlacesCacheStatus,
  ): PlacesCacheStatus {
    if (current === 'strict-miss' || next === 'strict-miss') {
      return 'strict-miss';
    }
    if (current === 'miss-live' || next === 'miss-live') {
      return 'miss-live';
    }
    return 'hit';
  }

  private addRequestProvenance(
    crawl: PlacesCrawlProvenance,
    request: PlacesRequestProvenance,
  ): void {
    crawl.cacheStatus = this.mergeCacheStatus(
      crawl.cacheStatus,
      request.cacheStatus,
    );
    crawl.requestedCount += request.requestedCount;
    crawl.receivedCount += request.receivedCount;
  }

  private async ensureKnownActivityTypes() {
    try {
      for (const [, type] of Object.entries(ActivityTypes)) {
        try {
          const existingType = await this.prisma.knownActivityType.findUnique({
            where: { name: type.name },
          });

          if (existingType) {
            if (
              existingType.icon !== type.icon ||
              existingType.description !== type.description ||
              existingType.category !== type.name
            ) {
              await this.prisma.knownActivityType.update({
                where: { id: existingType.id },
                data: {
                  icon: type.icon,
                  description: type.description,
                  category: type.name || null,
                  updatedAt: new Date(),
                },
              });
            }
          } else {
            await this.prisma.knownActivityType.create({
              data: {
                name: type.name,
                icon: type.icon,
                description: type.description,
                category: type.name || null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }
        } catch (error) {
          this.logger.warn(
            `Warning processing activity type ${type.name}:`,
            error.message,
          );
          continue;
        }
      }
      this.logger.log('KnownActivityTypes initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing KnownActivityTypes:', error);
    }
  }

  private findMatchingActivityType(providerTypes: string[]): {
    name: string;
    duration: number;
  } | null {
    for (const providerType of providerTypes) {
      for (const [, type] of Object.entries(ActivityTypes)) {
        if (type.includes.includes(providerType)) {
          return { name: type.name, duration: type.defaultDuration };
        }
      }
    }
    return null;
  }

  async searchNearbyPlaces(
    dto: CrawlLocationDto,
    searchConfig: CatalogSearchConfig,
    maxResultCount = MAX_RESULTS_PER_CALL,
  ) {
    this.logger.debug('Iniciando búsqueda de lugares cercanos');
    this.logger.debug(
      'Configuración de búsqueda:',
      JSON.stringify(searchConfig, null, 2),
    );

    try {
      const useTextSearch = TEXT_SEARCH_TYPES.has(searchConfig.type);

      let placesData: any[] = [];
      let requestProvenance!: PlacesRequestProvenance;

      if (!useTextSearch) {
        // NEW Places API (v1) nearby search using includedTypes via IPlacesApiService
        const result = await this.placesApi.searchNearby({
          maxResultCount,
          includedTypes: [searchConfig.type],
          rankPreference: 'DISTANCE',
          latitude: dto.latitude,
          longitude: dto.longitude,
          radius: dto.radius || this.SEARCH_RADIUS,
        });
        placesData = result.data;
        requestProvenance = result.provenance;
      } else {
        // Fallback: searchText with keyword, biased to location
        const query =
          `${searchConfig.type.replace('_', ' ')} ${searchConfig.keyword}`.trim();
        const result = await this.placesApi.searchText({
          textQuery: query,
          maxResultCount,
          latitude: dto.latitude,
          longitude: dto.longitude,
          radius: dto.radius || this.SEARCH_RADIUS,
        });
        placesData = result.data;
        requestProvenance = result.provenance;
      }

      const requestedRadiusMeters = dto.radius || this.SEARCH_RADIUS;
      // Text Search only applies a location bias, not a hard geographic
      // restriction. Defensively enforce the crawl contract for every
      // provider/operation before a result can be transformed or persisted.
      const geographicallyValidResults = placesData.filter((place: any) => {
        const latitude = place.location?.latitude;
        const longitude = place.location?.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return false;
        }

        const distanceKm = calculateDistance(
          { latitude: dto.latitude, longitude: dto.longitude },
          { latitude, longitude },
        );
        return distanceKm * 1000 <= requestedRadiusMeters;
      });

      // A missing rating means the provider doesn't expose that data (e.g.
      // Geoapify never returns rating/review counts) rather than the place
      // being unrated — don't let it fail the minRating filter.
      const filteredResults = geographicallyValidResults.filter(
        (p: any) =>
          p.rating === undefined ||
          p.rating === null ||
          p.rating >= searchConfig.minRating,
      );

      const places = await Promise.all(
        filteredResults.map(async (place: any) => {
          // For v1 we can use fields already returned; extra details optional
          // TODO: Refactor getPlaceDetails to use abstraction if strictly needed, but it's a simple GET
          const details = dto.fetchDetails
            ? await this.getPlaceDetails(place.id)
            : null;

          // Separar los datos de la API de Google de nuestros datos personalizados
          const placeName = place.name || place.displayName?.text || '';
          const googlePlaceData: PlaceWithMetadata = {
            placeId: place.id,
            formattedAddress: place.formattedAddress || '',
            name: placeName,
            types: place.types || [],
            location: {
              latitude: place.location?.latitude || 0,
              longitude: place.location?.longitude || 0,
            },
            address: place.formattedAddress || '',
            rating: place.rating,
            reviews: place.userRatingCount,
            priceLevel: priceLevelToNumber(place.priceLevel),
            businessStatus: place.businessStatus,
            photos: [],
            // Google returns hours on the initial search result; Geoapify
            // only returns them on Place Details (`details`), not here.
            openingHours: place.openingHoursWeekdayText?.length
              ? { weekdayText: place.openingHoursWeekdayText }
              : details?.openingHours,
            phoneNumber: details?.phoneNumber,
            website: details?.website,
            metadata: {
              preferredTime: searchConfig.preferredTime,
            },
          };

          return googlePlaceData;
        }),
      );

      return {
        places,
        nextPageToken: null as any,
        provenance: requestProvenance,
        rejectedCountByReason: {
          ...(placesData.length - geographicallyValidResults.length > 0
            ? {
                out_of_area:
                  placesData.length - geographicallyValidResults.length,
              }
            : {}),
          ...(geographicallyValidResults.length - filteredResults.length > 0
            ? {
                low_rating:
                  geographicallyValidResults.length - filteredResults.length,
              }
            : {}),
        },
      };
    } catch (error: any) {
      this.logger.error('Error searching nearby places:', error);
      throw error;
    }
  }

  async getPlaceDetails(placeId: string): Promise<Partial<GooglePlaceDetails>> {
    try {
      const result = await this.placesApi.getPlaceDetails(placeId);
      return {
        phoneNumber: result.data.nationalPhoneNumber,
        website: result.data.websiteUri,
        openingHours: result.data.openingHoursWeekdayText?.length
          ? { weekdayText: result.data.openingHoursWeekdayText }
          : undefined,
      };
    } catch (error) {
      this.logger.error(`Error fetching place details for ${placeId}:`, error);
      return {};
    }
  }

  private async ensurePlacesSource(): Promise<string> {
    const provider = this.placesApi.provider;
    const sourceInfo =
      provider === 'geoapify'
        ? { name: 'geoapify', baseUrl: 'https://www.geoapify.com' }
        : { name: 'google-maps', baseUrl: 'https://maps.google.com' };

    try {
      const existingSource = await this.prisma.source.findUnique({
        where: { name: sourceInfo.name },
      });

      if (existingSource) {
        return existingSource.id;
      }

      const newSource = await this.prisma.source.create({
        data: {
          name: sourceInfo.name,
          type: 'external',
          baseUrl: sourceInfo.baseUrl,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return newSource.id;
    } catch (error) {
      this.logger.error('Error ensuring Places source:', error);
      throw error;
    }
  }

  private selectSearches(requestedInterests?: string[]): Array<{
    category: string;
    search: CatalogSearchConfig;
  }> {
    const requestedCategories = new Set(
      (requestedInterests ?? [])
        .map((interest) => INTEREST_CATEGORIES[interest.trim().toLowerCase()])
        .filter((category): category is string => !!category),
    );
    const categories =
      requestedCategories.size > 0
        ? requestedCategories
        : new Set(['cultural', 'outdoor', 'food']);

    const seenOperations = new Set<string>();
    const searches: Array<{
      category: string;
      search: CatalogSearchConfig;
    }> = [];
    for (const group of placesToSearch) {
      if (!categories.has(group.category)) continue;
      for (const search of group.searches) {
        // Nearby ignores the keyword, so two restaurant keyword variants are
        // the same provider operation. Text Search keeps its configured query.
        const key = TEXT_SEARCH_TYPES.has(search.type)
          ? `text:${search.type}:${search.keyword}`
          : `nearby:${search.type}`;
        if (seenOperations.has(key)) continue;
        seenOperations.add(key);
        searches.push({ category: group.category, search });
      }
    }
    return searches;
  }

  private buildSearchOperations(
    anchors: PlacesCrawlAnchor[],
    requestedInterests: string[] | undefined,
    maxProviderCalls: number,
  ): Array<{
    anchor: PlacesCrawlAnchor;
    category: string;
    search: CatalogSearchConfig;
  }> {
    const operations: Array<{
      anchor: PlacesCrawlAnchor;
      category: string;
      search: CatalogSearchConfig;
    }> = [];
    const searchesByCategory = new Map<
      string,
      Array<{ category: string; search: CatalogSearchConfig }>
    >();
    for (const selected of this.selectSearches(requestedInterests)) {
      const categorySearches = searchesByCategory.get(selected.category) ?? [];
      categorySearches.push(selected);
      searchesByCategory.set(selected.category, categorySearches);
    }

    const maxCategoryDepth = Math.max(
      0,
      ...Array.from(searchesByCategory.values()).map(
        (searches) => searches.length,
      ),
    );
    for (let depth = 0; depth < maxCategoryDepth; depth++) {
      for (const anchor of anchors) {
        for (const categorySearches of searchesByCategory.values()) {
          const selected = categorySearches[depth];
          if (!selected) continue;
          if (operations.length >= maxProviderCalls) return operations;
          operations.push({ anchor, ...selected });
        }
      }
    }
    return operations;
  }

  private incrementRejection(
    provenance: PlacesCrawlProvenance,
    reason: string,
    count = 1,
    countAsCandidate = true,
  ): void {
    provenance.rejectedCountByReason[reason] =
      (provenance.rejectedCountByReason[reason] ?? 0) + count;
    if (countAsCandidate) {
      provenance.rejectedCount = (provenance.rejectedCount ?? 0) + count;
    }
  }

  async crawlAndSaveActivities(
    dto: CrawlLocationDto,
    options: PlacesCrawlOptions = {},
  ): Promise<PlacesCrawlResult> {
    const status = this.getProviderStatus();
    const anchors = (
      options.anchors?.length
        ? options.anchors
        : [
            {
              id: 'destination-point',
              label: 'Destination point',
              latitude: dto.latitude,
              longitude: dto.longitude,
              radiusMeters: Math.min(dto.radius || this.SEARCH_RADIUS, 5_000),
            },
          ]
    ).slice(0, MAX_ANCHORS);
    const provenance: PlacesCrawlProvenance = {
      provider: status.provider,
      cacheStatus: status.cacheEnabled ? 'hit' : 'miss-live',
      requestedCount: 0,
      receivedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      validatedCount: 0,
      deduplicatedCount: 0,
      embeddedCount: 0,
      providerCallCount: 0,
      anchors: anchors.map((anchor) => ({ ...anchor })),
      rejectedCountByReason: {},
    };

    try {
      await this.ensureKnownActivityTypes();
      const sourceId = await this.ensurePlacesSource();
      const allPlaces: Array<{
        place: PlaceWithMetadata;
        category: string;
      }> = [];
      let firstRequestError: PlacesApiRequestError | null = null;
      const maxProviderCalls = Math.max(
        1,
        Math.min(
          options.maxProviderCalls ?? MAX_PROVIDER_CALLS,
          MAX_PROVIDER_CALLS,
        ),
      );
      const maxResultsPerCall = Math.max(
        1,
        Math.min(
          options.maxResultsPerCall ?? MAX_RESULTS_PER_CALL,
          MAX_RESULTS_PER_CALL,
        ),
      );
      const totalBudgetMs = Math.max(
        1_000,
        Math.min(
          options.totalBudgetMs ?? TOTAL_REFILL_BUDGET_MS,
          TOTAL_REFILL_BUDGET_MS,
        ),
      );
      const operations = this.buildSearchOperations(
        anchors,
        options.requestedInterests,
        maxProviderCalls,
      );
      const startedAt = Date.now();

      for (const operation of operations) {
        if (Date.now() - startedAt >= totalBudgetMs) {
          this.incrementRejection(
            provenance,
            'refill_budget_exhausted',
            1,
            false,
          );
          break;
        }
        provenance.providerCallCount = (provenance.providerCallCount ?? 0) + 1;
        try {
          const searchResult = await this.searchNearbyPlaces(
            {
              ...dto,
              latitude: operation.anchor.latitude,
              longitude: operation.anchor.longitude,
              radius: operation.anchor.radiusMeters,
            },
            operation.search,
            maxResultsPerCall,
          );
          this.addRequestProvenance(provenance, searchResult.provenance);
          for (const [reason, count] of Object.entries(
            searchResult.rejectedCountByReason,
          )) {
            this.incrementRejection(provenance, reason, count);
          }
          allPlaces.push(
            ...searchResult.places.map((place) => ({
              place,
              category: operation.category,
            })),
          );
        } catch (error) {
          if (!(error instanceof PlacesApiRequestError)) throw error;
          firstRequestError ??= error;
          this.addRequestProvenance(provenance, error.provenance);
          this.incrementRejection(
            provenance,
            'provider_request_failed',
            1,
            false,
          );
          this.logger.warn(
            `Skipping failed ${error.operation ?? 'Places'} request (${error.code}) and continuing catalog refill.`,
          );
        }
      }

      const uniquePlaces = new Map<
        string,
        { place: PlaceWithMetadata; category: string }
      >();
      for (const entry of allPlaces) {
        const identity = `${this.placesApi.provider}:${entry.place.placeId}`;
        if (uniquePlaces.has(identity)) {
          provenance.deduplicatedCount =
            (provenance.deduplicatedCount ?? 0) + 1;
          this.incrementRejection(provenance, 'duplicate_result');
          continue;
        }
        uniquePlaces.set(identity, entry);
      }

      const defaultDurationsByCategory: Record<string, number> = {
        cultural: ActivityTypes.CULTURAL.defaultDuration,
        outdoor: ActivityTypes.OUTDOOR.defaultDuration,
        entertainment: ActivityTypes.ENTERTAINMENT.defaultDuration,
        food: ActivityTypes.FOOD.defaultDuration,
        nightlife: ActivityTypes.NIGHTLIFE.defaultDuration,
      };

      const validatedPlaces: CreateActivityDto[] = [];
      for (const { place, category } of uniquePlaces.values()) {
        const mapped = this.findMatchingActivityType(place.types || []);
        const categoryName = mapped?.name ?? category;
        const candidate: CreateActivityDto = {
          name: place.name,
          description: place.website,
          type: categoryName,
          duration:
            mapped?.duration ?? defaultDurationsByCategory[categoryName] ?? 2.0,
          price: place.priceLevel ? place.priceLevel * 10 : 0,
          maxGroupSize: 15,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          rating: place.rating,
          ratingCount: place.reviews,
          formattedAddress: place.address,
          phoneNumber: place.phoneNumber,
          website: place.website,
          businessStatus: place.businessStatus,
          priceLevel: place.priceLevel,
          openingHours: place.openingHours,
          knownActivityTypeName: categoryName,
          location: place.location,
          sourceId,
          externalId: place.placeId,
          metadata: {
            activityId: place.placeId,
            placesProvider: this.placesApi.provider,
            providerTypes: place.types || [],
            preferredTime: place.metadata?.preferredTime,
          },
        };
        const validation = this.catalogCandidateValidator.validate(
          {
            provider: this.placesApi.provider,
            externalId: candidate.externalId,
            name: candidate.name,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            providerTypes: place.types || [],
            formattedAddress: candidate.formattedAddress,
            businessStatus: candidate.businessStatus,
            rating: candidate.rating,
            ratingCount: candidate.ratingCount,
          },
          { destinationBoundary: options.destinationBoundary },
        );
        if (!validation.accepted) {
          provenance.rejectedCount = (provenance.rejectedCount ?? 0) + 1;
          for (const reason of validation.rejectionReasons) {
            this.incrementRejection(provenance, reason, 1, false);
          }
          continue;
        }
        provenance.validatedCount = (provenance.validatedCount ?? 0) + 1;
        validatedPlaces.push(candidate);
      }

      if (validatedPlaces.length === 0 && firstRequestError) {
        throw firstRequestError;
      }

      const activities = [];
      for (const place of validatedPlaces) {
        const placeExist = await this.prisma.activity.findFirst({
          where: {
            sourceId: sourceId,
            externalId: place.externalId,
          },
        });

        if (placeExist) {
          this.incrementRejection(provenance, 'existing_activity');
          continue;
        }

        const result = await this.activitiesService.create(place);
        activities.push(result);
      }

      this.logger.debug(`Saved ${activities.length} activities to database`);
      provenance.acceptedCount = activities.length;

      if (activities.length > 0) {
        try {
          await this.vectorStoreService.saveActivityEmbedding(activities);
          provenance.embeddedCount = activities.length;
        } catch (error) {
          // Log error but don't fail the entire crawling process
          this.logger.error(
            `Failed to save embeddings, but activities were saved: ${error.message}`,
          );
        }
      }

      return {
        activitiesIds: activities.map((activity) => activity.id.toString()),
        fromCache: provenance.cacheStatus === 'hit',
        provenance,
      };
    } catch (error) {
      this.logger.error('Error in crawlAndSaveActivities:', error);
      throw new PlacesCrawlError(
        `Catalog refill failed using ${placesProviderLabel(provenance.provider)}: ${error.message}`,
        provenance,
        error,
        error instanceof PlacesApiRequestError ? error.code : 'request_failed',
      );
    }
  }
}
