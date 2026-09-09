import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  AcquisitionProviderResult,
  ExperienceAcquisitionProvider,
  SourceObservation,
} from '../interfaces/experience-acquisition.interface';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { GooglePlacesAcquisitionProvider } from '../providers/google-places-acquisition.provider';
import { WikivoyageAcquisitionProvider } from '../providers/wikivoyage-acquisition.provider';
import { OsmAcquisitionProvider } from '../providers/osm-acquisition.provider';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import {
  CorroborationGroupTrace,
  CorroborationPairTrace,
  StructuredCandidateCorroborationService,
} from './structured-candidate-corroboration.service';
import {
  EXPERIENCE_PROPOSAL_RESOLVER,
  ExperienceProposalResolver,
  FinalExperienceResolutionResponse,
} from '../interfaces/experience-resolution.interface';

export interface ResolverEvidenceItem {
  key: string;
  source: string;
  title?: string;
  snippet?: string;
  url?: string;
}

export interface ExecuteAcquisitionPlanResult {
  candidates: ExperienceCandidate[];
  observations: SourceObservation[];
  providerResults: Partial<
    Record<
      ExperienceAcquisitionProvider,
      AcquisitionProviderResult<SourceObservation>
    >
  >;
  evidence?: ResolverEvidenceItem[];
}

export interface AcquireNearbyInput {
  latitude: number;
  longitude: number;
  radius: number;
  interests?: string[];
  maxResultCount?: number;
  destinationName?: string;
  destinationCountryCode?: string;
  destinationBoundary?: unknown;
  destinationPointRadius?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
}

/**
 * First-class acquisition boundary for the V2 catalog.
 * Tour generation may request a refill, but acquisition itself is reusable by
 * admin jobs and never owns Tour/TourExperience persistence.
 *
 * A successful catalog write is not complete until the semantic index has
 * been attempted. Provider unavailability remains retryable/observable rather
 * than being hidden as a fully indexed catalog population.
 */
@Injectable()
export class ExperienceAcquisitionService {
  private readonly logger = new Logger(ExperienceAcquisitionService.name);

  constructor(
    private readonly catalog: ExperienceCatalogService,
    private readonly embeddingIndexer: ExperienceEmbeddingIndexerService,
    @Optional()
    private readonly googlePlacesProvider?: GooglePlacesAcquisitionProvider,
    @Optional()
    private readonly wikivoyageProvider?: WikivoyageAcquisitionProvider,
    @Optional()
    private readonly synthesizer?: StructuredExperienceCandidateSynthesizerService,
    @Optional()
    private readonly corroborationService?: StructuredCandidateCorroborationService,
    @Optional()
    @Inject(EXPERIENCE_PROPOSAL_RESOLVER)
    private readonly proposalResolver?: ExperienceProposalResolver,
    @Optional()
    private readonly osmProvider?: OsmAcquisitionProvider,
  ) {}

  async executePlan(
    plan: ExperienceAcquisitionPlan,
  ): Promise<ExecuteAcquisitionPlanResult> {
    const providerResults: Partial<
      Record<
        ExperienceAcquisitionProvider,
        AcquisitionProviderResult<SourceObservation>
      >
    > = {};
    const allObservations: SourceObservation[] = [];

    for (const sourcePlan of plan.sourcePlans) {
      if (sourcePlan.provider === 'wikivoyage' && this.wikivoyageProvider) {
        try {
          const res = await this.wikivoyageProvider.acquire(
            plan.destination.destinationName,
            sourcePlan.wikivoyage,
          );
          providerResults.wikivoyage = res;
          if (res.status === 'success' && res.value?.length > 0) {
            allObservations.push(...res.value);
          }
        } catch (error: any) {
          this.logger.warn(
            `Wikivoyage acquisition threw: ${error?.message ?? String(error)}`,
          );
          providerResults.wikivoyage = {
            status: 'failed',
            value: [],
            failureReason: error?.message ?? 'Wikivoyage acquisition failed',
          };
        }
      } else if (
        sourcePlan.provider === 'google_places' &&
        this.googlePlacesProvider
      ) {
        try {
          const res = await this.googlePlacesProvider.acquire(
            plan.destination,
            sourcePlan.places,
          );
          providerResults.google_places = res;
          if (res.status === 'success' && res.value?.length > 0) {
            allObservations.push(...res.value);
          }
        } catch (error: any) {
          this.logger.warn(
            `Google Places acquisition threw: ${error?.message ?? String(error)}`,
          );
          providerResults.google_places = {
            status: 'failed',
            value: [],
            failureReason: error?.message ?? 'Google Places acquisition failed',
          };
        }
      } else if (sourcePlan.provider === 'osm' && this.osmProvider) {
        try {
          const res = await this.osmProvider.acquire(
            plan.destination,
            sourcePlan.osm,
          );
          providerResults.osm = res;
          if (res.status === 'success' && res.value?.length > 0) {
            allObservations.push(...res.value);
          }
        } catch (error: any) {
          this.logger.warn(
            `OSM acquisition threw: ${error?.message ?? String(error)}`,
          );
          providerResults.osm = {
            status: 'failed',
            value: [],
            failureReason: error?.message ?? 'OSM acquisition failed',
          };
        }
      }
    }

    if (allObservations.length === 0) {
      return {
        candidates: [],
        observations: [],
        providerResults,
        evidence: [],
      };
    }

    const proposals = this.synthesizer
      ? this.synthesizer.synthesizeProposals(allObservations)
      : [];

    const mergeResult = this.corroborationService
      ? this.corroborationService.corroborateAndMerge(proposals)
      : {
          candidates: proposals.map((p) => p.candidate),
          groups: [] as CorroborationGroupTrace[],
          pairDecisions: [] as CorroborationPairTrace[],
        };

    const evidence: ResolverEvidenceItem[] = allObservations.map((obs) => ({
      key: obs.evidenceKey,
      source: obs.provider,
      title: obs.title,
      snippet: obs.description,
      url:
        typeof (obs.metadata as any)?.websiteUri === 'string'
          ? (obs.metadata as any).websiteUri
          : undefined,
    }));

    return {
      candidates: mergeResult.candidates,
      observations: allObservations,
      providerResults,
      evidence,
    };
  }

  async acquireNearby(input: AcquireNearbyInput) {
    const acquisition = await this.catalog.acquireNearbyAsExperiences(input);

    // Resolver-backed materialization requires a real `destinationBoundary`:
    // ExperienceProposalResolverService.resolve() throws without it.
    // `destinationPointRadius` is supplemental point-scale context, never a
    // substitute — a point-scale destination still passes a synthetic
    // point-radius boundary alongside it (see ExperienceGenerationService).
    const canResolve =
      Boolean(this.proposalResolver) && Boolean(input.destinationBoundary);

    if (canResolve && acquisition.candidates.length > 0) {
      const resolverEvidence: ResolverEvidenceItem[] = (
        acquisition.observations ?? []
      ).map((obs) => ({
        key: obs.evidenceKey,
        source: obs.provider,
        title: obs.title,
        snippet: obs.description,
        url:
          typeof (obs.metadata as any)?.websiteUri === 'string'
            ? (obs.metadata as any).websiteUri
            : undefined,
      }));

      const resolution = await this.proposalResolver!.resolve({
        candidates: acquisition.candidates,
        destinationName: input.destinationName,
        destinationCountryCode: input.destinationCountryCode,
        destinationBoundary: input.destinationBoundary,
        destinationPointRadius: input.destinationPointRadius,
        evidence: resolverEvidence,
      });

      const acceptedIds = resolution.resolved
        .filter((r) => r.status === 'accepted' && r.experienceId)
        .map((r) => r.experienceId as string);

      // Return exactly the Experiences this resolution materialized, in
      // acceptance order — not a broader geographic pool, which could both
      // omit accepted ids past a limit and surface unrelated nearby rows.
      const persistedExperiences =
        acceptedIds.length > 0
          ? await this.catalog.findVerifiedByIds(acceptedIds)
          : [];

      const rejectedCountByReason: Record<string, number> = {};
      for (const res of resolution.resolved) {
        if (res.status === 'rejected') {
          for (const reason of res.rejectionReasons ?? []) {
            rejectedCountByReason[reason] =
              (rejectedCountByReason[reason] ?? 0) + 1;
          }
        }
      }

      // Embedding indexing is owned by ExperienceProposalResolverService
      // (gated on dedupe NEW / semanticDocumentChanged, and the embedding
      // provider may be unavailable). Its per-Experience outcome is not
      // propagated here, so no embedding-specific provenance is reported —
      // "not reported" is correct; a fabricated `embeddingWriteStatus:
      // 'indexed'` / `embeddedCount: acceptedIds.length` is not.
      const provenance: PlacesCrawlProvenance = {
        ...acquisition.provenance,
        acceptedCount: acceptedIds.length,
        rejectedCountByReason,
      };

      return {
        ...acquisition,
        experienceIds: acceptedIds,
        experiences: persistedExperiences,
        resolution,
        provenance,
      };
    }

    const embedding = await this.embeddingIndexer.index(
      acquisition.experienceIds,
    );

    const provenance: PlacesCrawlProvenance = {
      ...acquisition.provenance,
      acceptedCount: acquisition.experienceIds.length,
      rejectedCountByReason: {},
      embeddedCount: embedding.indexedIds.length,
      embeddingWriteStatus: embedding.status,
      embeddingFailureReason: embedding.reason,
      embeddingIdentity: embedding.identity,
    };

    return {
      ...acquisition,
      provenance,
    };
  }

  async materializeExecution(
    execution: ExecuteAcquisitionPlanResult,
    context: {
      destinationName?: string;
      destinationCountryCode?: string;
      destinationBoundary: unknown;
      destinationPointRadius?: {
        latitude: number;
        longitude: number;
        radiusMeters: number;
      };
    },
  ): Promise<FinalExperienceResolutionResponse> {
    if (!this.proposalResolver) {
      throw new Error(
        'ExperienceProposalResolver is required for materialization',
      );
    }
    return this.proposalResolver.resolve({
      candidates: execution.candidates,
      destinationName: context.destinationName,
      destinationCountryCode: context.destinationCountryCode,
      destinationBoundary: context.destinationBoundary,
      destinationPointRadius: context.destinationPointRadius,
      evidence: execution.evidence,
    });
  }
}
