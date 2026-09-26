import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import aiConfig from '@shared/ai/ai.config';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
import {
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
import {
  extractExperienceCandidates,
  ExperienceExtractionResult,
} from '../utils/experience-candidate-extraction.util';

/** Extractor-specific transport settings for Cloudflare Workers AI. These are
 * not global AI temperature — they only apply to this discovery extraction
 * call (same rationale as Groq's frozen temp=0 / 900-token budget). */
const TEMPERATURE = 0;
const MAX_COMPLETION_TOKENS = 900;

/** Provider failure that preserves the upstream HTTP status so callers can
 * distinguish a rate limit (HTTP 429) from semantic empty output. A 429 is
 * never converted into an empty `candidates: []` envelope. */
export class CloudflareDiscoveryError extends Error {
  readonly status?: number;

  constructor(status: number | undefined, message: string) {
    super(message);
    this.name = 'CloudflareDiscoveryError';
    this.status = status;
  }
}

interface CloudflareChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

/**
 * Discovery extractor backed by Cloudflare Workers AI's OpenAI-compatible Chat
 * Completions endpoint. It speaks the exact same shared contract as the other
 * extractors: `buildDiscoverySystemPrompt` + `buildDiscoveryUserPrompt`, then
 * the deterministic `extractExperienceCandidates` boundary. No
 * Cloudflare-specific facet or candidate semantics.
 *
 * Structured output: Cloudflare's documented JSON Mode (`response_format` with
 * `type: "json_schema"`) does not list `@cf/qwen/qwen3.8-27b` among its
 * supported models, and `json_object` support has not been confirmed live for
 * this model. So this provider deliberately sends **no** `response_format` and
 * relies on the shared prompt's "Return JSON with a candidates array"
 * instruction plus the existing deterministic JSON.parse / extraction
 * validation path. Malformed output remains observable as a parse failure
 * rather than being silently coerced.
 */
@Injectable()
export class CloudflareDiscoveryProvider {
  private static readonly API_BASE_URL =
    'https://api.cloudflare.com/client/v4/accounts';

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  private get cloudflare() {
    return this.config.discoveryExtractor.cloudflare;
  }

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
    const { accountId, apiToken, model } = this.cloudflare;

    // Missing credentials are explicit and never trigger a network call with
    // blank values. The token itself is never surfaced.
    if (!accountId) {
      return {
        candidates: [],
        validationErrors: ['Missing Cloudflare account id'],
        sourceSupportAudits: [],
        provider: 'cloudflare',
        model,
      };
    }
    if (!apiToken) {
      return {
        candidates: [],
        validationErrors: ['Missing Cloudflare API token'],
        sourceSupportAudits: [],
        provider: 'cloudflare',
        model,
      };
    }

    const evidence = searchResult.evidence ?? [];
    const system = buildDiscoverySystemPrompt();
    const user = buildDiscoveryUserPrompt(request, evidence);

    const raw = await this.callCloudflare(
      accountId,
      apiToken,
      model,
      system,
      user,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        candidates: [],
        validationErrors: ['Failed to parse JSON response'],
        sourceSupportAudits: [],
        provider: 'cloudflare',
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
      provider: 'cloudflare',
      model,
      rawOutput: raw,
    };
  }

  private async callCloudflare(
    accountId: string,
    apiToken: string,
    model: string,
    system: string,
    user: string,
  ): Promise<string> {
    const endpoint = `${CloudflareDiscoveryProvider.API_BASE_URL}/${accountId}/ai/v1/chat/completions`;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: TEMPERATURE,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      }),
      signal: AbortSignal.timeout(this.cloudflare.timeoutMs),
    });

    if (!resp.ok) {
      const status = resp.status;
      const bodyText = await resp.text();
      throw new CloudflareDiscoveryError(
        status,
        `Cloudflare Workers AI request failed with HTTP ${status}: ${this.redactSecrets(bodyText, apiToken)}`,
      );
    }

    const data: CloudflareChatCompletionResponse = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('Cloudflare response had no choices[0].message.content');
    }

    // Normalize the one transport artifact comparable providers already strip:
    // an explicit reasoning wrapper (`<think>…</think>`), which Qwen reasoning
    // models can emit. Semantic content is otherwise untouched.
    return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  /** Redact the API token (and any Bearer credential) from an upstream error
   * body so secrets never reach logs or the returned error message. */
  private redactSecrets(text: string, apiToken: string): string {
    let out = text;
    if (apiToken) {
      out = out.split(apiToken).join('[REDACTED]');
    }
    return out.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
  }
}
