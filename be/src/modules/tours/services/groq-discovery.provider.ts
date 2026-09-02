import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LangChainService } from '@shared/ai/langchain.service';
import aiConfig from '@shared/ai/ai.config';
import {
  ActivityProposal,
  DiscoveryRequest,
  DiscoveryResponse,
  GroundedSearchResult,
  SearchGroundedDiscoveryProvider,
} from '../interfaces/activity-discovery.interface';
import {
  DISCOVERY_SEMANTIC_RULES,
  MAX_PROPOSALS,
  buildEvidenceMap,
  buildUserPrompt,
  validateProposal,
} from '../utils/discovery-extraction-shared.util';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
import { extractExperienceCandidates, ExperienceExtractionResult } from '../utils/experience-candidate-extraction.util';

/** Groq-specific: JSON shape/output-format prose, needed because Groq's
 * json_object response format only guarantees *some* valid JSON, not a
 * specific shape — unlike Gemini's response_format (JSON Schema), which
 * enforces this shape structurally and doesn't need it repeated in prose. */
const GROQ_INTRO_AND_SHAPE = `You are a grounded travel activity discovery agent.

Your job is to propose specific, real, geographically resolvable travel activities
for a destination based on:
- the user's requested themes;
- requested experience formats;
- exploration style;
- additional preferences;
- explicit coverage gaps;
- grounded search evidence supplied to you.

You are NOT responsible for trusted geographic identity.

The backend independently resolves all proposed entities through Google Places
or OpenStreetMap before anything may be persisted.

Never provide or invent:
- coordinates;
- Google Place IDs;
- OpenStreetMap IDs;
- Wikidata IDs;
- provider-specific geographic identifiers;
- URLs or citations that were not supplied in the grounded evidence.

Return ONLY valid JSON.

The response must have this top-level shape:

{
  "proposals": [...]
}

Each proposal must contain:
- name
- kind
- themes
- entityHints
- suggestedDurationMinutes
- shortReason
- evidenceKeys

Allowed kinds:
- POI
- ROUTE
- AREA
- NEIGHBORHOOD_WALK
- EXPERIENCE

EntityHint:
{
  "key": string,
  "name": string,
  "role": "area" | "waypoint" | "route" | "venue",
  "expectedType": string,
  "required": boolean,
  "evidenceKeys": string[]
}`;

const SYSTEM_PROMPT = `${GROQ_INTRO_AND_SHAPE}\n\n${DISCOVERY_SEMANTIC_RULES}`;

@Injectable()
export class GroqDiscoveryProvider implements SearchGroundedDiscoveryProvider {
  private readonly logger = new Logger(GroqDiscoveryProvider.name);

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
  ): Promise<ExperienceExtractionResult & { provider: string; model: string; rawOutput?: string }> {
    const evidence = searchResult.evidence ?? [];
    const prompt = [
      `Destination: ${request.scope.destinationName ?? 'unknown'}`,
      `Themes: ${request.requestedThemes.join(', ') || 'none'}`,
      `Preferences: ${request.semanticQuery ?? request.preferredTraits?.join(', ') ?? 'none'}`,
      'Return JSON with a candidates array. Each candidate must contain name, description, themes, traits, suggestedDurationMinutes, componentHints, evidenceKeys and shortReason.',
      'Do not output kinds, coordinates, provider IDs, or unsupported URLs.',
      'Grounded evidence:',
      ...evidence.map((item) => `[${item.key}] ${item.title || item.source}: ${item.snippet}`),
    ].join('\n');
    const raw = await this.langChainService.generateChatResponse(
      'You extract grounded tourism Experiences. Geographic identity is resolved independently; never invent identifiers.',
      prompt,
      {},
      { responseFormat: { type: 'json_object' }, groq: { maxCompletionTokens: 4096 } },
    );
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { candidates: [], validationErrors: ['Failed to parse JSON response'], provider: 'groq', model: this.model, rawOutput: raw }; }
    return { ...extractExperienceCandidates(parsed, new Set(evidence.map((item) => item.key)), request.maxCandidates), provider: 'groq', model: this.model, rawOutput: raw };
  }

  async discover(
    request: DiscoveryRequest,
    searchResult?: GroundedSearchResult,
  ): Promise<DiscoveryResponse> {
    const maxProposals = Math.min(
      request.maxProposals || MAX_PROPOSALS,
      MAX_PROPOSALS,
    );
    const evidenceMap = buildEvidenceMap(searchResult);
    const evidenceKeys = Array.from(evidenceMap.keys());
    const targetKindInstruction = request.targetKind
      ? `MANDATORY TARGET KIND: ${request.targetKind}. Every proposal in this extraction call MUST use kind=${request.targetKind}. Do not return POI or any other kind as a substitute for this missing structural format.\n\n`
      : '';
    const userPrompt = `${targetKindInstruction}${buildUserPrompt(
      request,
      evidenceMap,
      maxProposals,
    )}`;

    const raw = await this.langChainService.generateChatResponse(
      SYSTEM_PROMPT,
      userPrompt,
      {},
      {
        responseFormat: { type: 'json_object' },
        groq: { maxCompletionTokens: 4096 },
      },
    );

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        proposals: [],
        provider: 'groq',
        model: this.model,
        groundingStatus: searchResult?.groundingStatus ?? 'unavailable',
        groundingProvider: searchResult?.provider,
        groundingModel: searchResult?.model,
        groundingEvidence: searchResult?.evidence,
        rawOutput: raw,
        validationErrors: ['Failed to parse JSON response'],
      };
    }

    const rawProposals: any[] = parsed.proposals || [];
    const proposals: ActivityProposal[] = [];
    const validationErrors: string[] = [];

    for (let i = 0; i < Math.min(rawProposals.length, maxProposals); i++) {
      const p = rawProposals[i];
      const errors = validateProposal(p, evidenceKeys);
      if (errors.length > 0) {
        validationErrors.push(
          `Proposal ${i + 1} "${p?.name || 'unnamed'}": ${errors.join('; ')}`,
        );
        continue;
      }
      proposals.push({
        name: p.name,
        kind: p.kind,
        themes: p.themes,
        entityHints: p.entityHints.map((h: any) => ({
          key: h.key,
          name: h.name,
          role: h.role,
          expectedType: h.expectedType,
          required: h.required === true,
          evidenceKeys: Array.isArray(h.evidenceKeys) ? h.evidenceKeys : [],
        })),
        suggestedDurationMinutes: p.suggestedDurationMinutes,
        shortReason: p.shortReason,
        evidenceKeys: p.evidenceKeys,
      });
    }

    const evidenceList = searchResult?.evidence
      ? searchResult.evidence.filter((e) => evidenceKeys.includes(e.key))
      : undefined;

    return {
      proposals,
      provider: 'groq',
      model: this.model,
      groundingStatus: searchResult?.groundingStatus ?? 'unavailable',
      groundingProvider: searchResult?.provider,
      groundingModel: searchResult?.model,
      groundingEvidence: evidenceList,
      rawOutput: raw,
      validationErrors:
        validationErrors.length > 0 ? validationErrors : undefined,
    };
  }
}
