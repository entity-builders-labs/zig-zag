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
  ExperienceGroundingEvidence,
  GroundedSearchEvidenceRecord,
} from '../interfaces/experience-grounding.interface';
import {
  DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
  EXPERIENCE_WEB_SOURCE_CONTENT_PROVIDER,
  WebSourceContentProvider,
  WebSourceContentProviderName,
  WebSourceContentResultItem,
} from '../interfaces/web-source-content.interface';
import {
  SourceContentWindowingAudit,
  windowSourceContent,
} from '../utils/source-content-windowing.util';
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
  evidenceQuality?: 'original_content' | 'reduced';
}

/**
 * One source-content retrieval as recorded in the trace. For a retrieved
 * source, `content` is exactly the windowed text handed to extraction (never
 * a second full copy of the page) and `windowing` explains which source text
 * was kept and why; `contentChars` stays the transport's full length.
 */
export type WebSourceContentTraceItem = WebSourceContentResultItem & {
  windowing?: SourceContentWindowingAudit;
};

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
  /** The resolved destination country code the grounded request carried. */
  destinationCountryCode?: string;
  /** Locale parameters the grounded provider actually sent (e.g. gl). */
  groundedProviderLocale?: { gl?: string; hl?: string };
  evidenceKeys: string[];
  evidenceProvenance?: unknown;
  normalizationAudit?: GroundingNormalizationAudit;
  /**
   * Exact grounded search evidence snapshot supplied to extraction before any
   * downstream reasoning or deep-source fetch mutation.
   */
  groundedEvidence?: GroundedSearchEvidenceRecord[];
  extractorProvider?: string;
  extractorModel?: string;
  /**
   * The typed anchor names the discovery extractor request actually
   * carried (`ExperienceDiscoveryRequest.anchorNames`), for the Bitácora.
   */
  extractorRequestAnchorNames?: string[];
  groundedRawOutput?: string;
  extractorRawOutput?: string;
  validationErrors: string[];
  extractedCandidateCount?: number;
  candidateCount: number;
  candidateDecisions?: WebCandidateAdmissionDecision[];
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
  /**
   * Deep source selection audit for Generation Trace v5 / Bitácora.
   * Records the production decision to select URLs from grounded evidence
   * for source content retrieval when a composition gap exists.
   */
  deepSourceSelection?: WebDeepSourceSelectionAudit;
  sourceContentRetrieval?: {
    attempted: boolean;
    provider?: WebSourceContentProviderName;
    triggerReason?: string;
    requestedUrls: string[];
    retrievedUrls: string[];
    failedUrls: string[];
    items: WebSourceContentTraceItem[];
    totalDurationMs?: number;
    reExtractionAttempted?: boolean;
    selectionAudit?: WebDeepSourceSelectionAudit;
  };
  /**
   * Every discovery-extraction attempt this web plan ran, in execution order
   * (snippet-only first, then deep-source re-extraction when triggered). The
   * flat `extractor*` / `candidateDecisions` fields above describe only the
   * FINAL attempt; this list keeps earlier attempts from being overwritten.
   * Diagnostic only -- no decision reads it.
   */
  extractionAttempts: WebExtractionAttemptAudit[];
  /**
   * The acquisition stage whose error ended this web plan. Set whenever
   * `status === 'failed'`, so a failure after a successful search (e.g. an
   * extractor timeout) is never attributed to the search. `failureReason`
   * keeps the raw error message. Diagnostic only.
   */
  failedStage?: WebAcquisitionStage;
  failureReason?: string;
}

/** Provider-neutral stages of one web SourcePlan execution, in order. */
export type WebAcquisitionStage =
  | 'SEARCH'
  | 'SOURCE_SELECTION'
  | 'SOURCE_FETCH'
  | 'EXTRACTION';

/**
 * What evidence one extraction attempt consumed: the grounded search
 * snippets as returned, or those same items with deep-retrieved source
 * content substituted for the selected URLs.
 */
export type WebExtractionInputKind =
  | 'grounded_snippets'
  | 'deep_source_content';

export interface WebExtractionAttemptAudit {
  inputKind: WebExtractionInputKind;
  status: 'completed' | 'failed';
  /** Absent when the call failed before the extractor reported identity. */
  extractorProvider?: string;
  extractorModel?: string;
  rawOutput?: string;
  validationErrors: string[];
  extractedCandidateCount: number;
  admittedCandidateCount: number;
  candidateDecisions: WebCandidateAdmissionDecision[];
  sourceSupportAudits?: CandidateSourceSupportAudit[];
  /** Raw error message when `status === 'failed'`. */
  failureReason?: string;
}

export type WebDeepSourceDecisionReason =
  | 'SELECTED'
  | 'INVALID_OR_NON_HTTP_URL'
  | 'NON_EDITORIAL_SOURCE'
  | 'DUPLICATE_URL'
  | 'BELOW_SELECTION_LIMIT';

export interface WebDeepSourceItemAudit {
  evidenceKey: string;
  title?: string;
  url?: string;
  /**
   * The grounded search snippet as the selector saw it (before any deep
   * content substitution), so a forensic review can judge whether a dropped
   * source already hinted at the missing evidence. Diagnostic only.
   */
  snippet?: string;
  originalRank: number;
  editorialEligible: boolean;
  tourContentScore: number;
  citedCandidateBonus: number;
  finalScore: number;
  rankedPosition?: number;
  selected: boolean;
  decisionReason: WebDeepSourceDecisionReason;
}

export interface WebDeepSourceSelectionAudit {
  evidenceCount: number;
  anchorNames?: string[];
  selectionLimit: number;
  selectedUrls: string[];
  items: WebDeepSourceItemAudit[];
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

const NON_EDITORIAL_DOMAINS: readonly string[] = [
  'getyourguide.',
  'viator.',
  'tripadvisor.',
  'booking.',
  'expedia.',
  'civitatis.',
  'klook.',
  'airbnb.',
  'gpsmycity.com',
  'youtube.com',
  'facebook.com',
  'instagram.com',
];

function isEditorialTourUrl(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return !NON_EDITORIAL_DOMAINS.some((d) => host.includes(d));
  } catch {
    return false;
  }
}

function scoreUrlForTourContent(
  urlStr: string,
  anchorNames?: readonly string[],
): number {
  try {
    const parsed = new URL(urlStr);
    const path = parsed.pathname.toLowerCase();
    let score = 0;
    if (path.length > 1 && path !== '/') score += 5;
    if (/tour|walk|itinerary|recorrido|paseo/i.test(path)) score += 10;
    if (/center|centro|assistance|contact|about|faq/i.test(path)) score -= 10;
    if (anchorNames) {
      for (const anchor of anchorNames) {
        const slug = anchor.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (slug && path.includes(slug)) {
          score += 8;
        }
      }
    }
    return score;
  } catch {
    return 0;
  }
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
    @Optional()
    @Inject(EXPERIENCE_WEB_SOURCE_CONTENT_PROVIDER)
    private readonly webSourceContentProvider?: WebSourceContentProvider,
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
          // `sourcePlan.provider === 'google_places'` names the Places
          // CAPABILITY that was routed, not necessarily the Google backend
          // (the configured `IPlacesApiService` may be Google or Geoapify) —
          // this message and failureReason must stay provider-neutral.
          this.logger.warn(
            `Places acquisition threw: ${error?.message ?? String(error)}`,
          );
          providerResults.google_places = {
            status: 'failed',
            value: [],
            failureReason: error?.message ?? 'Places acquisition failed',
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
        extractionAttempts: [],
        failureReason: 'web discovery providers not configured',
      };
    }
    const discoveryExtractor = this.discoveryExtractor;

    // Diagnostic state that must survive a throw from any later stage, so the
    // failure is attributed to the stage that actually failed and earlier
    // evidence (search facts, selection audit, prior extraction attempts) is
    // not discarded.
    let stage: WebAcquisitionStage = 'SEARCH';
    let base: WebAcquisitionResult | undefined;
    const extractionAttempts: WebExtractionAttemptAudit[] = [];
    let deepSourceSelectionTrace: WebDeepSourceSelectionAudit | undefined;
    let sourceContentRetrievalTrace: WebAcquisitionResult['sourceContentRetrieval'];

    try {
      const destinationCountryCode = plan.destination.destinationCountryCode;
      const grounded = await this.groundedSearchProvider.search({
        destinationName: plan.destination.destinationName ?? '',
        ...(destinationCountryCode ? { destinationCountryCode } : {}),
        requestedThemes: web.requestedThemes ?? [],
        requestedIntents: web.requestedIntents,
        additionalPreferences: web.semanticQuery,
        query: web.query,
        anchorNames: web.anchorNames,
      });

      // RW3-F2: a grounded provider that reports failure or unavailability
      // is a FAILED source. It must never surface as a silent success with
      // zero evidence -- the typed failure provenance (groundingStatus +
      // failureReason + provider identity) propagates to the trace and the
      // execution summary.
      const groundedFailed =
        grounded.groundingStatus === 'failed' ||
        grounded.groundingStatus === 'unavailable';

      const rawEvidence = grounded.evidence ?? [];
      const groundedEvidence: GroundedSearchEvidenceRecord[] = rawEvidence.map(
        (ev, index) => ({
          key: ev.key,
          order: typeof ev.order === 'number' ? ev.order : index + 1,
          snippet: ev.snippet,
          source: ev.source,
          ...(ev.title ? { title: ev.title } : {}),
          ...(ev.url ? { url: ev.url } : {}),
          ...(ev.kind ? { kind: ev.kind } : {}),
          ...(ev.contextHeading ? { contextHeading: ev.contextHeading } : {}),
          ...(ev.evidenceQuality
            ? { evidenceQuality: ev.evidenceQuality }
            : {}),
        }),
      );

      base = {
        status: groundedFailed ? 'failed' : 'success',
        query: web.query,
        groundedProvider: grounded.provider,
        groundedModel: grounded.model,
        groundingStatus: grounded.groundingStatus,
        ...(destinationCountryCode ? { destinationCountryCode } : {}),
        ...(grounded.providerLocale
          ? { groundedProviderLocale: grounded.providerLocale }
          : {}),
        evidenceKeys: rawEvidence.map((e) => e.key),
        evidenceProvenance: grounded.evidenceProvenance,
        normalizationAudit: grounded.normalizationAudit,
        groundedEvidence,
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
        extractionAttempts,
      };

      if (
        groundedFailed ||
        !grounded.evidence ||
        grounded.evidence.length === 0
      ) {
        return {
          ...base,
          ...(groundedFailed ? { failedStage: 'SEARCH' as const } : {}),
          ...(grounded.failureReason
            ? { failureReason: grounded.failureReason }
            : {}),
        };
      }

      const request: ExperienceDiscoveryRequest = {
        scope: { destinationName: plan.destination.destinationName },
        requestedThemes: web.requestedThemes ?? [],
        requestedIntents: web.requestedIntents,
        preferredTraits: web.preferredTraits,
        semanticQuery: web.semanticQuery,
        ...(web.anchorNames?.length
          ? { anchorNames: [...web.anchorNames] }
          : {}),
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

      const decideAdmission = (
        candidates: ExperienceCandidate[],
      ): WebCandidateAdmissionDecision[] =>
        candidates.map((candidate) => {
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

      // Runs one extraction over the current `grounded` evidence and appends
      // its audit (completed or failed) before returning or rethrowing, so a
      // later attempt can never overwrite an earlier one's evidence.
      const runExtraction = async (inputKind: WebExtractionInputKind) => {
        stage = 'EXTRACTION';
        try {
          const result = await discoveryExtractor.extractExperiences(
            request,
            grounded,
            { bypassCache: true },
          );
          const decisions = decideAdmission(result.candidates);
          extractionAttempts.push({
            inputKind,
            status: 'completed',
            extractorProvider: result.provider,
            extractorModel: result.model,
            rawOutput: result.rawOutput,
            validationErrors: result.validationErrors ?? [],
            extractedCandidateCount: result.candidates.length,
            admittedCandidateCount: decisions.filter((d) => d.accepted).length,
            candidateDecisions: decisions,
            sourceSupportAudits: result.sourceSupportAudits,
          });
          return { extracted: result, decisions };
        } catch (error: any) {
          extractionAttempts.push({
            inputKind,
            status: 'failed',
            validationErrors: [],
            extractedCandidateCount: 0,
            admittedCandidateCount: 0,
            candidateDecisions: [],
            failureReason: error?.message ?? String(error),
          });
          throw error;
        }
      };

      const initial = await runExtraction('grounded_snippets');
      let extracted = initial.extracted;
      let candidateDecisions = initial.decisions;
      let admissibleCandidates = candidateDecisions
        .filter((decision) => decision.accepted)
        .map((decision) => decision.candidate);

      const isMultiComponentRequested = plan.evidenceRequirements.includes(
        'MULTI_COMPONENT_EXPERIENCE',
      );
      const satisfiesMultiComponent = admissibleCandidates.some((c) =>
        candidateSatisfiesEvidenceRequirement(c, 'MULTI_COMPONENT_EXPERIENCE'),
      );
      // Only an extraction-level failure (the extractor response as a whole
      // was unusable) keeps deep retrieval fail-closed. Candidate-level
      // invalidity never does: a candidate rejected for naming no stops is
      // exactly the case where the snippet was too thin and the full source
      // may name them.
      const extractionFailed = extracted.extractionFailures.length > 0;

      // Condition 1: Grounded search returned usable evidence (verified above)
      // Condition 2: Active requirement is MULTI_COMPONENT_EXPERIENCE, not yet satisfied by admitted candidates,
      //              and the extraction itself did not fail.
      // Condition 3: webSourceContentProvider is registered and configured.
      const hasCompositionGap =
        isMultiComponentRequested &&
        !satisfiesMultiComponent &&
        !extractionFailed &&
        Boolean(this.webSourceContentProvider);

      if (hasCompositionGap && this.webSourceContentProvider) {
        stage = 'SOURCE_SELECTION';
        const rejectedWalkCandidate = candidateDecisions.find(
          (d) =>
            !d.accepted &&
            d.reason === 'NO_MATCHING_EVIDENCE_REQUIREMENT' &&
            d.candidate.evidenceKeys?.length > 0,
        );

        const candidateCitedKeys = new Set(
          rejectedWalkCandidate?.candidate.evidenceKeys ?? [],
        );

        const rawEvidence = grounded.evidence ?? [];
        const selectionLimit = 2;

        interface ScoredEligibleEvidence {
          ev: ExperienceGroundingEvidence;
          originalIndex: number;
          originalRank: number;
          tourContentScore: number;
          citedCandidateBonus: number;
          finalScore: number;
        }

        const eligibleItems: ScoredEligibleEvidence[] = [];
        const itemAuditsByIndex: WebDeepSourceItemAudit[] = new Array(
          rawEvidence.length,
        );

        rawEvidence.forEach((ev, index) => {
          const originalRank =
            typeof ev.order === 'number' ? ev.order : index + 1;
          const hasValidUrl = Boolean(ev.url && /^https?:\/\//i.test(ev.url));
          const isEditorial = hasValidUrl && isEditorialTourUrl(ev.url!);
          const tourContentScore = ev.url
            ? scoreUrlForTourContent(ev.url, web.anchorNames)
            : 0;
          const citedCandidateBonus = candidateCitedKeys.has(ev.key) ? 1 : 0;
          const finalScore = tourContentScore + citedCandidateBonus;

          if (!hasValidUrl) {
            itemAuditsByIndex[index] = {
              evidenceKey: ev.key,
              title: ev.title,
              url: ev.url,
              snippet: ev.snippet,
              originalRank,
              editorialEligible: false,
              tourContentScore,
              citedCandidateBonus,
              finalScore,
              selected: false,
              decisionReason: 'INVALID_OR_NON_HTTP_URL',
            };
          } else if (!isEditorial) {
            itemAuditsByIndex[index] = {
              evidenceKey: ev.key,
              title: ev.title,
              url: ev.url,
              snippet: ev.snippet,
              originalRank,
              editorialEligible: false,
              tourContentScore,
              citedCandidateBonus,
              finalScore,
              selected: false,
              decisionReason: 'NON_EDITORIAL_SOURCE',
            };
          } else {
            eligibleItems.push({
              ev,
              originalIndex: index,
              originalRank,
              tourContentScore,
              citedCandidateBonus,
              finalScore,
            });
          }
        });

        eligibleItems.sort((a, b) => b.finalScore - a.finalScore);

        const targetUrls: string[] = [];
        const seenUrls = new Set<string>();

        eligibleItems.forEach((item, rankedIndex) => {
          const rankedPosition = rankedIndex + 1;
          const url = item.ev.url!;
          let selected = false;
          let decisionReason: WebDeepSourceDecisionReason;

          if (seenUrls.has(url)) {
            decisionReason = 'DUPLICATE_URL';
          } else {
            seenUrls.add(url);
            if (targetUrls.length < selectionLimit) {
              selected = true;
              decisionReason = 'SELECTED';
              targetUrls.push(url);
            } else {
              decisionReason = 'BELOW_SELECTION_LIMIT';
            }
          }

          itemAuditsByIndex[item.originalIndex] = {
            evidenceKey: item.ev.key,
            title: item.ev.title,
            url: item.ev.url,
            snippet: item.ev.snippet,
            originalRank: item.originalRank,
            editorialEligible: true,
            tourContentScore: item.tourContentScore,
            citedCandidateBonus: item.citedCandidateBonus,
            finalScore: item.finalScore,
            rankedPosition,
            selected,
            decisionReason,
          };
        });

        deepSourceSelectionTrace = {
          evidenceCount: rawEvidence.length,
          ...(web.anchorNames?.length
            ? { anchorNames: [...web.anchorNames] }
            : {}),
          selectionLimit,
          selectedUrls: [...targetUrls],
          items: itemAuditsByIndex,
        };

        if (targetUrls.length > 0) {
          const triggerReason = rejectedWalkCandidate
            ? `MULTI_COMPONENT_EXPERIENCE candidate rejected for lack of required stops (${rejectedWalkCandidate.candidate.componentHints.length} component hints)`
            : 'MULTI_COMPONENT_EXPERIENCE required but initial extraction produced no admissible multi-component candidate';

          stage = 'SOURCE_FETCH';
          const retrievalResult = await this.webSourceContentProvider.retrieve({
            urls: targetUrls,
          });

          // The single canonical windowing policy: each source's complete
          // text is reduced to its most relevant excerpts under the fixed
          // evidence budget, ranked against context already known for that
          // exact source (its grounded titles/snippets) and this request.
          const queries = [web.query, web.semanticQuery].filter(
            (q): q is string => Boolean(q),
          );
          const traceItems: WebSourceContentTraceItem[] =
            retrievalResult.items.map((item) => {
              if (item.status !== 'retrieved' || !item.content) return item;
              const sameSource = grounded.evidence.filter(
                (e) => e.url === item.requestedUrl,
              );
              const window = windowSourceContent(
                item.content,
                {
                  titles: sameSource
                    .map((e) => e.title)
                    .filter((t): t is string => Boolean(t)),
                  snippets: sameSource
                    .map((e) => e.snippet)
                    .filter((t): t is string => Boolean(t)),
                  queries,
                },
                DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
              );
              return {
                ...item,
                content: window.content,
                windowing: window.audit,
              };
            });
          const retrievedItems = traceItems.filter(
            (item) => item.status === 'retrieved' && item.content,
          );

          sourceContentRetrievalTrace = {
            attempted: true,
            provider: this.webSourceContentProvider.providerName,
            triggerReason,
            requestedUrls: targetUrls,
            retrievedUrls: retrievedItems.map((i) => i.requestedUrl),
            failedUrls: retrievalResult.items
              .filter((i) => i.status === 'failed')
              .map((i) => i.requestedUrl),
            items: traceItems,
            totalDurationMs: retrievalResult.totalDurationMs,
            reExtractionAttempted: false,
            selectionAudit: deepSourceSelectionTrace,
          };

          if (retrievedItems.length > 0) {
            sourceContentRetrievalTrace.reExtractionAttempted = true;

            const contentByUrl = new Map<string, string>();
            for (const item of retrievedItems) {
              contentByUrl.set(item.requestedUrl, item.content!);
            }

            // Update grounded.evidence in place, preserving URL identity and source
            grounded.evidence = grounded.evidence.map((item) => {
              if (item.url && contentByUrl.has(item.url)) {
                return {
                  ...item,
                  snippet: contentByUrl.get(item.url)!,
                  evidenceQuality: 'original_content' as const,
                };
              }
              return item;
            });

            // Re-run semantic extraction with enriched grounded evidence
            const deep = await runExtraction('deep_source_content');
            extracted = deep.extracted;
            candidateDecisions = deep.decisions;
            admissibleCandidates = candidateDecisions
              .filter((decision) => decision.accepted)
              .map((decision) => decision.candidate);
          }
        }
      }

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
          evidenceQuality: ev.evidenceQuality,
        });
      }

      return {
        ...base,
        extractorProvider: extracted.provider,
        extractorModel: extracted.model,
        ...(request.anchorNames
          ? { extractorRequestAnchorNames: request.anchorNames }
          : {}),
        extractorRawOutput: extracted.rawOutput,
        validationErrors: extracted.validationErrors ?? [],
        extractedCandidateCount: extracted.candidates.length,
        candidateCount: admissibleCandidates.length,
        candidateDecisions,
        sourceSupportAudits: extracted.sourceSupportAudits,
        deepSourceSelection: deepSourceSelectionTrace,
        sourceContentRetrieval: sourceContentRetrievalTrace,
      };
    } catch (error: any) {
      const failureReason = error?.message ?? 'Web acquisition failed';
      this.logger.warn(
        `Web acquisition threw during ${stage}: ${error?.message ?? String(error)}`,
      );
      // Keep the facts established before the failing stage. The grounded
      // provider identity is deliberately NOT carried: acquisition health
      // accounting keys a failed web result by `groundedProvider`, and a
      // post-search failure (e.g. an extractor timeout) must not be counted
      // as that search provider failing. `failedStage` names what failed.
      const searchFacts: WebAcquisitionResult = {
        ...(base ?? {
          status: 'failed',
          query: web.query,
          evidenceKeys: [],
          groundedEvidence: [],
          validationErrors: [],
          extractedCandidateCount: 0,
          candidateCount: 0,
          candidateDecisions: [],
          extractionAttempts,
        }),
      };
      delete searchFacts.groundedProvider;
      delete searchFacts.groundedModel;
      return {
        ...searchFacts,
        status: 'failed',
        extractionAttempts,
        ...(deepSourceSelectionTrace
          ? { deepSourceSelection: deepSourceSelectionTrace }
          : {}),
        ...(sourceContentRetrievalTrace
          ? { sourceContentRetrieval: sourceContentRetrievalTrace }
          : {}),
        failedStage: stage,
        failureReason,
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
