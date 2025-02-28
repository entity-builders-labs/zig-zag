import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  Client,
  Language,
  PlaceType1,
  PlacesNearbyRanking,
  LatLng,
} from '@googlemaps/google-maps-services-js';
import { CrawlLocationDto } from './dto/crawl-location.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Activity } from '@prisma/client';
import { GooglePlaceDetails } from '../../activities/interfaces/google-places.interface';
import { ActivitiesService } from '../../activities/activities.service';
import { CreateActivityDto } from '../../activities/dto/create-activity.dto';
import { LangChainService } from '../../shared/ai/langchain.service';

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

  private async findExistingSearch(
    latitude: number,
    longitude: number,
  ): Promise<boolean> {
    try {
      const existingSearch = await this.prisma.crawlerSearch.findFirst({
        where: {
          AND: [
            { latitude: { gte: latitude - this.COORDINATES_THRESHOLD } },
            { latitude: { lte: latitude + this.COORDINATES_THRESHOLD } },
            { longitude: { gte: longitude - this.COORDINATES_THRESHOLD } },
            { longitude: { lte: longitude + this.COORDINATES_THRESHOLD } },
          ],
        },
      });
      return !!existingSearch;
    } catch (error) {
      this.logger.error('Error finding existing crawler search:', error);
      return false;
    }
  }

  private async findActivitiesNearCoordinates(
    latitude: number,
    longitude: number,
  ): Promise<Activity[]> {
    try {
      const activities = await this.prisma.activity.findMany({
        where: {
          AND: [
            { latitude: { gte: latitude - this.COORDINATES_THRESHOLD } },
            { latitude: { lte: latitude + this.COORDINATES_THRESHOLD } },
            { longitude: { gte: longitude - this.COORDINATES_THRESHOLD } },
            { longitude: { lte: longitude + this.COORDINATES_THRESHOLD } },
          ],
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100,
      });
      return activities;
    } catch (error) {
      this.logger.error('Error finding activities near coordinates:', error);
      return [];
    }
  }

  private async saveCrawlerSearch(
    latitude: number,
    longitude: number,
  ): Promise<void> {
    try {
      await this.prisma.crawlerSearch.create({
        data: {
          latitude,
          longitude,
        },
      });
      this.logger.debug(
        `Saved crawler search for coordinates: ${latitude}, ${longitude}`,
      );
    } catch (error) {
      this.logger.error('Error saving crawler search:', error);
      throw error;
    }
  }

  private buildGoogleMapsUrls(
    placeId: string,
    location: { latitude: number; longitude: number },
  ) {
    return {
      googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
      googleMapsDirectionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}&destination_place_id=${placeId}`,
    };
  }
  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly client: Client;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly aiService: LangChainService,
  ) {
    this.client = new Client({});
  }

  async onModuleInit() {
    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      throw new Error('Google Maps API key is required');
    }
    await this.ensureKnownActivityTypes();
  }

  private async ensureKnownActivityTypes() {
    try {
      // Asegurar que todos los tipos conocidos existan en la base de datos
      for (const [key, type] of Object.entries(ActivityTypes)) {
        await this.prisma.knownActivityType.upsert({
          where: { name: type.name },
          update: {
            icon: type.icon,
            description: type.description,
          },
          create: {
            name: type.name,
            icon: type.icon,
            description: type.description,
          },
        });
      }
      this.logger.log('KnownActivityTypes initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing KnownActivityTypes:', error);
      throw error;
    }
  }

  private findMatchingActivityType(googleTypes: string[]): {
    name: string;
    duration: number;
  } | null {
    for (const googleType of googleTypes) {
      for (const [key, type] of Object.entries(ActivityTypes)) {
        if (type.includes.includes(googleType)) {
          return { name: type.name, duration: type.defaultDuration };
        }
      }
    }
    return null;
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

    const apiParams = {
      location: { lat: dto.latitude, lng: dto.longitude } as LatLng,
      rankby: PlacesNearbyRanking.distance,
      type: searchConfig.type as PlaceType1,
      language: (dto.language as Language) || Language.es,
      key: this.configService.get<string>('GOOGLE_MAPS_API_KEY'),
      pagetoken: dto.pageToken,
      keyword: searchConfig.keyword,
      opennow: dto.openNow,
      fields: [
        'name',
        'place_id',
        'types',
        'geometry',
        'vicinity',
        'rating',
        'user_ratings_total',
        'price_level',
        'business_status',
        'photos',
        'formatted_phone_number',
        'website',
        'opening_hours',
        'price_level',
        'price',
        'max_group_size',
        'latitude',
        'longitude',
        'placeId',
        'rating',
        'ratingCount',
        'formattedAddress',
        'phoneNumber',
        'url',
      ],
    };

    try {
      const { data } = await this.client.placesNearby({ params: apiParams });

      if (data.status !== 'OK') {
        this.logger.warn(`API response status: ${data.status}`);
        this.logger.warn(
          `API error message: ${data.error_message || 'No error message provided'}`,
        );
        return { places: [], nextPageToken: null };
      }

      const filteredResults = data.results.filter(
        (place) => (place.rating || 0) >= searchConfig.minRating,
      );

      const places = await Promise.all(
        filteredResults.map(async (place) => {
          const details = dto.fetchDetails
            ? await this.getPlaceDetails(place.place_id)
            : null;

          // Separar los datos de la API de Google de nuestros datos personalizados
          const googlePlaceData = {
            name: place.name,
            placeId: place.place_id,
            types: place.types,
            location: {
              latitude: place.geometry.location.lat,
              longitude: place.geometry.location.lng,
            },
            address: place.vicinity,
            rating: place.rating,
            reviews: place.user_ratings_total,
            priceLevel: place.price_level,
            businessStatus: place.business_status,
            photos: place.photos?.map((photo) => photo.photo_reference) || [],
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
        nextPageToken: data.next_page_token,
      };
    } catch (error) {
      this.logger.error('Error searching nearby places:', error);
      throw error;
    }
  }

  async getPlaceDetails(placeId: string): Promise<Partial<GooglePlaceDetails>> {
    try {
      const { data } = await this.client.placeDetails({
        params: {
          place_id: placeId,
          key: this.configService.get<string>('GOOGLE_MAPS_API_KEY'),
          language: Language.es,
        },
      });

      const result = data.result;
      return {
        phoneNumber: result.formatted_phone_number,
        website: result.website,
      };
    } catch (error) {
      this.logger.error(`Error fetching place details for ${placeId}:`, error);
      throw error;
    }
  }

  async crawlAndSaveActivities(dto: CrawlLocationDto): Promise<{
    activitiesIds: number[];
    fromCache: boolean;
  }> {
    try {
      await this.ensureKnownActivityTypes();
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

            const processedPlaces = places.map((place) => {
              const knownActivityType = this.findMatchingActivityType(
                place.types,
              );

              return {
                name: place.name,
                description: place.website,
                type: categoryGroup.category.toLowerCase(),
                duration: knownActivityType?.duration ?? 2.0,
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
                knownActivityTypeName: categoryGroup.category.toLowerCase(),
                location: place.location,
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceId: 'google-maps',
                externalId: place.placeId,
                metadata: {
                  activityId: place.placeId,
                },
              } as CreateActivityDto;
            });

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
        const placeExist = await this.prisma.activity.findUnique({
          where: {
            sourceId_externalId: {
              sourceId: 'google-maps',
              externalId: place.externalId,
            },
          },
        });

        if (placeExist) {
          continue;
        }

        const result = await this.activitiesService.create(place);
        // save the activity embedding
        activities.push(result);
      }

      this.logger.debug(`Saved ${activities.length} activities to database`);

      // Save the crawler search
      // await this.saveCrawlerSearch(dto.latitude, dto.longitude);

      if (activities.length > 0) {
        // save the activity embedding
        await this.aiService.saveActivityEmbedding(activities);
      }

      return {
        activitiesIds: activities.map((activity) => activity.id),
        fromCache: false,
      };
    } catch (error) {
      this.logger.error('Error in crawlAndSaveActivities:', error);
      throw error;
    }
  }
}
