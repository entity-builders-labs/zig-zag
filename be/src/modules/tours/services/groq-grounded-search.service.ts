import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
  ExperienceGroundingEvidence as GroundingEvidence,
} from '../interfaces/experience-grounding.interface';

/** Browser search citation marker: 【N†LN-LN】 */
const CITATION_RE = /【(\d+)†L\d+-L\d+】/g;

@Injectable()
export class GroqGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(GroqGroundedSearchService.name);
  private readonly apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly model = 'openai/gpt-oss-120b';

  constructor(private readonly config: ConfigService) {}

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const groqApiKey =
      this.config.get<string>('ai.groqApiKey') || process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return {
        provider: 'groq',
        model: this.model,
        groundingStatus: 'unavailable',
        evidence: [],
        failureReason: 'missing_groq_api_key',
      };
    }

    const userMessage = this.buildSearchQuery(request);

    try {
      this.logger.debug(`Browser search for: ${request.destinationName}`);
      const start = Date.now();

      const resp = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: userMessage }],
          tools: [{ type: 'browser_search' as const }],
          tool_choice: 'required' as const,
          temperature: 0,
          max_completion_tokens: 4096,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        this.logger.error(
          `Groq browser search error ${resp.status}: ${errBody}`,
        );
        return {
          provider: 'groq',
          model: this.model,
          groundingStatus: 'failed',
          evidence: [],
          failureReason: `groq_error_${resp.status}`,
          rawOutput: errBody,
        };
      }

      const data = await resp.json();
      const content: string = data.choices?.[0]?.message?.content || '';
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.debug(
        `Browser search completed in ${elapsed}s, ${content.length} chars`,
      );

      if (!content.trim()) {
        return {
          provider: 'groq',
          model: this.model,
          groundingStatus: 'no_usable_evidence',
          evidence: [],
          rawOutput: data,
        };
      }

      const evidence = this.extractEvidence(content);

      return {
        provider: 'groq',
        model: this.model,
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        rawOutput: data,
      };
    } catch (error: any) {
      this.logger.error(`Groq browser search failed: ${error.message}`);
      return {
        provider: 'groq',
        model: this.model,
        groundingStatus: 'failed',
        evidence: [],
        failureReason: error.message,
      };
    }
  }

  private buildSearchQuery(request: GroundedSearchRequest): string {
    return request.query?.trim() || [
      request.destinationName,
      ...request.requestedThemes,
      request.additionalPreferences,
      'real tourism experiences and attractions',
    ].filter(Boolean).join(' ');
  }

  /**
   * Extracts GroundingEvidence from browser search response text by
   * splitting around citation markers. Each unique citation number
   * becomes its own evidence entry with approximately 300 chars
   * of surrounding context.
   */
  private extractEvidence(content: string): GroundingEvidence[] {
    const seen = new Set<number>();
    const evidence: GroundingEvidence[] = [];
    let match: RegExpExecArray | null;

    // Reset regex
    CITATION_RE.lastIndex = 0;

    // Collect all citation positions
    const hits: { num: number; pos: number }[] = [];
    while ((match = CITATION_RE.exec(content)) !== null) {
      hits.push({ num: parseInt(match[1], 10), pos: match.index });
    }

    for (const hit of hits) {
      if (seen.has(hit.num)) continue;
      seen.add(hit.num);

      // Extract ~300 chars around the citation
      const start = Math.max(0, hit.pos - 100);
      const end = Math.min(content.length, hit.pos + 200);
      const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();

      if (snippet.length < 20) continue;

      evidence.push({
        key: `ev-${hit.num}`,
        source: `groq-browser-search:${hit.num}`,
        snippet,
      });
    }

    // If no citation markers found, treat the entire content as one evidence block
    if (evidence.length === 0 && content.trim().length > 0) {
      evidence.push({
        key: 'ev-1',
        source: 'groq-browser-search',
        snippet: content.slice(0, 2000).replace(/\s+/g, ' ').trim(),
      });
    }

    return evidence;
  }
}
