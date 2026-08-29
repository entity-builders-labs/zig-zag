import { Inject, Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityKind, VariantTheme } from '@prisma/client';
import { LangChainService } from '@shared/ai/langchain.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  IWikidataApiService,
  WikidataEnrichmentOutcome,
} from '@integrations/wikidata/interfaces/wikidata.interface';
import { assessWikidataExtractSafety } from '@integrations/wikidata/utils/wikidata-content-safety.util';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import {
  CREATE_TOUR_SELECTION_JSON_SYSTEM_PROMPT,
  CREATE_TOUR_SELECTION_RESPONSE_SCHEMA,
  CREATE_COMPOSITE_PROPOSAL_JSON_SYSTEM_PROMPT,
  CREATE_COMPOSITE_PROPOSAL_RESPONSE_SCHEMA,
  CREATE_TOUR_SYSTEM_PROMPT,
  GROQ_TOUR_MAX_COMPLETION_TOKENS,
  createCompositeProposalJsonUserPrompt,
  createTourJsonUserPrompt,
} from '../prompts/create-tour.prompt';
import { extractAndCleanJson, repairJson } from '../utils/json-parser.util';
import {
  RawCompositeActivity,
  verifyAndDedupeCompositeActivities,
} from '../utils/composite-activity-verification.util';

export interface TourSelectionChainInvokeInput {
  input: string;
  activities: string;
}

export interface CompositeProposalChainInvokeInput
  extends TourSelectionChainInvokeInput {
  osmFeatures?: string;
  area?: string;
  themes?: string;
}

export interface TourSelectionChain {
  invoke(input: TourSelectionChainInvokeInput): Promise<any>;
}

export interface CompositeProposalChain {
  invoke(input: CompositeProposalChainInvokeInput): Promise<any>;
}

export interface PersistedComposite {
  variant: Activity;
  themeReasoning?: string;
  dayNumber?: number;
  startTime?: string;
}

export interface VerifyAndPersistCompositesParams {
  rawComposites: RawCompositeActivity[];
  candidateActivityIds: Set<string>;
  candidateOsmFeaturesById: Map<string, OsmCandidate>;
  areaCandidate: OsmCandidate | null;
  /** Multiple real neighborhood areas offered during whole-city generation. */
  areaCandidatesById?: Map<string, OsmCandidate>;
  /** Real containment scope for every waypoint candidate offered to the LLM. */
  candidateAreaIdsByWaypointId?: Map<string, Set<string>>;
  /** Used only in log lines, e.g. `tour ${tourId}` or `template ${name}/${theme}`. */
  logContext: string;
  /**
   * When true, an already-existing variant (same familyId+variantTheme) has
   * its ActivityWaypoint content replaced instead of being left untouched —
   * the explicit curation path (`generate-templates --update-existing`),
   * never the default for live tour generation.
   */
  forceUpdateWaypoints?: boolean;
}

export interface VerifyAndPersistCompositesResult {
  persisted: PersistedComposite[];
  hallucinatedWaypointCount: number;
  invalidCompositeCount: number;
  outOfAreaWaypointCount: number;
}

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

function canonicalCompositeName(
  areaName: string,
  theme: VariantTheme,
  kind: Exclude<ActivityKind, 'POI' | 'AREA'>,
): string {
  const suffix =
    kind === ActivityKind.ROUTE
      ? 'Route'
      : kind === ActivityKind.EXPERIENCE
        ? 'Experience'
        : 'Walk';
  return `${areaName} ${THEME_NAME[theme]} ${suffix}`;
}

/**
 * Itinerary selection plus an explicitly separate offline composite-curation
 * workflow. Live tour generation never receives the composite proposal schema.
 */
@Injectable()
export class CompositeGenerationService {
  private readonly logger = new Logger(CompositeGenerationService.name);

  constructor(
    private readonly langChainService: LangChainService,
    @Inject('WikidataApiService')
    private readonly wikidataApiService: IWikidataApiService,
    private readonly compositeActivityService: CompositeActivityService,
  ) {}

  /**
   * Builds the tour-generation LLM chain — OpenAI function-calling when the
   * provider supports it, otherwise a JSON-mode fallback via
   * generateChatResponse (Ollama/Groq, or no chat model configured at all).
   * The JSON-mode background path uses the compact selection-only contract.
   */
  createTourChain(): TourSelectionChain {
    const chatModel = this.langChainService.getChatModel();
    const provider = this.langChainService['config']?.provider || 'openai';

    if (!chatModel || provider === 'ollama' || provider === 'groq') {
      return {
        invoke: async (input: TourSelectionChainInvokeInput) => {
          const systemPrompt = CREATE_TOUR_SELECTION_JSON_SYSTEM_PROMPT;

          const userPrompt = createTourJsonUserPrompt(
            input.input,
            input.activities,
          );

          const response = await this.langChainService.generateChatResponse(
            systemPrompt,
            userPrompt,
            {},
            {
              groq: {
                maxCompletionTokens: GROQ_TOUR_MAX_COMPLETION_TOKENS,
                reasoningEffort: 'low',
                includeReasoning: false,
              },
              responseFormat: {
                type: 'json_schema',
                json_schema: {
                  name: 'tour_generation',
                  strict: true,
                  schema: CREATE_TOUR_SELECTION_RESPONSE_SCHEMA,
                },
              },
            },
          );

          const cleanedResponse = extractAndCleanJson(response);

          try {
            return JSON.parse(cleanedResponse);
          } catch (parseError: any) {
            this.logger.error(
              `Failed to parse AI response as JSON: ${parseError.message}`,
            );
            this.logger.debug(
              `Cleaned response (first 500 chars): ${cleanedResponse.substring(0, 500)}`,
            );

            try {
              const repaired = repairJson(cleanedResponse);
              this.logger.warn('Attempting to use repaired JSON');
              return JSON.parse(repaired);
            } catch (repairError: any) {
              this.logger.error(
                `JSON repair also failed: ${repairError.message}`,
              );
              throw new Error(
                `AI returned invalid JSON format: ${parseError.message}. ` +
                  `Please try again or simplify your prompt.`,
              );
            }
          }
        },
      };
    }

    const tourSchema = {
      name: 'tour',
      description:
        'Create a tour itinerary with detailed notes for each activity',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          reasoning: {
            type: 'string',
            description:
              'Internal debugging note (3-5 sentences): how budget, transportation mode, travel pace, dietary restrictions, and group type were weighed when choosing and ordering activities, and why any candidates were left out. Not shown to the end user.',
          },
          estimatedDuration: { type: 'number' },
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                activityId: { type: 'string' },
                dayNumber: { type: 'number' },
                startTime: { type: 'string' },
                duration: { type: 'number' },
                travelTimeToNext: { type: 'number' },
                distanceToNext: { type: 'number' },
                notes: {
                  type: 'string',
                  description:
                    'Detailed notes about the activity, including what to expect, highlights, and practical tips',
                },
                type: { type: 'string' },
                latitude: { type: 'number' },
                longitude: { type: 'number' },
                selectedWaypointIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    "OPTIONAL — only if activityId refers to an existing composite/variant and the context justifies using a subset of its own waypoints (e.g. excluding a stop for a family with kids). Every id here must belong to that variant's own waypoints.",
                },
              },
              required: [
                'activityId',
                'dayNumber',
                'startTime',
                'duration',
                'notes',
              ],
            },
          },
          totalDays: { type: 'number' },
          totalDistance: { type: 'number' },
          estimatedBudget: { type: 'number' },
          recommendedGroupSize: { type: 'number' },
          activitiesLatLng: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lat: { type: 'number' },
                lng: { type: 'number' },
              },
            },
          },
        },
        required: ['title', 'description', 'activities'],
      },
    };

    const prompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(CREATE_TOUR_SYSTEM_PROMPT),
      HumanMessagePromptTemplate.fromTemplate('{input}'),
    ]);

    return RunnableSequence.from([
      prompt,
      chatModel.bind({
        functions: [tourSchema],
        function_call: { name: 'tour' },
      }),
      new JsonOutputFunctionsParser(),
    ]) as unknown as TourSelectionChain;
  }

  /**
   * Explicit offline curation chain for generate-templates. Keeping this
   * separate makes it impossible for live itinerary generation to create a
   * composite through prompt output.
   */
  createCompositeProposalChain(): CompositeProposalChain {
    return {
      invoke: async (input: CompositeProposalChainInvokeInput) => {
        const response = await this.langChainService.generateChatResponse(
          CREATE_COMPOSITE_PROPOSAL_JSON_SYSTEM_PROMPT,
          createCompositeProposalJsonUserPrompt(
            input.input,
            input.activities,
            input.osmFeatures ?? '',
            input.area ?? '',
            input.themes ?? '',
          ),
          {},
          {
            groq: {
              maxCompletionTokens: GROQ_TOUR_MAX_COMPLETION_TOKENS,
              reasoningEffort: 'low',
              includeReasoning: false,
            },
            responseFormat: {
              type: 'json_schema',
              json_schema: {
                name: 'composite_proposal',
                strict: true,
                schema: CREATE_COMPOSITE_PROPOSAL_RESPONSE_SCHEMA,
              },
            },
          },
        );

        const cleanedResponse = extractAndCleanJson(response);
        try {
          return JSON.parse(cleanedResponse);
        } catch (parseError: any) {
          this.logger.error(
            `Failed to parse composite proposal as JSON: ${parseError.message}`,
          );
          try {
            return JSON.parse(repairJson(cleanedResponse));
          } catch {
            throw new Error(
              `AI returned invalid composite proposal JSON: ${parseError.message}`,
            );
          }
        }
      },
    };
  }

  /**
   * Batches every `tags.wikidata` QID across the given candidates into a
   * single Wikidata lookup + a single content-safety pass, mutating
   * `narrativeContext` onto the candidates that come back safe. Never
   * throws — a failed/unconfigured Wikidata call just means no narrative
   * context this run, never a broken generation. Returns how many
   * candidates got enriched, for logging.
   */
  async enrichCandidatesWithWikidata(
    candidates: OsmCandidate[],
  ): Promise<WikidataEnrichmentOutcome> {
    const emptyOutcome = (): WikidataEnrichmentOutcome => ({
      withoutQid: candidates.filter((candidate) => !candidate.tags.wikidata)
        .length,
      withQid: candidates.filter((candidate) => !!candidate.tags.wikidata)
        .length,
      fetched: 0,
      acceptedSafe: 0,
      rejectedUnsafe: 0,
      providerFailed: 0,
      safetyCheckFailed: 0,
      fetchedQids: new Set(),
      safeQids: new Set(),
      rejectedUnsafeQids: new Set(),
      safetyCheckFailedQids: new Set(),
    });
    const outcome = emptyOutcome();
    const wikidataQids = Array.from(
      new Set(
        candidates
          .map((c) => c.tags.wikidata)
          .filter((qid): qid is string => !!qid),
      ),
    );
    if (wikidataQids.length === 0) return outcome;

    try {
      const lookup =
        await this.wikidataApiService.lookupEntitySummaries(wikidataQids);
      const summaries = lookup.summaries;
      const providerFailedQids = new Set([
        ...lookup.failedQids,
        ...lookup.extractFailedQids,
      ]);
      outcome.providerFailed = candidates.filter((candidate) => {
        const qid = candidate.tags.wikidata;
        return !!qid && providerFailedQids.has(qid);
      }).length;
      outcome.fetchedQids = new Set(summaries.keys());
      outcome.fetched = candidates.filter((candidate) => {
        const qid = candidate.tags.wikidata;
        return !!qid && summaries.has(qid);
      }).length;
      const extractInputs = Array.from(summaries.values())
        .filter((s) => !!s.extract)
        .map((s) => ({ qid: s.qid, extract: s.extract as string }));
      const assessment = await assessWikidataExtractSafety(
        extractInputs,
        this.langChainService,
      );
      outcome.safeQids = assessment.safeQids;

      if (assessment.status === 'failed') {
        outcome.safetyCheckFailedQids = new Set(
          extractInputs.map((input) => input.qid),
        );
        outcome.safetyCheckFailed = candidates.filter((candidate) => {
          const qid = candidate.tags.wikidata;
          return !!qid && outcome.safetyCheckFailedQids.has(qid);
        }).length;
        return outcome;
      }

      outcome.rejectedUnsafeQids = new Set(
        extractInputs
          .map((input) => input.qid)
          .filter((qid) => !assessment.safeQids.has(qid)),
      );

      for (const candidate of candidates) {
        const qid = candidate.tags.wikidata;
        if (qid && assessment.safeQids.has(qid)) {
          candidate.narrativeContext = summaries.get(qid)?.extract;
        }
      }
      outcome.acceptedSafe = candidates.filter(
        (candidate) => !!candidate.narrativeContext,
      ).length;
      outcome.rejectedUnsafe = candidates.filter((candidate) => {
        const qid = candidate.tags.wikidata;
        return !!qid && outcome.rejectedUnsafeQids.has(qid);
      }).length;
    } catch (error: any) {
      outcome.providerFailed = outcome.withQid;
      this.logger.warn(
        `Wikidata enrichment failed, continuing without narrative context: ${error.message}`,
      );
    }
    return outcome;
  }

  /**
   * Verifies raw `compositeActivities` proposals against the real offered
   * candidates (hard hallucination guard, one level deeper than the flat
   * activities list) and persists each survivor via
   * CompositeActivityService.createOrReuseComposite — the exact same path
   * for the explicit generate-templates curation command. Live tour
   * generation cannot call this persistence path from its LLM response.
   */
  async verifyAndPersistComposites(
    params: VerifyAndPersistCompositesParams,
  ): Promise<VerifyAndPersistCompositesResult> {
    const {
      rawComposites,
      candidateActivityIds,
      candidateOsmFeaturesById,
      areaCandidate,
      areaCandidatesById,
      candidateAreaIdsByWaypointId,
      logContext,
      forceUpdateWaypoints,
    } = params;

    const effectiveAreaCandidates =
      areaCandidatesById ??
      new Map(areaCandidate ? [[areaCandidate.id, areaCandidate]] : []);
    const effectiveAreaIdsByWaypoint =
      candidateAreaIdsByWaypointId ??
      new Map(
        areaCandidate
          ? [...candidateActivityIds, ...candidateOsmFeaturesById.keys()].map(
              (id) => [id, new Set([areaCandidate.id])],
            )
          : [],
      );

    const {
      verified,
      hallucinatedWaypointCount,
      invalidCompositeCount,
      outOfAreaWaypointCount,
    } = verifyAndDedupeCompositeActivities(
      rawComposites,
      candidateActivityIds,
      new Set(candidateOsmFeaturesById.keys()),
      new Set(effectiveAreaCandidates.keys()),
      effectiveAreaIdsByWaypoint,
      new Map(
        Array.from(candidateOsmFeaturesById.entries()).map(
          ([id, candidate]) => [id, candidate.name],
        ),
      ),
    );
    if (hallucinatedWaypointCount > 0) {
      this.logger.warn(
        `Dropped ${hallucinatedWaypointCount} hallucinated waypoint id(s) across composite activities for ${logContext}.`,
      );
    }
    if (invalidCompositeCount > 0) {
      this.logger.warn(
        `Dropped ${invalidCompositeCount} invalid compositeActivities proposal(s) for ${logContext}.`,
      );
    }
    if (outOfAreaWaypointCount > 0) {
      this.logger.warn(
        `Dropped ${outOfAreaWaypointCount} waypoint id(s) outside their proposed area across composite activities for ${logContext}.`,
      );
    }
    if (rawComposites.length > 0) {
      this.logger.debug(
        `${verified.length}/${rawComposites.length} compositeActivities proposal(s) survived verification for ${logContext}.`,
      );
    }

    const persisted: PersistedComposite[] = [];
    for (const composite of verified) {
      const resolvedAreaCandidate = effectiveAreaCandidates.get(
        composite.areaId,
      );
      if (!resolvedAreaCandidate) continue;
      try {
        const narrativeSources = composite.waypointIds
          .map((id) => candidateOsmFeaturesById.get(id))
          .filter((c): c is OsmCandidate => !!c?.narrativeContext)
          .map((c) => ({
            qid: c.tags.wikidata as string,
            label: c.name,
            extract: c.narrativeContext,
          }));

        const variant =
          await this.compositeActivityService.createOrReuseComposite({
            // Names are derived from resolved entities and the closed theme/
            // kind vocabularies. Free-form model naming is never persisted.
            name: canonicalCompositeName(
              resolvedAreaCandidate.name,
              composite.variantTheme,
              composite.kind,
            ),
            kind: composite.kind as ActivityKind,
            variantTheme: composite.variantTheme as VariantTheme,
            themeReasoning: composite.themeReasoning,
            areaCandidate: resolvedAreaCandidate,
            waypointIds: composite.waypointIds,
            candidateOsmFeaturesById,
            narrativeSources,
            forceUpdateWaypoints,
          });

        persisted.push({
          variant,
          themeReasoning: composite.themeReasoning,
          dayNumber: composite.dayNumber,
          startTime: composite.startTime,
        });
      } catch (error: any) {
        this.logger.warn(
          `Failed to persist composite "${composite.name}" for ${logContext}: ${error.message}`,
        );
      }
    }

    return {
      persisted,
      hallucinatedWaypointCount,
      invalidCompositeCount,
      outOfAreaWaypointCount,
    };
  }
}
