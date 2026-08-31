import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityKind, Prisma, VariantTheme } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  PlaceData,
  PlacesProvider,
} from '@integrations/google-places/interfaces/places-api.interface';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import {
  GeographicValidationBatchResult,
  GeographicValidationResult,
} from '../interfaces/geographic-validation.interface';
import {
  ProposalMaterializationResponse,
  ProposalResolutionRequest,
  ProposalResolutionResponse,
  ResolvedActivityProposal,
  ResolvedEntity,
} from '../interfaces/proposal-resolution.interface';

const THEME_TO_VARIANT: Record<string, VariantTheme> = {
  history: VariantTheme.HISTORY,
  historic: VariantTheme.HISTORY,
  heritage: VariantTheme.HISTORY,
  culture: VariantTheme.HISTORY,
  landmark: VariantTheme.HISTORY,
  landmarks: VariantTheme.HISTORY,
  art: VariantTheme.ART,
  arts: VariantTheme.ART,
  food: VariantTheme.FOOD,
  foodie: VariantTheme.FOOD,
  gastronomy: VariantTheme.FOOD,
  tapas: VariantTheme.FOOD,
  nature: VariantTheme.NATURE,
  outdoor: VariantTheme.NATURE,
  outdoors: VariantTheme.NATURE,
  architecture: VariantTheme.ARCHITECTURE,
  nightlife: VariantTheme.NIGHTLIFE,
  shopping: VariantTheme.SHOPPING,
  family: VariantTheme.FAMILY,
  tango: VariantTheme.TANGO,
  photography: VariantTheme.PHOTOGRAPHY,
  photo: VariantTheme.PHOTOGRAPHY,
  quick: VariantTheme.QUICK,
  'deep dive': VariantTheme.DEEP_DIVE,
  'deep-dive': VariantTheme.DEEP_DIVE,
};

const THEME_NAME: Record<VariantTheme, string> = {
  HISTORY: 'Historic',
  ART: 'Art',
  FOOD: 'Food',
  NATURE: 'Nature',
  ARCHITECTURE: 'Architecture',
  NIGHTLIFE: 'Nightlife',
  SHOPPING: 'Shopping',
  FAMILY: 'Family',
  TANGO: 'Tango',
  PHOTOGRAPHY: 'Photography',
  QUICK: 'Quick',
  DEEP_DIVE: 'Deep Dive',
};

@Injectable()
export class ActivityProposalMaterializationService {
  private readonly logger = new Logger(
    ActivityProposalMaterializationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly compositeActivityService: CompositeActivityService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  async materializeBatch(
    resolution: ProposalResolutionResponse,
    validation: GeographicValidationBatchResult,
    request: ProposalResolutionRequest,
  ): Promise<ProposalMaterializationResponse> {
    const resolved: ResolvedActivityProposal[] = [];

    for (let index = 0; index < resolution.resolved.length; index += 1) {
      const entry = resolution.resolved[index];
      const geographic = validation.results[index];
      if (!geographic?.accepted) {
        resolved.push({
          ...entry,
          status: 'rejected',
          rejectionReasons: Array.from(
            new Set([
              ...entry.rejectionReasons,
              ...(geographic?.rejectionReasons ?? ['geographic_validation_missing']),
            ]),
          ),
          persistedActivityId: undefined,
        });
        continue;
      }

      try {
        const activity = await this.materializeProposal(
          entry,
          geographic,
          request,
        );
        resolved.push({
          ...entry,
          status: 'accepted',
          rejectionReasons: [],
          persistedActivityId: activity.id,
        });
      } catch (error: any) {
        this.logger.warn(
          `Failed to materialize geographically verified proposal "${entry.proposal.name}": ${error.message}`,
        );
        resolved.push({
          ...entry,
          status: 'rejected',
          rejectionReasons: Array.from(
            new Set([...entry.rejectionReasons, 'persistence_failed']),
          ),
          persistedActivityId: undefined,
        });
      }
    }

    return {
      resolved,
      totalProposals: resolved.length,
      materializedCount: resolved.filter((entry) => entry.persistedActivityId)
        .length,
      rejectedCount: resolved.filter((entry) => !entry.persistedActivityId)
        .length,
    };
  }

  private async materializeProposal(
    entry: ResolvedActivityProposal,
    geographic: GeographicValidationResult,
    request: ProposalResolutionRequest,
  ): Promise<Activity> {
    switch (entry.proposal.kind) {
      case 'POI':
        return this.materializeEntity(
          geographic.canonicalEntity ?? geographic.anchors[0],
        );
      case 'AREA': {
        const entity = geographic.canonicalEntity ?? geographic.anchors[0];
        const candidate = this.osmCandidate(entity);
        if (!candidate) throw new Error('AREA has no resolved OSM candidate');
        return this.compositeActivityService.resolveArea(candidate);
      }
      case 'NEIGHBORHOOD_WALK':
      case 'ROUTE':
      case 'EXPERIENCE':
        return this.materializeComposite(entry, geographic, request);
      default:
        throw new Error(`Unsupported proposal kind: ${entry.proposal.kind}`);
    }
  }

  private async materializeComposite(
    entry: ResolvedActivityProposal,
    geographic: GeographicValidationResult,
    request: ProposalResolutionRequest,
  ): Promise<Activity> {
    if (!request.destinationBoundary) {
      throw new Error('Composite materialization requires destination boundary');
    }

    const kind = ActivityKind[
      entry.proposal.kind as keyof typeof ActivityKind
    ] as ActivityKind;
    const variantTheme = this.pickVariantTheme(entry.proposal.themes);
    if (!variantTheme) {
      throw new Error('unresolvable_theme');
    }

    const resolvedArea = entry.resolvedEntities.find(
      (entity) => entity.role === 'area' && entity.status === 'resolved',
    );
    const areaCandidate =
      this.osmCandidate(resolvedArea) ?? request.destinationBoundary;
    const waypointIds: string[] = [];
    const candidateOsmFeaturesById = new Map<string, OsmCandidate>();
    const activitiesToIndex: Activity[] = [];

    for (const entity of geographic.anchors) {
      if (entity.role === 'area') continue;
      const candidate = this.osmCandidate(entity);
      if (entity.role === 'route' && candidate) {
        candidateOsmFeaturesById.set(candidate.id, candidate);
        waypointIds.push(candidate.id);
        continue;
      }

      const activity = await this.materializeEntity(entity);
      waypointIds.push(activity.id);
      activitiesToIndex.push(activity);
    }

    const variant = await this.compositeActivityService.createOrReuseComposite({
      name: this.canonicalName(areaCandidate.name, variantTheme, kind),
      kind,
      variantTheme,
      themeReasoning: entry.proposal.shortReason,
      areaCandidate,
      waypointIds,
      candidateOsmFeaturesById,
    });

    if (activitiesToIndex.length > 0) {
      try {
        await this.vectorStoreService.saveActivityEmbedding(
          activitiesToIndex.map((activity) => ({ id: activity.id })),
        );
      } catch (error: any) {
        this.logger.warn(
          `Failed to index materialized component embeddings: ${error.message}`,
        );
      }
    }
    return variant;
  }

  private async materializeEntity(entity?: ResolvedEntity): Promise<Activity> {
    if (!entity || entity.status !== 'resolved' || !entity.materialization) {
      throw new Error('Resolved entity has no materialization reference');
    }
    if (entity.activityId) {
      const existing = await this.prisma.activity.findUnique({
        where: { id: entity.activityId },
      });
      if (existing) return existing;
    }

    if (entity.materialization.kind === 'place') {
      if (entity.provider !== 'google' && entity.provider !== 'geoapify') {
        throw new Error('Resolved Places entity is missing its provider');
      }
      return this.materializePlace(
        entity.materialization.place,
        entity.provider,
      );
    }
    return this.materializeOsmComponent(
      entity.materialization.candidate,
      entity.expectedType,
    );
  }

  private async materializePlace(
    place: PlaceData,
    provider: PlacesProvider,
  ): Promise<Activity> {
    const sourceName = provider === 'geoapify' ? 'geoapify' : 'google-maps';
    const baseUrl =
      provider === 'geoapify'
        ? 'https://www.geoapify.com'
        : 'https://maps.google.com';
    const sourceId = await this.ensureSource(sourceName, 'external', baseUrl);
    const externalId = place.id;
    const primaryType = place.primaryType ?? place.types?.[0] ?? undefined;

    return this.findOrCreateWithRace(
      () =>
        this.prisma.activity.findUnique({
          where: { sourceId_externalId: { sourceId, externalId } },
        }),
      () =>
        this.prisma.activity.create({
          data: {
            name: place.displayName?.text ?? place.name ?? '',
            kind: ActivityKind.POI,
            type: primaryType,
            latitude: place.location?.latitude,
            longitude: place.location?.longitude,
            formattedAddress: place.formattedAddress,
            rating: place.rating,
            ratingCount: place.userRatingCount,
            source: { connect: { id: sourceId } },
            externalId,
            metadata: {
              placesProvider: provider,
              providerTypes: place.types ?? [],
              providerPrimaryType: place.primaryType,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
    );
  }

  private async materializeOsmComponent(
    candidate: OsmCandidate,
    expectedType: string,
  ): Promise<Activity> {
    const sourceId = await this.ensureSource(
      'openstreetmap',
      'external',
      'https://www.openstreetmap.org',
    );
    const externalId = `${candidate.osmType}/${candidate.osmId}`;
    const center = this.centroidOf(candidate);
    const primaryType =
      expectedType ||
      candidate.tags.tourism ||
      candidate.tags.amenity ||
      candidate.tags.historic ||
      candidate.tags.leisure ||
      candidate.tags.natural ||
      'osm_feature';

    return this.findOrCreateWithRace(
      () =>
        this.prisma.activity.findUnique({
          where: { sourceId_externalId: { sourceId, externalId } },
        }),
      () =>
        this.prisma.activity.create({
          data: {
            name: candidate.name,
            kind: ActivityKind.POI,
            type: primaryType,
            latitude: center.latitude,
            longitude: center.longitude,
            boundary:
              candidate.geometry.type === 'Point'
                ? undefined
                : (candidate.geometry as unknown as Prisma.InputJsonValue),
            source: { connect: { id: sourceId } },
            externalId,
            metadata: {
              provider: 'osm',
              osmType: candidate.osmType,
              osmId: candidate.osmId,
              providerTags: candidate.tags,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
    );
  }

  private osmCandidate(entity?: ResolvedEntity): OsmCandidate | undefined {
    return entity?.materialization?.kind === 'osm'
      ? entity.materialization.candidate
      : undefined;
  }

  private async findOrCreateWithRace<T>(
    find: () => Promise<T | null>,
    create: () => Promise<T>,
  ): Promise<T> {
    const existing = await find();
    if (existing) return existing;
    try {
      return await create();
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const retried = await find();
        if (retried) return retried;
      }
      throw error;
    }
  }

  private async ensureSource(
    name: string,
    type: string,
    baseUrl?: string,
  ): Promise<string> {
    const source = await this.findOrCreateWithRace(
      () => this.prisma.source.findUnique({ where: { name } }),
      () => this.prisma.source.create({ data: { name, type, baseUrl } }),
    );
    return source.id;
  }

  private pickVariantTheme(themes: string[]): VariantTheme | null {
    for (const theme of themes) {
      const mapped = THEME_TO_VARIANT[normalizeName(theme)];
      if (mapped) return mapped;
    }
    return null;
  }

  private canonicalName(
    areaName: string,
    theme: VariantTheme,
    kind: ActivityKind,
  ): string {
    const suffix =
      kind === ActivityKind.ROUTE
        ? 'Route'
        : kind === ActivityKind.EXPERIENCE
          ? 'Experience'
          : 'Walk';
    return `${areaName} ${THEME_NAME[theme]} ${suffix}`;
  }

  private centroidOf(candidate: OsmCandidate): {
    latitude: number;
    longitude: number;
  } {
    const geometry = candidate.geometry;
    if (geometry.type === 'Point') {
      return {
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0],
      };
    }
    const ring: [number, number][] =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.coordinates[0][0];
    return {
      latitude: ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length,
      longitude: ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length,
    };
  }
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
