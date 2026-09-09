import { Injectable, Optional, Logger } from '@nestjs/common';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
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
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import {
  CorroborationGroupTrace,
  CorroborationPairTrace,
  StructuredCandidateCorroborationService,
} from './structured-candidate-corroboration.service';

export interface ExecuteAcquisitionPlanResult {
  candidates: ExperienceCandidate[];
  observations: SourceObservation[];
  providerResults: Partial<
    Record<
      ExperienceAcquisitionProvider,
      AcquisitionProviderResult<SourceObservation>
    >
  >;
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
      }
    }

    if (allObservations.length === 0) {
      return {
        candidates: [],
        observations: [],
        providerResults,
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

    return {
      candidates: mergeResult.candidates,
      observations: allObservations,
      providerResults,
    };
  }

  async acquireNearby(input: {
    latitude: number;
    longitude: number;
    radius: number;
    interests?: string[];
    maxResultCount?: number;
  }) {
    const result = await this.catalog.acquireNearbyAsExperiences(input);
    const embedding = await this.embeddingIndexer.index(result.experienceIds);

    return {
      ...result,
      provenance: {
        ...result.provenance,
        acceptedCount: result.experienceIds.length,
        rejectedCountByReason: {},
        embeddedCount: embedding.indexedIds.length,
        embeddingWriteStatus: embedding.status,
        embeddingFailureReason: embedding.reason,
        embeddingIdentity: embedding.identity,
      },
    };
  }
}
