import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LangChainService } from '@shared/ai/langchain.service';
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
    const raw = await this.langChainService.generateChatResponse(
      buildDiscoverySystemPrompt(),
      prompt,
      {},
      {
        // DISCOVERY_EXTRACTOR_PROVIDER — not AI_PROVIDER — decides that this
        // extraction call really goes to Groq, with the Groq discovery model.
        providerOverride: 'groq',
        modelOverride: this.model,
        bypassCache: options?.bypassCache,
        responseFormat: { type: 'json_object' },
        groq: { maxCompletionTokens: 4096 },
        temperature: 0,
      },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        candidates: [],
        validationErrors: ['Failed to parse JSON response'],
        sourceSupportAudits: [],
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
}
