import { Inject, Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityKind, VariantTheme } from '@prisma/client';
import { LangChainService } from '@shared/ai/langchain.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';
import { filterSafeWikidataExtracts } from '@integrations/wikidata/utils/wikidata-content-safety.util';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import {
  CREATE_TOUR_JSON_SYSTEM_PROMPT,
  CREATE_TOUR_RESPONSE_SCHEMA,
  CREATE_TOUR_SYSTEM_PROMPT,
  GROQ_TOUR_MAX_COMPLETION_TOKENS,
  createTourJsonUserPrompt,
} from '../prompts/create-tour.prompt';
import { extractAndCleanJson, repairJson } from '../utils/json-parser.util';
import {
  RawCompositeActivity,
  verifyAndDedupeCompositeActivities,
} from '../utils/composite-activity-verification.util';

export interface TourChainInvokeInput {
  input: string;
  activities: string;
  osmFeatures?: string;
  area?: string;
  themes?: string;
}

export interface TourChain {
  invoke(input: TourChainInvokeInput): Promise<any>;
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
}

/**
 * Shared "propose (LLM) -> verify -> persist" machinery for composite
 * activities (neighborhood walks, routes, experiences) — used both by live
 * tour generation (TourActivityGenerationService, one chain call producing
 * flat activities + compositeActivities together) and by the offline
 * `generate-templates` CLI command (one chain call per requested theme,
 * compositeActivities only). Candidate gathering (OSM streets/boundary) and
 * the flat-activities-specific logic stay in each caller — only the pieces
 * that are byte-for-byte identical between the two flows live here.
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
   * Callers that only want compositeActivities (generate-templates) simply
   * ignore the `activities`/`title`/etc. fields of the response.
   */
  createTourChain(): TourChain {
    const chatModel = this.langChainService.getChatModel();
    const provider = this.langChainService['config']?.provider || 'openai';

    if (!chatModel || provider === 'ollama' || provider === 'groq') {
      return {
        invoke: async (input: TourChainInvokeInput) => {
          const systemPrompt = CREATE_TOUR_JSON_SYSTEM_PROMPT;

          const userPrompt = createTourJsonUserPrompt(
            input.input,
            input.activities,
            input.osmFeatures,
            input.area,
            input.themes,
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
                  schema: CREATE_TOUR_RESPONSE_SCHEMA,
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
          compositeActivities: {
            type: 'array',
            description:
              'Themed multi-stop experiences (neighborhood walks, routes, or experiences) proposed alongside the flat activities list — never instead of it.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                kind: {
                  type: 'string',
                  enum: ['NEIGHBORHOOD_WALK', 'ROUTE', 'EXPERIENCE'],
                },
                variantTheme: { type: 'string' },
                themeReasoning: {
                  type: 'string',
                  description:
                    'Why this composite makes sense here, 1-3 sentences.',
                },
                areaId: {
                  type: 'string',
                  description:
                    'Must exactly match the Available area candidate offered — never invented.',
                },
                dayNumber: { type: 'number' },
                startTime: { type: 'string' },
                waypointIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Every id copied exactly from Available activities or Available OSM features — never invented.',
                },
              },
              required: [
                'name',
                'kind',
                'variantTheme',
                'areaId',
                'waypointIds',
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
    ]) as unknown as TourChain;
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
  ): Promise<number> {
    const wikidataQids = Array.from(
      new Set(
        candidates
          .map((c) => c.tags.wikidata)
          .filter((qid): qid is string => !!qid),
      ),
    );
    if (wikidataQids.length === 0) return 0;

    let narrativeContextUsed = 0;
    try {
      const summaries =
        await this.wikidataApiService.getEntitySummaries(wikidataQids);
      const extractInputs = Array.from(summaries.values())
        .filter((s) => !!s.extract)
        .map((s) => ({ qid: s.qid, extract: s.extract as string }));
      const safeQids = await filterSafeWikidataExtracts(
        extractInputs,
        this.langChainService,
      );

      for (const candidate of candidates) {
        const qid = candidate.tags.wikidata;
        if (qid && safeQids.has(qid)) {
          candidate.narrativeContext = summaries.get(qid)?.extract;
          narrativeContextUsed++;
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Wikidata enrichment failed, continuing without narrative context: ${error.message}`,
      );
    }
    return narrativeContextUsed;
  }

  /**
   * Verifies raw `compositeActivities` proposals against the real offered
   * candidates (hard hallucination guard, one level deeper than the flat
   * activities list) and persists each survivor via
   * CompositeActivityService.createOrReuseComposite — the exact same path
   * whether the proposal came from a live tour generation call or a
   * generate-templates CLI run.
   */
  async verifyAndPersistComposites(
    params: VerifyAndPersistCompositesParams,
  ): Promise<VerifyAndPersistCompositesResult> {
    const {
      rawComposites,
      candidateActivityIds,
      candidateOsmFeaturesById,
      areaCandidate,
      logContext,
      forceUpdateWaypoints,
    } = params;

    const { verified, hallucinatedWaypointCount, invalidCompositeCount } =
      verifyAndDedupeCompositeActivities(
        rawComposites,
        candidateActivityIds,
        new Set(candidateOsmFeaturesById.keys()),
        areaCandidate?.id ?? null,
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
    if (rawComposites.length > 0) {
      this.logger.debug(
        `${verified.length}/${rawComposites.length} compositeActivities proposal(s) survived verification for ${logContext}.`,
      );
    }

    const persisted: PersistedComposite[] = [];
    for (const composite of verified) {
      if (!areaCandidate) continue; // verification already guarantees this, but keeps TS narrowed
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
            name: composite.name || `${areaCandidate.name} ${composite.kind}`,
            kind: composite.kind as ActivityKind,
            variantTheme: composite.variantTheme as VariantTheme,
            themeReasoning: composite.themeReasoning,
            areaCandidate,
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

    return { persisted, hallucinatedWaypointCount, invalidCompositeCount };
  }
}
