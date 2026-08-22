import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { CrawlLocationDto } from './dto/crawl-location.dto';
import { GooglePlaceDetails } from '../../activities/interfaces/google-places.interface';
import { ActivitiesService } from '../../activities/services/activities.service';
import { CreateActivityDto } from '../../activities/dto/create-activity.dto';
import { LangChainService } from '../../../shared/ai/langchain.service';
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

const placesToSearch = [
  {
    category: 'cultural',
    searches: [
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
      {
        type: 'tourist_attraction',
        keyword: 'historic cultural landmark',
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
    private readonly aiService: LangChainService,
    private readonly vectorStoreService: VectorStoreService,
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

  /**
   * Classify a place into a canonical activity category using AI as a fallback
   * when the static Google-types mapping does not yield a match.
   * Returns one of: "cultural", "outdoor", "entertainment", "food", "nightlife".
   */
  private async classifyActivityCategoryWithAI(place: {
    name?: string;
    types?: string[];
    formattedAddress?: string;
    website?: string;
    rating?: number;
  }): Promise<string | null> {
    try {
      // If AI is not configured or fails, we'll just return null and let callers default
      const categories = [
        'cultural',
        'outdoor',
        'entertainment',
        'food',
        'nightlife',
      ];
      const prompt = `Given the following place data, choose the single best category from this exact set: cultural | outdoor | entertainment | food | nightlife.

Place JSON:
{placeJson}

Answer ONLY with one word from the set above, no punctuation, no explanation.`;

      const response = await this.aiService.generateCompletionResponse(prompt, {
        placeJson: JSON.stringify(place),
      } as any);

      const normalized = String(response || '')
        .trim()
        .toLowerCase();
      if (categories.includes(normalized)) return normalized;
      // Sometimes models add quotes or periods
      const cleaned = normalized.replace(/[^a-z]/g, '');
      if (categories.includes(cleaned)) return cleaned;
      return null;
    } catch {
      this.logger.warn(
        'AI category classification failed; falling back to defaults',
      );
      return null;
    }
  }

  async searchNearbyPlaces(
    dto: CrawlLocationDto,
    searchConfig: {
      type: string;
      keyword: string;
      minRating: number;
      preferredTime: string;
    },
  ) {
    this.logger.debug('Iniciando búsqueda de lugares cercanos');
    this.logger.debug(
      'Configuración de búsqueda:',
      JSON.stringify(searchConfig, null, 2),
    );

    try {
      const unsupportedTypes = new Set<string>([
        'point_of_interest',
        'natural_feature',
        'hiking_trail',
      ]);

      const useTextSearch = unsupportedTypes.has(searchConfig.type);

      let placesData: any[] = [];
      let requestProvenance!: PlacesRequestProvenance;

      if (!useTextSearch) {
        // NEW Places API (v1) nearby search using includedTypes via IPlacesApiService
        const result = await this.placesApi.searchNearby({
          maxResultCount: 20,
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
          maxResultCount: 20,
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
            businessStatus: undefined,
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

  async crawlAndSaveActivities(
    dto: CrawlLocationDto,
  ): Promise<PlacesCrawlResult> {
    const status = this.getProviderStatus();
    const provenance: PlacesCrawlProvenance = {
      provider: status.provider,
      cacheStatus: status.cacheEnabled ? 'hit' : 'miss-live',
      requestedCount: 0,
      receivedCount: 0,
      acceptedCount: 0,
      rejectedCountByReason: {},
    };

    try {
      await this.ensureKnownActivityTypes();
      const sourceId = await this.ensurePlacesSource();
      const allPlaces: Array<CreateActivityDto> = [];
      let firstRequestError: PlacesApiRequestError | null = null;

      for (const categoryGroup of placesToSearch.map((group) => group)) {
        this.logger.debug(`Processing category: ${categoryGroup.category}`);

        for (const search of categoryGroup.searches) {
          this.logger.debug(`Processing search type: ${search.type}`);

          let nextPageToken: string | null = null;
          do {
            let searchResult;
            try {
              searchResult = await this.searchNearbyPlaces(
                {
                  ...dto,
                  pageToken: nextPageToken,
                },
                search,
              );
            } catch (error) {
              if (!(error instanceof PlacesApiRequestError)) throw error;

              firstRequestError ??= error;
              this.addRequestProvenance(provenance, error.provenance);
              provenance.rejectedCountByReason.provider_request_failed =
                (provenance.rejectedCountByReason.provider_request_failed ??
                  0) + 1;
              this.logger.warn(
                `Skipping failed ${error.operation ?? 'Places'} request (${error.code}) and continuing catalog refill.`,
              );
              break;
            }

            const {
              places,
              nextPageToken: newNextPageToken,
              provenance: requestProvenance,
              rejectedCountByReason,
            } = searchResult;

            this.addRequestProvenance(provenance, requestProvenance);
            for (const [reason, count] of Object.entries(
              rejectedCountByReason,
            )) {
              provenance.rejectedCountByReason[reason] =
                (provenance.rejectedCountByReason[reason] ?? 0) + count;
            }

            const processedPlaces = [];
            for (const place of places) {
              // 1) Try static mapping from Google types
              const mapped = this.findMatchingActivityType(place.types || []);

              // 2) If not mapped, ask AI to classify into canonical category
              let categoryName = mapped?.name;
              if (!categoryName) {
                categoryName = await this.classifyActivityCategoryWithAI({
                  name: place.name,
                  types: place.types,
                  formattedAddress: place.address,
                  website: place.website,
                  rating: place.rating,
                });
              }

              // 3) Final fallback: use the configured search group category
              if (!categoryName) {
                categoryName = String(categoryGroup.category).toLowerCase();
              }

              const defaultDurationsByCategory: Record<string, number> = {
                cultural: ActivityTypes.CULTURAL.defaultDuration,
                outdoor: ActivityTypes.OUTDOOR.defaultDuration,
                entertainment: ActivityTypes.ENTERTAINMENT.defaultDuration,
                food: ActivityTypes.FOOD.defaultDuration,
                nightlife: ActivityTypes.NIGHTLIFE.defaultDuration,
              } as const;

              const duration =
                mapped?.duration ??
                defaultDurationsByCategory[categoryName] ??
                2.0;

              processedPlaces.push({
                name: place.name,
                description: place.website,
                type: categoryName,
                duration,
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
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceId: sourceId,
                externalId: place.placeId,
                metadata: {
                  activityId: place.placeId,
                  placesProvider: this.placesApi.provider,
                  providerTypes: place.types || [],
                  preferredTime: (place as any).metadata?.preferredTime,
                },
              } as CreateActivityDto);
            }

            allPlaces.push(...processedPlaces);
            nextPageToken = newNextPageToken;

            if (nextPageToken) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          } while (nextPageToken);
        }
      }

      // A successful secondary operation with no geographically valid
      // candidates does not erase the primary provider degradation. Preserve
      // the real failure instead of later claiming that the destination has no
      // places at all.
      if (allPlaces.length === 0 && firstRequestError) {
        throw firstRequestError;
      }

      const activities = [];
      for (const place of allPlaces) {
        // Since sourceId and externalId are now optional, check if activity exists differently
        const placeExist = await this.prisma.activity.findFirst({
          where: {
            sourceId: sourceId,
            externalId: place.externalId,
          },
        });

        if (placeExist) {
          provenance.rejectedCountByReason.existing_activity =
            (provenance.rejectedCountByReason.existing_activity ?? 0) + 1;
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
