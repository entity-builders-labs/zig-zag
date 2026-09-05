import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import aiConfig from '@shared/ai/ai.config';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
import {
  extractExperienceCandidates,
  ExperienceExtractionResult,
} from '../utils/experience-candidate-extraction.util';

/** Gemini-specific: short role framing only. No JSON-shape prose here —
 * response_format (JSON Schema, below) enforces the exact shape
 * structurally, so repeating it in prose would be redundant. */
const GEMINI_INTRO = `You are an ExperienceCandidate extractor.

Your task is to convert grounded tourism research into structured ExperienceCandidate
candidates for a destination based on:
- the user's requested themes and soft Experience intents;
- exploration style;
- additional preferences;
- explicit coverage gaps;
- grounded search evidence supplied to you.

If day_trip is requested, only extract experiences supported by evidence as suitable
from the selected base destination and returning the same day. Do not return overnight
or weekend-only trips.

You are NOT responsible for trusted geographic identity.

The backend independently resolves all proposed entities through trusted geographic
providers before anything may be persisted.

Never provide or invent:
- coordinates;
- Google Place IDs;
- OpenStreetMap IDs;
- Wikidata IDs;
- provider-specific geographic identifiers;
- URLs or citations that were not supplied in the grounded evidence.`;

const SYSTEM_INSTRUCTION = GEMINI_INTRO;

/** JSON Schema for the Interactions API's response_format. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          themes: { type: 'array', items: { type: 'string' } },
          traits: { type: 'array', items: { type: 'string' } },
          intents: { type: 'array', items: { type: 'string' } },
          componentHints: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                name: { type: 'string' },
                role: {
                  type: 'string',
                  enum: ['area', 'waypoint', 'route', 'venue'],
                },
                expectedKind: {
                  type: 'string',
                  enum: ['PLACE', 'AREA', 'ROUTE'],
                },
                required: { type: 'boolean' },
                evidenceKeys: { type: 'array', items: { type: 'string' } },
              },
              required: [
                'key',
                'name',
                'role',
                'expectedKind',
                'required',
                'evidenceKeys',
              ],
            },
          },
          suggestedDurationMinutes: { type: 'integer' },
          shortReason: { type: 'string' },
          evidenceKeys: { type: 'array', items: { type: 'string' } },
          orderedByEvidence: {
            type: 'boolean',
            description:
              "True only when the cited evidence explicitly describes a visiting sequence for this candidate's components. Never inferred from componentHints array order.",
          },
        },
        required: [
          'name',
          'description',
          'themes',
          'traits',
          'intents',
          'componentHints',
          'suggestedDurationMinutes',
          'shortReason',
          'evidenceKeys',
          'orderedByEvidence',
        ],
      },
    },
  },
  required: ['candidates'],
};

interface GeminiInteractionStep {
  type: string;
  content?: { type: string; text?: string }[];
}

interface GeminiInteractionResponse {
  status?: string;
  steps?: GeminiInteractionStep[];
  usage?: {
    total_tokens?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
  };
}

@Injectable()
export class GeminiDiscoveryProvider {
  private readonly logger = new Logger(GeminiDiscoveryProvider.name);
  private readonly apiUrl =
    'https://generativelanguage.googleapis.com/v1beta/interactions';
  private readonly timeoutMs = 25000;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  private get model(): string {
    return this.config.discoveryExtractor.gemini.model;
  }

  /** Native V2 extraction boundary for grounded Experience candidates. */
  async extractExperiences(
    request: ExperienceDiscoveryRequest,
    searchResult: ExperienceGroundedSearchResult,
  ): Promise<
    ExperienceExtractionResult & {
      provider: string;
      model: string;
      rawOutput?: string;
    }
  > {
    const apiKey = this.config.discoveryExtractor.gemini.apiKey;
    if (!apiKey)
      return {
        candidates: [],
        validationErrors: ['Missing Gemini API key'],
        provider: 'gemini',
        model: this.model,
      };
    const evidence = searchResult.evidence ?? [];
    const prompt = [
      `Destination: ${request.scope.destinationName ?? 'unknown'}`,
      `Themes: ${request.requestedThemes.join(', ') || 'none'}`,
      `Requested intents: ${request.requestedIntents?.join(', ') || 'none'}`,
      `Preferences: ${(request.semanticQuery || request.preferredTraits?.join(', ')) ?? 'none'}`,
      'Return JSON with a candidates array. Each candidate must contain name, description, themes, traits, intents, suggestedDurationMinutes, componentHints, evidenceKeys, shortReason and orderedByEvidence.',
      "orderedByEvidence must be true only when the cited evidence explicitly describes a visiting sequence for this candidate's components; otherwise false. Never infer an order from componentHints array order.",
      'intents are soft Experience facets such as visit, walk, food, route_like or day_trip; never structural proposal kinds.',
      'For day_trip, only return evidence-backed same-day experiences from the selected base; exclude overnight or weekend-only trips.',
      'Do not output coordinates, provider IDs, URLs, or entities not directly supported by evidence.',
      "componentHints[].name must be the place's shortest official/canonical name exactly as it literally appears in the evidence — never a marketing title, never a translated compound, never a parenthetical nickname appended to it. This name is used afterward to verify the place against a real map database.",
      'Grounded evidence:',
      ...evidence.map(
        (item) => `[${item.key}] ${item.title || item.source}: ${item.snippet}`,
      ),
    ].join('\n');
    const raw = await this.callInteractionsApi(apiKey, prompt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        candidates: [],
        validationErrors: ['Failed to parse JSON response'],
        provider: 'gemini',
        model: this.model,
        rawOutput: raw,
      };
    }
    const extracted = extractExperienceCandidates(
      parsed,
      new Set(evidence.map((item) => item.key)),
      request.maxCandidates,
    );
    return {
      ...extracted,
      provider: 'gemini',
      model: this.model,
      rawOutput: raw,
    };
  }

  private async callInteractionsApi(
    apiKey: string,
    userPrompt: string,
  ): Promise<string> {
    try {
      return await this.fetchInteraction(apiKey, userPrompt);
    } catch (error: any) {
      if (error?.name !== 'TimeoutError' && error?.name !== 'AbortError') {
        throw error;
      }
      this.logger.warn('Gemini Interactions API timed out; retrying once.');
      return this.fetchInteraction(apiKey, userPrompt);
    }
  }

  private async fetchInteraction(
    apiKey: string,
    userPrompt: string,
  ): Promise<string> {
    const resp = await fetch(`${this.apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        system_instruction: SYSTEM_INSTRUCTION,
        input: userPrompt,
        response_format: RESPONSE_SCHEMA,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Gemini error ${resp.status}: ${errBody}`);
    }

    const data: GeminiInteractionResponse = await resp.json();
    const modelOutput = data.steps?.find(
      (step) => step.type === 'model_output',
    );
    const text = modelOutput?.content?.find(
      (content) => content.type === 'text',
    )?.text;
    if (!text) {
      throw new Error('Gemini response had no model_output text content');
    }
    return text;
  }
}
