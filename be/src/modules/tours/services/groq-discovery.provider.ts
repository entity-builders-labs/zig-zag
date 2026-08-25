import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '@shared/ai/langchain.service';
import {
  DiscoveryRequest,
  DiscoveryResponse,
  SearchGroundedDiscoveryProvider,
  ActivityProposal,
  ProposalKind,
} from '../interfaces/activity-discovery.interface';

const VALID_KINDS: ProposalKind[] = [
  'POI',
  'ROUTE',
  'AREA',
  'NEIGHBORHOOD_WALK',
  'EXPERIENCE',
];

const SYSTEM_PROMPT = `You are a travel discovery agent. Your job is to propose specific, real places and experiences in a destination based on the user's interests and specific coverage gaps.

Return ONLY valid JSON. Your response must be a JSON object with a "proposals" array.

Each proposal must have:
  - name (string): specific real place or experience
  - kind (string): one of POI, ROUTE, AREA, NEIGHBORHOOD_WALK, EXPERIENCE
  - themes (string[]): which themes this proposal covers
  - entityHints (array): at least one hint with {key, name, role, expectedType}
  - suggestedDurationMinutes (number): estimated duration in minutes
  - shortReason (string): why this proposal fits the requested themes
  - groundingEvidence (array): at least one with {source, snippet, url?}

Constraints:
- POI = a single point of interest (museum, park, restaurant, landmark)
- NEIGHBORHOOD_WALK = walkable route through a neighborhood
- ROUTE = path or trail with specific route geometry
- EXPERIENCE = multi-part activity spanning time or locations
- AREA = neighborhood or district worth exploring
- Be specific, use real place names. No chains or franchises.
- Every proposal must have at least one piece of groundingEvidence with a real source.
- Max 8 proposals.
- Only propose places that are likely real and verifiable.`;

@Injectable()
export class GroqDiscoveryProvider implements SearchGroundedDiscoveryProvider {
  private readonly logger = new Logger(GroqDiscoveryProvider.name);

  constructor(private readonly langChainService: LangChainService) {}

  async discover(request: DiscoveryRequest): Promise<DiscoveryResponse> {
    const userPrompt = this.buildUserPrompt(request);
    const maxProposals = Math.min(request.maxProposals || 8, 8);

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
        model: 'openai/gpt-oss-120b',
        rawOutput: raw,
        validationErrors: ['Failed to parse JSON response'],
      };
    }

    const rawProposals: any[] = parsed.proposals || [];
    const proposals: ActivityProposal[] = [];
    const validationErrors: string[] = [];

    for (let i = 0; i < Math.min(rawProposals.length, maxProposals); i++) {
      const p = rawProposals[i];
      const errors = this.validateProposal(p);
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
        })),
        suggestedDurationMinutes: p.suggestedDurationMinutes,
        shortReason: p.shortReason,
        groundingEvidence: p.groundingEvidence.map((e: any) => ({
          source: e.source,
          snippet: e.snippet,
          url: e.url,
        })),
      });
    }

    return {
      proposals,
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      rawOutput: raw,
      validationErrors:
        validationErrors.length > 0 ? validationErrors : undefined,
    };
  }

  private buildUserPrompt(request: DiscoveryRequest): string {
    const deficitsText =
      request.mode.type === 'gap_fill' && request.mode.deficits.length > 0
        ? `\nSpecific coverage gaps to fill:\n${request.mode.deficits.map((d) => `  - ${d.message}`).join('\n')}`
        : request.mode.type === 'bootstrap'
          ? '\nThis is a new destination with no existing catalog data. Propose a complete set of must-see places and experiences.'
          : '';

    return `Destination: ${request.destinationName}${request.destinationCountry ? `, ${request.destinationCountry}` : ''}
Requested themes: ${request.requestedThemes.join(', ')}${deficitsText}

Propose up to ${request.maxProposals} real, specific places and experiences in ${request.destinationName} that cover the requested themes and fill the gaps.

Return ONLY valid JSON.`;
  }

  private validateProposal(p: any): string[] {
    const errors: string[] = [];
    if (!p || typeof p.name !== 'string' || !p.name.trim()) {
      errors.push('missing or invalid name');
      return errors;
    }
    if (!VALID_KINDS.includes(p.kind)) errors.push(`invalid kind: "${p.kind}"`);
    if (!Array.isArray(p.themes) || p.themes.length === 0)
      errors.push('missing themes');
    if (!Array.isArray(p.entityHints) || p.entityHints.length === 0)
      errors.push('missing entityHints');
    if (
      typeof p.suggestedDurationMinutes !== 'number' ||
      p.suggestedDurationMinutes <= 0
    ) {
      errors.push('invalid suggestedDurationMinutes');
    }
    if (typeof p.shortReason !== 'string' || !p.shortReason.trim())
      errors.push('missing shortReason');
    if (
      !Array.isArray(p.groundingEvidence) ||
      p.groundingEvidence.length === 0
    ) {
      errors.push('missing groundingEvidence');
    }
    return errors;
  }
}
