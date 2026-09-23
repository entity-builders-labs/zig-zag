import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  AcquisitionProviderResult,
  ExperienceAcquisitionProvider,
  SourceObservation,
} from '../interfaces/experience-acquisition.interface';
import {
  AcquisitionDeficit,
  ExperienceAcquisitionPlan,
  SourcePlan,
} from '../interfaces/experience-acquisition-plan.interface';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { deficitKey } from './experience-acquisition-planner.service';
import {
  ExperienceCandidate,
  ExperienceDiscoveryExtractor,
  ExperienceDiscoveryRequest,
} from '../interfaces/experience-discovery.interface';
import { CandidateSourceSupportAudit } from '../utils/experience-candidate-extraction.util';
import {
  EXPERIENCE_GROUNDED_SEARCH_PROVIDER,
  ExperienceGroundedSearchProvider,
  GroundingNormalizationAudit,
  ExperienceGroundingEvidenceKind,
} from '../interfaces/experience-grounding.interface';
import { GooglePlacesAcquisitionProvider } from '../providers/google-places-acquisition.provider';
import { WikivoyageAcquisitionProvider } from '../providers/wikivoyage-acquisition.provider';
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
import {
  AcquisitionExecutionLedger,
  acquisitionSourcePlanFingerprint,
} from '../utils/acquisition-source-plan-fingerprint.util';
import { classifyAcceptedResultsByExperience } from '../utils/experience-classification-convergence.util';
import { candidateSatisfiesEvidenceRequirement } from '../utils/acquisition-candidate-requirement.util';
import {
  CorroborationMergeResult,
  CorroborationReason,
  CorroborationGroupTrace,
} from './structured-candidate-corroboration.service';

function relevantDeficitsFor(
  sourcePlan: SourcePlan,
  deficits: AcquisitionDeficit[],
): AcquisitionDeficit[] {
  const payload = sourcePlan.provider === 'web' ? sourcePlan.web : undefined;
  const keys = new Set([
    ...(payload?.requestedThemes ?? []).map((key) => `theme:${key}`),
    ...(payload?.requestedIntents ?? []).map((key) => `intent:${key}`),
    ...(payload?.preferredTraits ?? []).map((key) => `trait:${key}`),
  ]);
  return deficits.filter(
    (deficit) =>
      deficit.origin === 'preference_facet' &&
      keys.has(`${deficit.dimension}:${deficit.key}`),
  );
}

function relevantAnchorsFor(
  sourcePlan: SourcePlan,
  anchors: NonNullable<ExperienceAcquisitionPlan['relevantAnchors']>,
) {
  const payloadNames =
    sourcePlan.provider === 'web'
      ? (sourcePlan.web.anchorNames ?? [])
      : sourcePlan.provider === 'wikivoyage'
        ? (sourcePlan.wikivoyage.articleTargets ?? [])
        : [];
  const names = new Set(payloadNames.map((name) => name.toLocaleLowerCase()));
  return anchors.filter((anchor) => {
    const name =
      anchor.status === 'resolved' ? anchor.canonicalName : anchor.rawName;
    return names.has(name.toLocaleLowerCase());
  });
}

export interface ResolverEvidenceItem {
  key: string;
  source: string;
  title?: string;
  snippet?: string;
  url?: string;
  kind?: ExperienceGroundingEvidenceKind;
  order?: number;
  contextHeading?: string;
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
  normalizationAudit?: GroundingNormalizationAudit;
  extractorProvider?: string;
  extractorModel?: string;
  groundedRawOutput?: string;
  extractorRawOutput?: string;
  validationErrors: string[];
  extractedCandidateCount: number;
  candidateCount: number;
  candidateDecisions: WebCandidateAdmissionDecision[];
  /**
   * Source-composition-authority audit per raw extracted candidate (see
   * `CandidateSourceSupportAudit`). Distinct from `candidateDecisions`:
   * those operate on canonical `ExperienceCandidate`s that already passed
   * the source-support gate and reached evidence-requirement admission. A
   * SOURCE_CONTRACT_VIOLATION candidate never becomes a canonical
   * `ExperienceCandidate` and so never appears in `candidateDecisions` --
   * it is only observable here.
   */
  sourceSupportAudits?: CandidateSourceSupportAudit[];
  failureReason?: string;
}

export interface WebCandidateAdmissionDecision {
  candidate: ExperienceCandidate;
  requestedRequirements: AcquisitionEvidenceRequirement[];
  candidateShapeMatches: AcquisitionEvidenceRequirement[];
  accepted: boolean;
  reason: 'MATCHING_EVIDENCE_REQUIREMENT' | 'NO_MATCHING_EVIDENCE_REQUIREMENT';
}

export interface StructuredPairDecisionSummary {
  total: number;
  byDecision: { SAME: number; NEW: number; AMBIGUOUS: number };
  byReason: Partial<Record<CorroborationReason, number>>;
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
  structuredAudit?: {
    proposalCount: number;
    groups: CorroborationGroupTrace[];
    rejectedOriginations: CorroborationMergeResult['rejectedOriginations'];
    pairDecisionSummary: StructuredPairDecisionSummary;
  };
  structuredCandidateCount?: number;
  webCandidateCount?: number;
  evidence?: ResolverEvidenceItem[];
  executionSkipped?: {
    reason: 'DUPLICATE_SOURCE_PLAN_EXECUTION';
    fingerprint: string;
  };
  executionSkippedSourcePlans?: Array<{
    provider: ExperienceAcquisitionProvider;
    fingerprint: string;
    reason: 'DUPLICATE_SOURCE_PLAN_EXECUTION';
  }>;
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
    ledger?: AcquisitionExecutionLedger,
  ): Promise<ExecuteAcquisitionPlanResult> {
    const skippedSourcePlans: NonNullable<
      ExecuteAcquisitionPlanResult['executionSkippedSourcePlans']
    > = [];
    const sourcePlans = plan.sourcePlans.filter((sourcePlan) => {
      const fingerprint = acquisitionSourcePlanFingerprint(sourcePlan, {
        destination: plan.destination,
        evidenceRequirements: plan.evidenceRequirements,
        relevantDeficits: relevantDeficitsFor(sourcePlan, plan.deficits),
        relevantAnchors: relevantAnchorsFor(
          sourcePlan,
          plan.relevantAnchors ?? [],
        ),
      });
      if (ledger?.executedSourcePlanFingerprints.has(fingerprint)) {
        skippedSourcePlans.push({
          provider: sourcePlan.provider,
          fingerprint,
          reason: 'DUPLICATE_SOURCE_PLAN_EXECUTION',
        });
        return false;
      }
      ledger?.executedSourcePlanFingerprints.add(fingerprint);
      return true;
    });
    if (sourcePlans.length === 0 && plan.sourcePlans.length > 0) {
      return {
        candidates: [],
        observations: [],
        providerResults: {},
        webResults: [],
        evidence: [],
        executionSkipped: {
          reason: 'DUPLICATE_SOURCE_PLAN_EXECUTION',
          fingerprint: acquisitionSourcePlanFingerprint(plan.sourcePlans[0], {
            destination: plan.destination,
            evidenceRequirements: plan.evidenceRequirements,
            relevantDeficits: relevantDeficitsFor(
              plan.sourcePlans[0],
              plan.deficits,
            ),
            relevantAnchors: relevantAnchorsFor(
              plan.sourcePlans[0],
              plan.relevantAnchors ?? [],
            ),
          }),
        },
        executionSkippedSourcePlans: skippedSourcePlans,
      };
    }
    const providerResults: Partial<
      Record<
        ExperienceAcquisitionProvider,
        AcquisitionProviderResult<SourceObservation>
      >
    > = {};
    const allObservations: SourceObservation[] = [];

    for (const sourcePlan of sourcePlans) {
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

    // Web SourcePlans: grounded evidence -> shared discovery extractor ->
    // ExperienceCandidates. Not a SourceObservation path; reported separately.
    // Each web plan is failure-isolated (mirrors the structured loop).
    const webResults: WebAcquisitionResult[] = [];
    const webCandidates: ExperienceCandidate[] = [];
    const webEvidence: ResolverEvidenceItem[] = [];
    for (const sourcePlan of sourcePlans) {
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
    let structuredAudit: ExecuteAcquisitionPlanResult['structuredAudit'];
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

      const pairDecisionSummary: StructuredPairDecisionSummary = {
        total: mergeResult.pairDecisions.length,
        byDecision: { SAME: 0, NEW: 0, AMBIGUOUS: 0 },
        byReason: {},
      };
      for (const pairDecision of mergeResult.pairDecisions) {
        pairDecisionSummary.byDecision[pairDecision.decision] += 1;
        for (const reason of pairDecision.reasons) {
          pairDecisionSummary.byReason[reason] =
            (pairDecisionSummary.byReason[reason] ?? 0) + 1;
        }
      }
      structuredAudit = {
        proposalCount: proposals.length,
        groups: mergeResult.groups,
        rejectedOriginations: mergeResult.rejectedOriginations,
        pairDecisionSummary,
      };
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
      structuredAudit,
      executionSkippedSourcePlans:
        skippedSourcePlans.length > 0 ? skippedSourcePlans : undefined,
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
        extractedCandidateCount: 0,
        candidateCount: 0,
        candidateDecisions: [],
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
        normalizationAudit: grounded.normalizationAudit,
        groundedRawOutput:
          grounded.rawOutput === undefined
            ? undefined
            : typeof grounded.rawOutput === 'string'
              ? grounded.rawOutput
              : JSON.stringify(grounded.rawOutput),
        validationErrors: [],
        extractedCandidateCount: 0,
        candidateCount: 0,
        candidateDecisions: [],
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
        evidenceRequirements: [...plan.evidenceRequirements],
      };

      const extracted = await this.discoveryExtractor.extractExperiences(
        request,
        grounded,
        { bypassCache: true },
      );

      const candidateDecisions: WebCandidateAdmissionDecision[] =
        extracted.candidates.map((candidate) => {
          const candidateShapeMatches = plan.evidenceRequirements.filter(
            (requirement) =>
              candidateSatisfiesEvidenceRequirement(candidate, requirement),
          );
          const accepted = candidateShapeMatches.length > 0;
          return {
            candidate,
            requestedRequirements: [...plan.evidenceRequirements],
            candidateShapeMatches,
            accepted,
            reason: accepted
              ? 'MATCHING_EVIDENCE_REQUIREMENT'
              : 'NO_MATCHING_EVIDENCE_REQUIREMENT',
          };
        });
      const admissibleCandidates = candidateDecisions
        .filter((decision) => decision.accepted)
        .map((decision) => decision.candidate);
      sink.webCandidates.push(...admissibleCandidates);
      for (const ev of grounded.evidence) {
        sink.webEvidence.push({
          key: ev.key,
          source: ev.source,
          title: ev.title,
          snippet: ev.snippet,
          url: ev.url,
          kind: ev.kind,
          order: ev.order,
          contextHeading: ev.contextHeading,
        });
      }

      return {
        ...base,
        extractorProvider: extracted.provider,
        extractorModel: extracted.model,
        extractorRawOutput: extracted.rawOutput,
        validationErrors: extracted.validationErrors ?? [],
        extractedCandidateCount: extracted.candidates.length,
        candidateCount: admissibleCandidates.length,
        candidateDecisions,
        sourceSupportAudits: extracted.sourceSupportAudits,
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
        extractedCandidateCount: 0,
        candidateCount: 0,
        candidateDecisions: [],
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
        observations: acquisition.observations,
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
      /** Task A6 — see ExperienceResolutionRequest.entityResolutionScope. */
      entityResolutionScope?: GeographicScope;
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
      observations: execution.observations,
      validationScope: context.validationScope,
      validationIntent: context.validationIntent,
      entityResolutionScope: context.entityResolutionScope,
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
