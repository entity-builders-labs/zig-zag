import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { CrawlLocationDto } from './dto/crawl-location.dto';
import { GooglePlaceDetails } from '../../activities/interfaces/google-places.interface';
import { ActivitiesService } from '../../activities/services/activities.service';
import { CreateActivityDto } from '../../activities/dto/create-activity.dto';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  IPlacesApiService,
  PlacesApiRequestError,
  CatalogAcquisitionOperation,
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
import { buildCatalogAcquisitionPlan } from './utils/catalog-acquisition-plan.util';

interface PlaceWithMetadata extends GooglePlaceDetails {
  name: string;
  types: string[];
  primaryType?: string;
  address: string;
  location: {
    latitude: number;
    longitude: number;
  };
  reviews?: number;
  metadata: {
    preferredTime: string;
    acquisitionOperationId: string;
    acquisitionPurpose: CatalogAcquisitionOperation['purpose'];
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
  source?: 'destination_point' | 'child_area_center' | 'boundary';
}

export interface PlacesCrawlOptions {
  anchors?: PlacesCrawlAnchor[];
  destinationLabel?: string;
  destinationBoundary?: GeoJsonGeometry;
  requestedInterests?: string[];
  maxProviderCalls?: number;
  maxResultsPerCall?: number;
  totalBudgetMs?: number;
}

const MAX_PROVIDER_CALLS = 12;
const MAX_RESULTS_PER_CALL = 10;
const TOTAL_REFILL_BUDGET_MS = 20_000;
const MAX_ANCHORS = 8;

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
      'cultural_landmark',
      'monument',
      'sculpture',
      'plaza',
      'observation_deck',
      'history_museum',
      'art_museum',
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
    includes: [
      'park',
      'national_park',
      'nature_preserve',
      'hiking_area',
      'beach',
      'hiking_trail',
      'natural_feature',
    ],
    defaultDuration: 3.0,
    icon: '🌳',
    description: 'Outdoor and nature activities',
    timePreference: 'day',
  },
  ENTERTAINMENT: {
    name: 'entertainment',
    includes: [
      'amusement_park',
      'movie_theater',
      'performing_arts_theater',
      'bowling_alley',
      'casino',
    ],
    defaultDuration: 4.0,
    icon: '🎭',
    description: 'Entertainment and fun activities',
    timePreference: 'evening',
  },
  FOOD: {
    name: 'food',
    includes: ['restaurant', 'cafe', 'bakery', 'food_market', 'food_court'],
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

  private async executeAcquisitionOperation(
    dto: CrawlLocationDto,
    operation: CatalogAcquisitionOperation,
  ): Promise<{
    places: PlaceWithMetadata[];
    provenance: PlacesRequestProvenance;
    rejectedCountByReason: Record<string, number>;
  }> {
    let result;
    if (operation.providerOperation === 'nearby') {
      if (operation.geographicConstraint.kind !== 'circle') {
        throw new Error(
          `Nearby operation ${operation.operationId} requires a circle`,
        );
      }
      const { center, radius } = operation.geographicConstraint.circle;
      result = await this.placesApi.searchNearby({
        latitude: center.latitude,
        longitude: center.longitude,
        radius,
        includedPrimaryTypes: operation.requestedPrimaryTypes,
        maxResultCount: operation.resultBudget,
        rankPreference: operation.rankPreference ?? 'POPULARITY',
      });
    } else {
      if (!operation.textQuery) {
        throw new Error(`Text operation ${operation.operationId} has no query`);
      }
      result = await this.placesApi.searchText({
        textQuery: operation.textQuery,
        includedType: operation.includedType,
        strictTypeFiltering: operation.strictTypeFiltering,
        maxResultCount: operation.resultBudget,
        ...(operation.geographicConstraint.kind === 'rectangle'
          ? {
              locationRestriction: operation.geographicConstraint.rectangle,
            }
          : { locationBias: operation.geographicConstraint.circle }),
      });
    }

    // Provider geography is never the final authority. In particular, Text
    // Search's bias/restriction semantics differ from Nearby. Enforce the
    // acquisition operation's declared geometry before validation/persistence.
    const geographicallyValidResults = result.data.filter((place) =>
      this.isInsideAcquisitionGeography(place, operation),
    );
    const places = await Promise.all(
      geographicallyValidResults.map(async (place) => {
        const details = dto.fetchDetails
          ? await this.getPlaceDetails(place.id)
          : null;
        return {
          placeId: place.id,
          formattedAddress: place.formattedAddress || '',
          name: place.name || place.displayName?.text || '',
          types: place.types || [],
          primaryType: place.primaryType,
          location: {
            latitude: place.location!.latitude,
            longitude: place.location!.longitude,
          },
          address: place.formattedAddress || '',
          rating: place.rating,
          reviews: place.userRatingCount,
          priceLevel: priceLevelToNumber(place.priceLevel),
          businessStatus: place.businessStatus,
          photos: [] as GooglePlaceDetails['photos'],
          openingHours: place.openingHoursWeekdayText?.length
            ? { weekdayText: place.openingHoursWeekdayText }
            : details?.openingHours,
          phoneNumber:
            details?.phoneNumber || place.nationalPhoneNumber || undefined,
          website: details?.website || place.websiteUri || undefined,
          metadata: {
            preferredTime: operation.preferredTime,
            acquisitionOperationId: operation.operationId,
            acquisitionPurpose: operation.purpose,
          },
        } satisfies PlaceWithMetadata;
      }),
    );

    const outOfArea = result.data.length - geographicallyValidResults.length;
    return {
      places,
      provenance: result.provenance,
      rejectedCountByReason: outOfArea > 0 ? { out_of_area: outOfArea } : {},
    };
  }

  private isInsideAcquisitionGeography(
    place: { location?: { latitude: number; longitude: number } },
    operation: CatalogAcquisitionOperation,
  ): boolean {
    const location = place.location;
    if (
      !location ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude)
    ) {
      return false;
    }
    const geography = operation.geographicConstraint;
    if (geography.kind === 'rectangle') {
      return (
        location.latitude >= geography.rectangle.low.latitude &&
        location.latitude <= geography.rectangle.high.latitude &&
        location.longitude >= geography.rectangle.low.longitude &&
        location.longitude <= geography.rectangle.high.longitude
      );
    }
    return (
      calculateDistance(geography.circle.center, location) * 1000 <=
      geography.circle.radius
    );
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
      seedReceivedCount: 0,
      coverageReceivedCount: 0,
      operationGeographyRejectedCount: 0,
      validatedCount: 0,
      identityValidCount: 0,
      admittedCount: 0,
      admissionEvidenceCountByType: {},
      deduplicatedCount: 0,
      existingCount: 0,
      persistedCount: 0,
      embeddedCount: 0,
      embeddingWriteStatus: 'no_work',
      providerCallCount: 0,
      anchors: anchors.map((anchor) => ({ ...anchor })),
      operations: [],
      rejectedCountByReason: {},
    };

    try {
      await this.ensureKnownActivityTypes();
      const sourceId = await this.ensurePlacesSource();
      const allPlaces: Array<{
        place: PlaceWithMetadata;
        category: string;
        operation: CatalogAcquisitionOperation;
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
      const operations = buildCatalogAcquisitionPlan({
        provider: this.placesApi.provider,
        anchors,
        requestedInterests: options.requestedInterests,
        destinationLabel: options.destinationLabel,
        destinationBoundary: options.destinationBoundary,
        maxProviderCalls,
        resultBudget: maxResultsPerCall,
      });
      const startedAt = Date.now();

      for (const operation of operations) {
        if (!operation.supported) {
          provenance.operations!.push({
            ...operation,
            status: 'skipped',
            receivedCount: 0,
            rejectedCountByReason: {
              [operation.unsupportedReason ?? 'provider_capability']: 1,
            },
          });
          continue;
        }
        if (Date.now() - startedAt >= totalBudgetMs) {
          this.incrementRejection(
            provenance,
            'refill_budget_exhausted',
            1,
            false,
          );
          provenance.operations!.push({
            ...operation,
            status: 'skipped',
            receivedCount: 0,
            rejectedCountByReason: { refill_budget_exhausted: 1 },
          });
          continue;
        }
        provenance.providerCallCount = (provenance.providerCallCount ?? 0) + 1;
        try {
          const searchResult = await this.executeAcquisitionOperation(
            dto,
            operation,
          );
          this.addRequestProvenance(provenance, searchResult.provenance);
          if (operation.purpose === 'destination_seed') {
            provenance.seedReceivedCount =
              (provenance.seedReceivedCount ?? 0) +
              searchResult.provenance.receivedCount;
          } else {
            provenance.coverageReceivedCount =
              (provenance.coverageReceivedCount ?? 0) +
              searchResult.provenance.receivedCount;
          }
          for (const [reason, count] of Object.entries(
            searchResult.rejectedCountByReason,
          )) {
            this.incrementRejection(provenance, reason, count);
            if (reason === 'out_of_area') {
              provenance.operationGeographyRejectedCount =
                (provenance.operationGeographyRejectedCount ?? 0) + count;
            }
          }
          allPlaces.push(
            ...searchResult.places.map((place) => ({
              place,
              category: operation.category,
              operation,
            })),
          );
          provenance.operations!.push({
            ...operation,
            status: 'succeeded',
            receivedCount: searchResult.provenance.receivedCount,
            rejectedCountByReason: searchResult.rejectedCountByReason,
          });
        } catch (error) {
          if (!(error instanceof PlacesApiRequestError)) throw error;
          firstRequestError ??= error;
          this.addRequestProvenance(provenance, error.provenance);
          if (operation.purpose === 'destination_seed') {
            provenance.seedReceivedCount =
              (provenance.seedReceivedCount ?? 0) +
              error.provenance.receivedCount;
          } else {
            provenance.coverageReceivedCount =
              (provenance.coverageReceivedCount ?? 0) +
              error.provenance.receivedCount;
          }
          this.incrementRejection(
            provenance,
            'provider_request_failed',
            1,
            false,
          );
          provenance.operations!.push({
            ...operation,
            status: 'failed',
            receivedCount: error.provenance.receivedCount,
            rejectedCountByReason: { provider_request_failed: 1 },
          });
          this.logger.warn(
            `Skipping failed ${error.operation ?? 'Places'} request (${error.code}) and continuing catalog refill.`,
          );
        }
      }

      const uniquePlaces = new Map<
        string,
        {
          place: PlaceWithMetadata;
          category: string;
          operation: CatalogAcquisitionOperation;
        }
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
      for (const { place, category, operation } of uniquePlaces.values()) {
        const mapped = this.findMatchingActivityType([
          ...(place.primaryType ? [place.primaryType] : []),
          ...(place.types || []),
        ]);
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
            providerPrimaryType: place.primaryType,
            preferredTime: place.metadata?.preferredTime,
            acquisitionOperationId: operation.operationId,
            acquisitionPurpose: operation.purpose,
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
            providerPrimaryType: place.primaryType,
            formattedAddress: candidate.formattedAddress,
            businessStatus: candidate.businessStatus,
            rating: candidate.rating,
            ratingCount: candidate.ratingCount,
            website: candidate.website,
            phoneNumber: candidate.phoneNumber,
            openingHours: candidate.openingHours,
          },
          {
            destinationBoundary: options.destinationBoundary,
            acquisitionOperation: operation,
          },
        );
        if (validation.identityAccepted) {
          provenance.identityValidCount =
            (provenance.identityValidCount ?? 0) + 1;
        }
        if (validation.admissionAccepted) {
          provenance.admittedCount = (provenance.admittedCount ?? 0) + 1;
          if (validation.admissionEvidence) {
            provenance.admissionEvidenceCountByType![
              validation.admissionEvidence
            ] =
              (provenance.admissionEvidenceCountByType![
                validation.admissionEvidence
              ] ?? 0) + 1;
          }
        }
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
          provenance.existingCount = (provenance.existingCount ?? 0) + 1;
          this.incrementRejection(provenance, 'existing_activity');
          continue;
        }

        const result = await this.activitiesService.create(place);
        activities.push(result);
      }

      this.logger.debug(`Saved ${activities.length} activities to database`);
      provenance.acceptedCount = activities.length;
      provenance.persistedCount = activities.length;

      if (activities.length > 0) {
        try {
          const embeddingResult =
            await this.vectorStoreService.saveActivityEmbedding(activities);
          provenance.embeddingWriteStatus = embeddingResult.status;
          provenance.embeddedCount = embeddingResult.indexedIds.length;
          provenance.embeddingFailureReason = embeddingResult.reason;
          provenance.embeddingIdentity = embeddingResult.identity;
        } catch (error) {
          provenance.embeddingWriteStatus = 'failed';
          provenance.embeddingFailureReason =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to save embeddings, but activities were saved: ${provenance.embeddingFailureReason}`,
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
