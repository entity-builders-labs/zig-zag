import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LangChainService } from '@shared/ai/langchain.service';
import aiConfig from '@shared/ai/ai.config';
import {
  DiscoveryStructuredCompletionRequest,
  ExperienceDiscoveryRequest,
} from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
import {
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
import {
  extractExperienceCandidates,
  failedExtraction,
  ExperienceExtractionResult,
} from '../utils/experience-candidate-extraction.util';

@Injectable()
export class GroqDiscoveryProvider {
  constructor(
    private readonly langChainService: LangChainService,
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  private get model(): string {
    return this.config.discoveryExtractor.groq.model;
  }

  async extractExperiences(
    request: ExperienceDiscoveryRequest,
    searchResult: ExperienceGroundedSearchResult,
    options?: { bypassCache?: boolean },
  ): Promise<
    ExperienceExtractionResult & {
      provider: string;
      model: string;
      rawOutput?: string;
    }
  > {
    const evidence = searchResult.evidence ?? [];
    const prompt = buildDiscoveryUserPrompt(request, evidence);
    const raw = await this.chatJson(
      buildDiscoverySystemPrompt(),
      prompt,
      options?.bypassCache,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ...failedExtraction('Failed to parse JSON response'),
        provider: 'groq',
        model: this.model,
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
      provider: 'groq',
      model: this.model,
      rawOutput: raw,
    };
  }

  /** Groq runs in JSON-object mode: the schema is carried by the prompt. */
  async completeStructured(
    request: DiscoveryStructuredCompletionRequest,
  ): Promise<string> {
    return this.chatJson(request.system, request.user, true);
  }

  private chatJson(
    system: string,
    user: string,
    bypassCache: boolean | undefined,
  ): Promise<string> {
    return this.langChainService.generateChatResponse(
      system,
      // The shared chat transport formats the user prompt as an f-string
      // template, and this call has no template variables: every brace is
      // literal text (a JSON example, or source text that contains one).
      user.replace(/[{}]/g, (brace) => brace + brace),
      {},
      {
        // DISCOVERY_EXTRACTOR_PROVIDER — not AI_PROVIDER — decides that this
        // extraction call really goes to Groq, with the Groq discovery model.
        providerOverride: 'groq',
        modelOverride: this.model,
        bypassCache,
        responseFormat: { type: 'json_object' },
        groq: { maxCompletionTokens: 4096 },
        temperature: 0,
      },
    );
  }
}
