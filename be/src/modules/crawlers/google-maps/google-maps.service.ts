// @ts-nocheck
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@googlemaps/google-maps-services-js';
import axios from 'axios';
import { CrawlLocationDto } from './dto/crawl-location.dto';
import { GooglePlaceDetails } from '../../activities/interfaces/google-places.interface';
import { ActivitiesService } from '../../activities/services/activities.service';
import { CreateActivityDto } from '../../activities/dto/create-activity.dto';
import { LangChainService } from '../../../shared/ai/langchain.service';
import { PrismaService } from '../../../core/database/prisma.service';
import { IPlacesApiService } from './interfaces/places-api.interface';

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
export class GoogleMapsService implements OnModuleInit {
  private readonly COORDINATES_THRESHOLD = 0.01; // Approximately 1km threshold
  private readonly SEARCH_RADIUS = 5000; // 5km radius for finding activities

  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly client: Client;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly aiService: LangChainService,
    @Inject('PlacesApiService') private readonly placesApi: IPlacesApiService,
  ) {
    this.client = new Client({});
  }

  async onModuleInit() {
    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'Google Maps API key is not configured. Google Maps functionality will not be available.',
      );
    }
    await this.ensureKnownActivityTypes();
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

  private findMatchingActivityType(googleTypes: string[]): {
    name: string;
    duration: number;
  } | null {
    for (const googleType of googleTypes) {
      for (const [, type] of Object.entries(ActivityTypes)) {
        if (type.includes.includes(googleType)) {
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

      if (!useTextSearch) {
        // NEW Places API (v1) nearby search using includedTypes via IPlacesApiService
        placesData = await this.placesApi.searchNearby({
          maxResultCount: 20,
          includedTypes: [searchConfig.type],
          rankPreference: 'DISTANCE',
          latitude: dto.latitude,
          longitude: dto.longitude,
          radius: dto.radius || this.SEARCH_RADIUS,
        });
      } else {
        // Fallback: searchText with keyword, biased to location
        const query =
          `${searchConfig.type.replace('_', ' ')} ${searchConfig.keyword}`.trim();
        placesData = await this.placesApi.searchText({
          textQuery: query,
          maxResultCount: 20,
          latitude: dto.latitude,
          longitude: dto.longitude,
          radius: dto.radius || this.SEARCH_RADIUS,
        });
      }

      const filteredResults = placesData.filter(
        (p: any) => (p.rating || 0) >= searchConfig.minRating,
      );

      const places = await Promise.all(
        filteredResults.map(async (place: any) => {
          // For v1 we can use fields already returned; extra details optional
          // TODO: Refactor getPlaceDetails to use abstraction if strictly needed, but it's a simple GET
          const details = dto.fetchDetails
            ? await this.getPlaceDetails(place.id)
            : null;

          // Separar los datos de la API de Google de nuestros datos personalizados
          const googlePlaceData = {
            name: place.name || place.displayName?.text || '',
            placeId: place.id,
            types: place.types || [],
            location: {
              latitude: place.location?.latitude,
              longitude: place.location?.longitude,
            },
            address: place.formattedAddress,
            rating: place.rating,
            reviews: place.userRatingCount,
            priceLevel: undefined,
            businessStatus: undefined,
            photos: [],
            ...(details || {}),
          };

          // Agregar nuestros datos personalizados en un objeto separado
          const customData = {
            preferredTime: searchConfig.preferredTime,
          };

          return {
            ...googlePlaceData,
            metadata: customData,
          };
        }),
      );

      return {
        places,
        nextPageToken: null,
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
        phoneNumber: result.nationalPhoneNumber,
        website: result.websiteUri,
      };
    } catch (error) {
      this.logger.error(`Error fetching place details for ${placeId}:`, error);
      return {};
    }
  }

  private async ensureGoogleMapsSource(): Promise<string> {
    try {
      const existingSource = await this.prisma.source.findUnique({
        where: { name: 'google-maps' },
      });

      if (existingSource) {
        return existingSource.id;
      }

      const newSource = await this.prisma.source.create({
        data: {
          name: 'google-maps',
          type: 'crawler',
          baseUrl: 'https://maps.google.com',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return newSource.id;
    } catch (error) {
      this.logger.error('Error ensuring Google Maps source:', error);
      throw error;
    }
  }

  async crawlAndSaveActivities(dto: CrawlLocationDto): Promise<{
    activitiesIds: string[];
    fromCache: boolean;
  }> {
    try {
      await this.ensureKnownActivityTypes();
      const sourceId = await this.ensureGoogleMapsSource();
      const allPlaces: Array<CreateActivityDto> = [];

      for (const categoryGroup of placesToSearch.map((group) => group)) {
        this.logger.debug(`Processing category: ${categoryGroup.category}`);

        for (const search of categoryGroup.searches) {
          this.logger.debug(`Processing search type: ${search.type}`);

          let nextPageToken: string | null = null;
          do {
            const { places, nextPageToken: newNextPageToken } =
              await this.searchNearbyPlaces(
                {
                  ...dto,
                  pageToken: nextPageToken,
                },
                search,
              );

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
                knownActivityTypeName: categoryName,
                location: place.location,
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceId: sourceId,
                externalId: place.placeId,
                metadata: {
                  activityId: place.placeId,
                  googleTypes: place.types || [],
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
          continue;
        }

        const result = await this.activitiesService.create(place);
        activities.push(result);
      }

      this.logger.debug(`Saved ${activities.length} activities to database`);

      if (activities.length > 0) {
        try {
          await this.aiService.saveActivityEmbedding(activities);
        } catch (error) {
          // Log error but don't fail the entire crawling process
          this.logger.error(
            `Failed to save embeddings, but activities were saved: ${error.message}`,
          );
        }
      }

      return {
        activitiesIds: activities.map((activity) => activity.id.toString()),
        fromCache: false,
      };
    } catch (error) {
      this.logger.error('Error in crawlAndSaveActivities:', error);
      throw error;
    }
  }
}
