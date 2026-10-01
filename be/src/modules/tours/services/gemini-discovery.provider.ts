import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import aiConfig from '@shared/ai/ai.config';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
import {
  buildDiscoveryResponseJsonSchema,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
import {
  extractExperienceCandidates,
  failedExtraction,
  ExperienceExtractionResult,
} from '../utils/experience-candidate-extraction.util';

/** Role framing shared by every discovery extractor. No JSON-shape prose —
 * response_format (JSON Schema, below) enforces the exact shape structurally. */
const SYSTEM_INSTRUCTION = buildDiscoverySystemPrompt();

/**
 * JSON Schema for the Interactions API's `response_format`. The two extractors
 * with structured-schema support — Gemini and Ollama — reuse this exact schema
 * (`themes`/`intents` `enum`s from the central controlled vocabulary, `traits`
 * open). Groq has no equivalent, so it relies on the shared semantic prompt
 * plus the deterministic backend normalizer instead.
 */
const RESPONSE_SCHEMA = buildDiscoveryResponseJsonSchema();

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
        ...failedExtraction('Missing Gemini API key'),
        provider: 'gemini',
        model: this.model,
      };
    const evidence = searchResult.evidence ?? [];
    const prompt = buildDiscoveryUserPrompt(request, evidence);
    const raw = await this.callInteractionsApi(apiKey, prompt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ...failedExtraction('Failed to parse JSON response'),
        provider: 'gemini',
        model: this.model,
        rawOutput: raw,
      };
    }
    const extracted = extractExperienceCandidates(
      parsed,
      evidence.map((item) => ({
        key: item.key,
        title: item.title,
        text: item.snippet,
      })),
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
