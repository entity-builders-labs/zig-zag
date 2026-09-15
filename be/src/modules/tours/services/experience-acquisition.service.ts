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
import { deficitKey } from './experience-acquisition-planner.service';
import {
  ExperienceCandidate,
  ExperienceDiscoveryExtractor,
  ExperienceDiscoveryRequest,
} from '../interfaces/experience-discovery.interface';
import {
  EXPERIENCE_GROUNDED_SEARCH_PROVIDER,
  ExperienceGroundedSearchProvider,
} from '../interfaces/experience-grounding.interface';
import { GooglePlacesAcquisitionProvider } from '../providers/google-places-acquisition.provider';
import { WikivoyageAcquisitionProvider } from '../providers/wikivoyage-acquisition.provider';
import { OsmAcquisitionProvider } from '../providers/osm-acquisition.provider';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import {
  EXPERIENCE_PROPOSAL_RESOLVER,
  ExperienceProposalResolver,
  ExperienceValidationScope,
  GeographicScope,
  FinalExperienceResolutionResponse,
} from '../interfaces/experience-resolution.interface';
import { ExperienceClassificationService } from './experience-classification.service';
import { classifyAcceptedResultsByExperience } from '../utils/experience-classification-convergence.util';
import { candidateSatisfiesEvidenceRequirement } from '../utils/acquisition-candidate-requirement.util';

export interface ResolverEvidenceItem {
  key: string;
  source: string;
  title?: string;
  snippet?: string;
  url?: string;
}

/**
 * Per-`web` SourcePlan execution record. Web does NOT produce SourceObservations
 * — grounded evidence goes straight to the shared discovery extractor and yields
 * ExperienceCandidates — so it is reported separately rather than faked into
 * `providerResults<SourceObservation>`.
 */
export interface WebAcquisitionResult {
  status: 'success' | 'failed' | 'skipped';
  query: string;
  groundedProvider?: string;
  groundedModel?: string;
  groundingStatus?: string;
  evidenceKeys: string[];
  evidenceProvenance?: unknown;
  extractorProvider?: string;
  extractorModel?: string;
  rawOutput?: string;
  validationErrors: string[];
  candidateCount: number;
  failureReason?: string;
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
  webResults?: WebAcquisitionResult[];
  structuredCandidateCount?: number;
  webCandidateCount?: number;
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
  geographicScope?: GeographicScope;
  [key: string]: unknown;
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
    @Optional()
    @Inject(EXPERIENCE_GROUNDED_SEARCH_PROVIDER)
    private readonly groundedSearchProvider?: ExperienceGroundedSearchProvider,
    @Optional()
    @Inject('EXPERIENCE_DISCOVERY_PROVIDER')
    private readonly discoveryExtractor?: ExperienceDiscoveryExtractor,
    @Optional()
    private readonly classifier?: ExperienceClassificationService,
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

    // Web SourcePlans: grounded evidence -> shared discovery extractor ->
    // ExperienceCandidates. Not a SourceObservation path; reported separately.
    // Each web plan is failure-isolated (mirrors the structured loop).
    const webResults: WebAcquisitionResult[] = [];
    const webCandidates: ExperienceCandidate[] = [];
    const webEvidence: ResolverEvidenceItem[] = [];
    for (const sourcePlan of plan.sourcePlans) {
      if (sourcePlan.provider !== 'web') continue;
      webResults.push(
        await this.executeWebSourcePlan(plan, sourcePlan.web, {
          webCandidates,
          webEvidence,
        }),
      );
    }

    // Structured synthesis + corroboration only when there are observations.
    const structuredCandidates: ExperienceCandidate[] = [];
    const structuredEvidence: ResolverEvidenceItem[] = [];
    if (allObservations.length > 0) {
      const proposals = this.synthesizer
        ? this.synthesizer.synthesizeProposals(allObservations)
        : (() => {
            throw new Error(
              'StructuredExperienceCandidateSynthesizerService is required for structured acquisition',
            );
          })();

      if (!this.corroborationService) {
        throw new Error(
          'StructuredCandidateCorroborationService is required for structured acquisition',
        );
      }
      const mergeResult = this.corroborationService.corroborateAndMerge(
        proposals,
        plan.evidenceRequirements,
      );
      structuredCandidates.push(...mergeResult.candidates);

      for (const obs of allObservations) {
        structuredEvidence.push({
          key: obs.evidenceKey,
          source: obs.provider,
          title: obs.title,
          snippet: obs.description,
          url: obs.sourceUrl,
        });
      }
    }

    // Structured + web candidates converge on the ExperienceCandidate boundary;
    // web is NOT fed through the structured corroborator — the resolver's
    // SAME/NEW/AMBIGUOUS + dedupe is the only authority for any overlap.
    return {
      candidates: [...structuredCandidates, ...webCandidates],
      observations: allObservations,
      providerResults,
      webResults: webResults.length > 0 ? webResults : undefined,
      structuredCandidateCount: structuredCandidates.length,
      webCandidateCount: webCandidates.length,
      evidence: [...structuredEvidence, ...webEvidence],
    };
  }

  private async executeWebSourcePlan(
    plan: ExperienceAcquisitionPlan,
    web: NonNullable<
      Extract<
        ExperienceAcquisitionPlan['sourcePlans'][number],
        { provider: 'web' }
      >['web']
    >,
    sink: {
      webCandidates: ExperienceCandidate[];
      webEvidence: ResolverEvidenceItem[];
    },
  ): Promise<WebAcquisitionResult> {
    if (!this.groundedSearchProvider || !this.discoveryExtractor) {
      return {
        status: 'skipped',
        query: web.query,
        evidenceKeys: [],
        validationErrors: [],
        candidateCount: 0,
        failureReason: 'web discovery providers not configured',
      };
    }

    try {
      const grounded = await this.groundedSearchProvider.search({
        destinationName: plan.destination.destinationName ?? '',
        requestedThemes: web.requestedThemes ?? [],
        requestedIntents: web.requestedIntents,
        additionalPreferences: web.semanticQuery,
        query: web.query,
        anchorNames: web.anchorNames,
      });

      const base: WebAcquisitionResult = {
        status: 'success',
        query: web.query,
        groundedProvider: grounded.provider,
        groundedModel: grounded.model,
        groundingStatus: grounded.groundingStatus,
        evidenceKeys: (grounded.evidence ?? []).map((e) => e.key),
        evidenceProvenance: grounded.evidenceProvenance,
        validationErrors: [],
        candidateCount: 0,
      };

      if (!grounded.evidence || grounded.evidence.length === 0) {
        return base;
      }

      const request: ExperienceDiscoveryRequest = {
        scope: { destinationName: plan.destination.destinationName },
        requestedThemes: web.requestedThemes ?? [],
        requestedIntents: web.requestedIntents,
        preferredTraits: web.preferredTraits,
        semanticQuery: web.semanticQuery,
        coverageGaps: [
          ...new Set(
            plan.deficits
              .map((d) => deficitKey(d) ?? d.reason)
              .filter((v): v is string => !!v && v.trim().length > 0),
          ),
        ],
        breadth: plan.breadth,
        maxCandidates: 8,
      };

      const extracted = await this.discoveryExtractor.extractExperiences(
        request,
        grounded,
        { bypassCache: true },
      );

      const admissibleCandidates = extracted.candidates.filter((candidate) =>
        plan.evidenceRequirements.some((requirement) =>
          candidateSatisfiesEvidenceRequirement(candidate, requirement),
        ),
      );
      sink.webCandidates.push(...admissibleCandidates);
      for (const ev of grounded.evidence) {
        sink.webEvidence.push({
          key: ev.key,
          source: ev.source,
          title: ev.title,
          snippet: ev.snippet,
          url: ev.url,
        });
      }

      return {
        ...base,
        extractorProvider: extracted.provider,
        extractorModel: extracted.model,
        rawOutput: extracted.rawOutput,
        validationErrors: extracted.validationErrors ?? [],
        candidateCount: admissibleCandidates.length,
      };
    } catch (error: any) {
      this.logger.warn(
        `Web acquisition threw: ${error?.message ?? String(error)}`,
      );
      return {
        status: 'failed',
        query: web.query,
        evidenceKeys: [],
        validationErrors: [],
        candidateCount: 0,
        failureReason: error?.message ?? 'Web acquisition failed',
      };
    }
  }

  async acquireNearby(input: AcquireNearbyInput) {
    const acquisition = await this.catalog.acquireNearbyAsExperiences(input);

    const canResolve =
      Boolean(this.proposalResolver) && Boolean(input.geographicScope);

    if (canResolve && acquisition.candidates.length > 0) {
      const resolverEvidence: ResolverEvidenceItem[] = (
        acquisition.observations ?? []
      ).map((obs) => ({
        key: obs.evidenceKey,
        source: obs.provider,
        title: obs.title,
        snippet: obs.description,
        url: obs.sourceUrl,
      }));

      const resolution = await this.proposalResolver!.resolve({
        candidates: acquisition.candidates,
        destinationName: input.destinationName,
        destinationCountryCode: input.destinationCountryCode,
        geographicScope: input.geographicScope!,
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
      geographicScope?: GeographicScope;
      [key: string]: unknown;
      /** Task B5 — see ExperienceValidationScope. */
      validationScope?: ExperienceValidationScope;
      validationIntent?: 'walk' | 'route_like';
    },
  ): Promise<FinalExperienceResolutionResponse> {
    if (!this.proposalResolver) {
      throw new Error(
        'ExperienceProposalResolver is required for materialization',
      );
    }
    const response = await this.proposalResolver.resolve({
      candidates: execution.candidates,
      destinationName: context.destinationName,
      destinationCountryCode: context.destinationCountryCode,
      geographicScope: context.geographicScope,
      evidence: execution.evidence,
      validationScope: context.validationScope,
      validationIntent: context.validationIntent,
    });

    // Cutover M4 (spec cutover plan §6) -- the single place EVERY
    // acquisition strategy's materialized output gets classified, never a
    // per-strategy opt-in. Runs for every caller of materializeExecution
    // (the generic acquisition loop and AreaRouteWalkAcquisitionService
    // alike) -- classification is a property of this shared boundary now,
    // not of any one caller.
    if (this.classifier) {
      response.classification = await classifyAcceptedResultsByExperience(
        response.resolved,
        execution.evidence,
        { catalog: this.catalog, classifier: this.classifier },
      );
    }

    return response;
  }
}
