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
      'IMPORTANT: for every componentHints[].name, translate it to the official local-language administrative name used by that country\'s mapping data (for Argentina/most of Latin America this is Spanish, e.g. "Parque Nacional El Leoncito", never "El Leoncito National Park"). Do this even if the evidence only ever uses an English phrase — rely on your own knowledge of the real place\'s official name, not just the evidence wording, for this field specifically. This name is used afterward to verify the place against a real map database, which stores names in the local language.',
      'Return JSON with a candidates array. Each candidate must contain name, description, themes, traits, intents, suggestedDurationMinutes, componentHints, evidenceKeys, shortReason and orderedByEvidence.',
      'Some evidence entries are the full text of a source article, not just a short snippet — when one describes a walk/route with multiple named stops (specific streets, plazas, landmarks, markets), enumerate EACH real stop it names as its own componentHint (role "venue" for a point, "route" for a named street/path, "area" for a district), citing the exact evidence key(s) that name it. Do not collapse a multi-stop route into a single componentHint just because it shares one candidate name.',
      'A componentHints[].name for role "venue" must be the actual named place or business (e.g. a milonga, café, museum, restaurant) — never a street name, cross-street, or address fragment mentioned only to locate it. If evidence gives an address like "Armenia 1366" or says a venue is "on Armenia street", the venue name is whatever business/place it names (e.g. "La Viruta"), never "Armenia" itself. Only use role "route" naming a street when the street itself, not a venue located on it, is what the candidate describes.',
      'orderedByEvidence must be true only when the cited evidence explicitly describes a visiting sequence for this candidate\'s components (e.g. "start at X, then walk to Y"); otherwise set it to false. Do not infer an order from how you happen to list componentHints.',
      'intents are soft Experience facets such as visit, walk, food, route_like or day_trip; never use them as structural proposal kinds.',
      'If day_trip is requested, only emit candidates supported by evidence as suitable from the selected base destination and returning the same day; do not emit overnight or weekend-only trips.',
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
