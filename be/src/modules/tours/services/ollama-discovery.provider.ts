import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import aiConfig from '@shared/ai/ai.config';
import { Ollama } from 'ollama';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
import {
  buildDiscoveryResponseJsonSchema,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
import {
  extractExperienceCandidates,
  ExperienceExtractionResult,
} from '../utils/experience-candidate-extraction.util';

const PLACEHOLDER_API_KEY = 'ollama_api_key_if_needed';

/**
 * Discovery extractor backed by a self-hostable Ollama server (local for
 * dev/testing today; a remote `OLLAMA_BASE_URL` is supported for a future
 * self-hosted deployment — not the production default). It speaks the exact
 * same shared contract as the Gemini/Groq extractors: the shared discovery
 * prompt, then `extractExperienceCandidates` → `normalizeExperienceCandidateFacets`.
 * No Ollama-specific facet semantics; the deterministic normalizer stays the
 * backend authority. Uses the official `ollama` client's structured JSON mode
 * (`format: 'json'`, `temperature: 0`), matching what was validated manually
 * against `POST /api/chat`.
 */
@Injectable()
export class OllamaDiscoveryProvider {
  private readonly logger = new Logger(OllamaDiscoveryProvider.name);

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  private get model(): string {
    return this.config.discoveryExtractor.ollama.model;
  }

  // NB: the shared ExperienceDiscoveryExtractor contract also accepts an
  // `options: { bypassCache? }` third argument. Ollama has no AI response cache
  // in its path (the request is always a real outbound call), so this provider
  // simply omits it — a narrower signature still satisfies the interface.
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
    const { baseUrl, apiKey, model, timeoutMs, numCtx } =
      this.config.discoveryExtractor.ollama;
    const headers =
      apiKey && apiKey !== PLACEHOLDER_API_KEY
        ? { Authorization: `Bearer ${apiKey}` }
        : undefined;
    const client = new Ollama({ host: baseUrl, headers });

    const evidence = searchResult.evidence ?? [];
    const system = buildDiscoverySystemPrompt();
    const user = buildDiscoveryUserPrompt(request, evidence);

    let raw: string;
    try {
      const resp = await this.withTimeout(
        client.chat({
          model,
          stream: false,
          // Ollama structured outputs: a full JSON Schema (not the bare
          // 'json' string) is what actually holds a small local model to the
          // ExperienceCandidate / componentHint shape and the controlled
          // theme/intent enums.
          format: buildDiscoveryResponseJsonSchema(),
          options: {
            temperature: 0,
            ...(numCtx ? { num_ctx: numCtx } : {}),
          },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        timeoutMs,
        () => client.abort(),
      );
      raw = (resp.message?.content ?? '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Ollama discovery request failed against ${baseUrl} (model ${model}): ${message}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        candidates: [],
        validationErrors: ['Failed to parse JSON response'],
        provider: 'ollama',
        model,
        rawOutput: raw,
      };
    }

    return {
      ...extractExperienceCandidates(
        parsed,
        evidence.map((item) => ({
          key: item.key,
          title: item.title,
          text: item.snippet,
        })),
        request.maxCandidates,
      ),
      provider: 'ollama',
      model,
      rawOutput: raw,
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    onTimeout: () => void,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            try {
              onTimeout();
            } catch {
              /* best-effort abort */
            }
            reject(new Error(`timed out after ${ms}ms`));
          }, ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
