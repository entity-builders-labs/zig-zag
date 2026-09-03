import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LangChainService } from '@shared/ai/langchain.service';
import aiConfig from '@shared/ai/ai.config';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
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
  ): Promise<
    ExperienceExtractionResult & {
      provider: string;
      model: string;
      rawOutput?: string;
    }
  > {
    const evidence = searchResult.evidence ?? [];
    const prompt = [
      `Destination: ${request.scope.destinationName ?? 'unknown'}`,
      `Themes: ${request.requestedThemes.join(', ') || 'none'}`,
      `Preferences: ${request.semanticQuery ?? request.preferredTraits?.join(', ') ?? 'none'}`,
      'Return JSON with a candidates array. Each candidate must contain name, description, themes, traits, suggestedDurationMinutes, componentHints, evidenceKeys and shortReason.',
      'Do not output kinds, coordinates, provider IDs, or unsupported URLs.',
      'Grounded evidence:',
      ...evidence.map(
        (item) => `[${item.key}] ${item.title || item.source}: ${item.snippet}`,
      ),
    ].join('\n');
    const raw = await this.langChainService.generateChatResponse(
      'You extract grounded tourism Experiences. Geographic identity is resolved independently; never invent identifiers.',
      prompt,
      {},
      {
        responseFormat: { type: 'json_object' },
        groq: { maxCompletionTokens: 4096 },
      },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        candidates: [],
        validationErrors: ['Failed to parse JSON response'],
        provider: 'groq',
        model: this.model,
        rawOutput: raw,
      };
    }
    return {
      ...extractExperienceCandidates(
        parsed,
        new Set(evidence.map((item) => item.key)),
        request.maxCandidates,
      ),
      provider: 'groq',
      model: this.model,
      rawOutput: raw,
    };
  }
}
