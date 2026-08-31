import { Injectable, Inject, Logger } from '@nestjs/common';
import { ActivityKind } from '@prisma/client';
import {
  ActivityProposal,
  DiscoveryRequest,
  DiscoveryResponse,
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
  GroundedSearchProvider,
  GroundedSearchRequest,
  GroundedSearchResult,
  GroundingEvidence,
  SearchGroundedDiscoveryProvider,
  DiscoveryMode,
  EntityHint,
  DiscoverySearchTrace,
  GroundingStatus,
} from '../interfaces/activity-discovery.interface';
import { CoverageDeficit } from '../interfaces/coverage-analysis.interface';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from '../utils/experience-format-kind.util';
import {
  ExperienceFormat,
  ExplorationStyle,
} from '../interfaces/tour-generation.interface';
import {
  SemanticDiscoveryQueryBuilder,
  SemanticDiscoveryQueryPlan,
} from '../utils/semantic-discovery-query-builder.util';
import { extractRouteHints } from '../utils/route-evidence-extraction.util';

const EVIDENCE_BUDGET = 30;
const MAX_PROPOSALS_PER_KIND = 4;

interface SearchOutcome {
  plan?: SemanticDiscoveryQueryPlan;
  request: GroundedSearchRequest;
  result: GroundedSearchResult;
}

@Injectable()
export class ActivityDiscoveryService {
  private readonly logger = new Logger(ActivityDiscoveryService.name);
  private readonly queryBuilder = new SemanticDiscoveryQueryBuilder();

  constructor(
    @Inject(GROUNDED_SEARCH_PROVIDER)
    private readonly searchProvider: GroundedSearchProvider,
    @Inject(DISCOVERY_PROVIDER)
    private readonly provider: SearchGroundedDiscoveryProvider,
  ) {}

  async discoverGaps(
    destinationName: string,
    destinationCountry: string | undefined,
    requestedThemes: string[],
    deficits: CoverageDeficit[],
    requestedExperienceFormats?: string[],
    explorationStyle?: string,
    additionalPreferences?: string,
  ): Promise<DiscoveryResponse> {
    const mode: DiscoveryMode = { type: 'gap_fill', deficits };
    const request: DiscoveryRequest = {
      destinationName,
      destinationCountry,
      requestedThemes,
      requestedExperienceFormats,
      explorationStyle,
      additionalPreferences,
      mode,
      maxProposals: 8,
    };

    this.logger.debug(
      `Discovery request: ${destinationName}, mode=gap_fill, themes=${requestedThemes.join(',')}`,
    );

    const missingKinds = this.deriveMissingKinds(deficits);
    if (missingKinds.length === 0) {
      return this.discover(request);
    }

    // A missing structural format is an acquisition obligation. Search was
    // already per-kind, but extraction used to merge every kind's evidence
    // into one LLM call. That allowed a broad theme (for example history) to
    // dominate the extraction and return only POIs even when ROUTE and
    // EXPERIENCE were explicit blocking gaps. Keep both search AND extraction
    // isolated per missing kind, then merge only validated same-kind proposals.
    const plans = missingKinds.map((missingKind) =>
      this.queryBuilder.build({
        destinationName,
        destinationCountry,
        missingKind,
        themes: requestedThemes,
        explorationStyle: explorationStyle as ExplorationStyle | undefined,
        additionalPreferences,
      }),
    );

    const outcomes = await Promise.all(
      plans.map(async (plan): Promise<SearchOutcome> => {
        const searchRequest: GroundedSearchRequest = {
          destinationName,
          destinationCountry,
          requestedThemes,
          requestedExperienceFormats,
          explorationStyle,
          additionalPreferences,
          query: plan.query,
          targetKind: plan.kind,
        };
        try {
          return {
            plan,
            request: searchRequest,
            result: await this.searchProvider.search(searchRequest),
          };
        } catch (error: any) {
          return {
            plan,
            request: searchRequest,
            result: {
              provider: 'grounded-search',
              model: 'unknown',
              groundingStatus: 'failed',
              evidence: [],
              failureReason: error?.message ?? 'search_failed',
            },
          };
        }
      }),
    );

    const searchTrace = this.toSearchTrace(outcomes);
    const proposals: ActivityProposal[] = [];
    const validationErrors: string[] = [];
    const groundingEvidence: GroundingEvidence[] = [];
    let extractionProvider: string | undefined;
    let extractionModel: string | undefined;
    let groundingProvider: string | undefined;
    let groundingModel: string | undefined;
    let anyApplied = false;

    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index];
      const targetKind = outcome.plan!.kind;
      const prepared = this.prepareSearchResult(outcome, index);
      groundingEvidence.push(...prepared.evidence);

      if (
        prepared.groundingStatus !== 'applied' ||
        prepared.evidence.length === 0
      ) {
        validationErrors.push(
          `${targetKind}: grounded search ${prepared.groundingStatus}${prepared.failureReason ? ` (${prepared.failureReason})` : ''}`,
        );
        continue;
      }

      anyApplied = true;
      groundingProvider ??= prepared.provider;
      groundingModel ??= prepared.model;

      const kindDeficits = deficits.filter(
        (deficit) =>
          deficit.reason === 'missing_requested_experience_format' &&
          deficit.experienceFormat &&
          EXPERIENCE_FORMAT_ACTIVITY_KIND[
            deficit.experienceFormat as ExperienceFormat
          ] === targetKind,
      );
      const kindFormats = (requestedExperienceFormats ?? []).filter(
        (format) =>
          EXPERIENCE_FORMAT_ACTIVITY_KIND[format as ExperienceFormat] ===
          targetKind,
      );
      const extractionRequest: DiscoveryRequest = {
        destinationName,
        destinationCountry,
        requestedThemes,
        requestedExperienceFormats:
          kindFormats.length > 0 ? kindFormats : requestedExperienceFormats,
        explorationStyle,
        additionalPreferences,
        targetKind,
        mode: {
          type: 'gap_fill',
          deficits: kindDeficits.length > 0 ? kindDeficits : deficits,
        },
        maxProposals: Math.min(
          MAX_PROPOSALS_PER_KIND,
          Math.max(1, Math.floor(request.maxProposals / plans.length)),
        ),
      };

      let response: DiscoveryResponse;
      try {
        response = await this.provider.discover(extractionRequest, prepared);
      } catch (error: any) {
        validationErrors.push(
          `${targetKind}: extraction failed (${error?.message ?? 'unknown_error'})`,
        );
        continue;
      }

      extractionProvider ??= response.provider;
      extractionModel ??= response.model;
      if (response.validationErrors?.length) {
        validationErrors.push(
          ...response.validationErrors.map((error) => `${targetKind}: ${error}`),
        );
      }

      for (const proposal of response.proposals) {
        if (proposal.kind !== targetKind) {
          validationErrors.push(
            `${targetKind}: discarded proposal "${proposal.name}" with mismatched kind ${proposal.kind}`,
          );
          continue;
        }
        proposals.push(proposal);
      }
    }

    const dedupedProposals = this.dedupeProposals(proposals).slice(
      0,
      request.maxProposals,
    );
    const dedupedEvidence = this.dedupeEvidence(groundingEvidence).slice(
      0,
      EVIDENCE_BUDGET,
    );
    const groundingStatus: GroundingStatus = anyApplied
      ? 'applied'
      : this.aggregateFailureStatus(outcomes.map((outcome) => outcome.result));

    this.logger.debug(
      `Discovery response: ${dedupedProposals.length} valid proposals across ${plans.length} missing kind(s)`,
    );

    return {
      proposals: dedupedProposals,
      provider: extractionProvider ?? 'none',
      model: extractionModel ?? 'none',
      groundingStatus,
      groundingProvider,
      groundingModel,
      groundingEvidence: dedupedEvidence,
      validationErrors:
        validationErrors.length > 0 ? validationErrors : undefined,
      searchTrace,
    };
  }

  async discoverBootstrap(
    destinationName: string,
    destinationCountry: string | undefined,
    requestedThemes: string[],
  ): Promise<DiscoveryResponse> {
    const mode: DiscoveryMode = {
      type: 'bootstrap',
      reason: 'new_destination',
    };

    return this.discover({
      destinationName,
      destinationCountry,
      requestedThemes,
      mode,
      maxProposals: 8,
    });
  }

  private async discover(
    request: DiscoveryRequest,
  ): Promise<DiscoveryResponse> {
    this.logger.debug(
      `Discovery request: ${request.destinationName}, mode=${request.mode.type}, themes=${request.requestedThemes.join(',')}`,
    );

    const searchRequest = this.toSearchRequest(request);
    let searchResult: GroundedSearchResult;
    try {
      searchResult = await this.searchProvider.search(searchRequest);
    } catch (error: any) {
      searchResult = {
        provider: 'grounded-search',
        model: 'unknown',
        groundingStatus: 'failed',
        evidence: [],
        failureReason: error?.message ?? 'search_failed',
      };
    }
    const searchTrace = this.toSearchTrace([
      { request: searchRequest, result: searchResult },
    ]);

    if (searchResult.groundingStatus !== 'applied') {
      this.logger.warn(
        `Grounded search ${searchResult.groundingStatus} for ${request.destinationName}: ${searchResult.failureReason ?? 'no usable evidence'}`,
      );
      return {
        proposals: [],
        provider: 'none',
        model: 'none',
        groundingStatus: searchResult.groundingStatus,
        groundingProvider: searchResult.provider,
        groundingModel: searchResult.model,
        groundingEvidence: [],
        validationErrors: [
          `Grounded search ${searchResult.groundingStatus}${searchResult.failureReason ? `: ${searchResult.failureReason}` : ''}`,
        ],
        searchTrace,
      };
    }

    const response = await this.provider.discover(request, searchResult);

    this.logger.debug(
      `Discovery response: ${response.proposals.length} valid proposals from ${response.provider}`,
    );

    return { ...response, searchTrace };
  }

  private toSearchRequest(request: DiscoveryRequest): GroundedSearchRequest {
    return {
      destinationName: request.destinationName,
      destinationCountry: request.destinationCountry,
      requestedThemes: request.requestedThemes,
      requestedExperienceFormats: request.requestedExperienceFormats,
      explorationStyle: request.explorationStyle,
      additionalPreferences: request.additionalPreferences,
      query: '',
      targetKind: request.targetKind,
    };
  }

  private toSearchTrace(outcomes: SearchOutcome[]): DiscoverySearchTrace[] {
    return outcomes.map(({ request, result }) => ({
      query: request.query,
      targetKind: request.targetKind,
      provider: result.provider,
      model: result.model,
      groundingStatus: result.groundingStatus,
      evidenceCount: result.evidence?.length ?? 0,
      failureReason: result.failureReason,
    }));
  }

  private deriveMissingKinds(deficits: CoverageDeficit[]): ActivityKind[] {
    const kinds = new Set<ActivityKind>();
    for (const deficit of deficits) {
      if (deficit.reason !== 'missing_requested_experience_format') continue;
      const kind = deficit.experienceFormat
        ? EXPERIENCE_FORMAT_ACTIVITY_KIND[
            deficit.experienceFormat as ExperienceFormat
          ]
        : undefined;
      if (kind) kinds.add(kind);
    }
    return [...kinds];
  }

  private prepareSearchResult(
    outcome: SearchOutcome,
    index: number,
  ): GroundedSearchResult {
    let evidence = outcome.result.evidence ?? [];

    if (outcome.plan?.kind === ActivityKind.ROUTE) {
      const routeHints = extractRouteHints({
        evidence,
        textBlocks: outcome.result.textBlocks,
      });
      evidence = [...evidence, ...this.routeHintsToEvidence(routeHints)];
    }

    return {
      ...outcome.result,
      evidence: evidence.map((item) => ({
        ...item,
        key: `c${index}-${item.key}`,
      })),
    };
  }

  private dedupeProposals(proposals: ActivityProposal[]): ActivityProposal[] {
    const seen = new Set<string>();
    const result: ActivityProposal[] = [];
    for (const proposal of proposals) {
      const key = `${proposal.kind}|${proposal.name.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(proposal);
    }
    return result;
  }

  private dedupeEvidence(evidence: GroundingEvidence[]): GroundingEvidence[] {
    const seen = new Set<string>();
    const result: GroundingEvidence[] = [];
    for (const item of evidence) {
      const fingerprint = this.evidenceFingerprint(item);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      result.push(item);
    }
    return result;
  }

  private evidenceFingerprint(item: GroundingEvidence): string {
    return `${item.snippet.trim().toLowerCase()}|${item.url ?? ''}`;
  }

  private aggregateFailureStatus(results: GroundedSearchResult[]): GroundingStatus {
    if (results.some((result) => result.groundingStatus === 'failed')) {
      return 'failed';
    }
    if (results.some((result) => result.groundingStatus === 'unavailable')) {
      return 'unavailable';
    }
    return 'no_usable_evidence';
  }

  private routeHintsToEvidence(hints: EntityHint[]): GroundingEvidence[] {
    return hints.map((hint, index) => ({
      key: `route-${index + 1}`,
      source: 'route_evidence_extraction',
      snippet: `Candidate real ${hint.expectedType} name identified in evidence: "${hint.name}".`,
    }));
  }
}
