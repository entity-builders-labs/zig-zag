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
      `Requested intents: ${request.requestedIntents?.join(', ') || 'none'}`,
      `Preferences: ${request.semanticQuery ?? request.preferredTraits?.join(', ') ?? 'none'}`,
      'Return JSON with a candidates array. Each candidate must contain name, description, themes, traits, intents, suggestedDurationMinutes, componentHints, evidenceKeys, shortReason and orderedByEvidence.',
      'orderedByEvidence must be true only when the cited evidence explicitly describes a visiting sequence for this candidate\'s components (e.g. "start at X, then walk to Y"); otherwise set it to false. Do not infer an order from how you happen to list componentHints.',
      'intents are soft Experience facets such as visit, walk, food, route_like or day_trip; never use them as structural proposal kinds.',
      'If day_trip is requested, only emit candidates supported by evidence as suitable from the selected base destination and returning the same day; do not emit overnight or weekend-only trips.',
      'Do not output kinds, coordinates, provider IDs, or unsupported URLs.',
      "componentHints[].name must be the place's shortest official/canonical name exactly as it literally appears in the evidence — never a marketing title, never a translated compound, never a parenthetical nickname appended to it. This name is used afterward to verify the place against a real map database.",
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
