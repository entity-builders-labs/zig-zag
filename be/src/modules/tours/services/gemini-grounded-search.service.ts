import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import aiConfig from '@shared/ai/ai.config';
import { TavilyExtractService } from './tavily-extract.service';
import {
  ExperienceEvidenceProvenance,
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundingEvidence as GroundingEvidence,
} from '../interfaces/experience-grounding.interface';

// A raw extracted page can be tens of thousands of characters — cap what
// reaches the extractor's own prompt, matching the general size of a
// search-result snippet elsewhere in this codebase (TavilyGroundedSearchService
// passes through whatever Tavily's own basic-depth search already returns,
// itself a bounded excerpt, not a full page).
const MAX_SNIPPET_CHARS = 2000;

interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiGroundingSupport {
  segment?: { startIndex?: number; endIndex?: number; text?: string };
  groundingChunkIndices?: number[];
}

interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[];
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: GeminiGroundingMetadata;
  }>;
}

/**
 * Grounded search via Gemini's own `google_search` tool (native grounding),
 * as an alternative ExperienceGroundedSearchProvider to Tavily/SerpApi/Groq —
 * swap in tours.module.ts via GROUNDED_SEARCH_PROVIDER=gemini.
 *
 * Architectural note (the reason this file is more than "call Gemini,
 * return its text"): unlike Tavily, whose `content` field is the real
 * page's own text, Gemini's `groundingMetadata` ties its own *synthesized*
 * model_output to the real sources that back it (groundingChunks = sources,
 * groundingSupports = which segment of the synthesis each source backs) —
 * the evidence text itself is Gemini's paraphrase, not a literal quote.
 * Feeding a second LLM (the extractor) a first LLM's paraphrase risks
 * compounding a subtle misrepresentation that still cites a technically
 * real source. So this provider treats groundingChunks as *discovery of
 * real URLs* and recovers their actual content via TavilyExtractService
 * (a licensed extraction API, not a scraper of our own) before handing
 * anything to the extractor — only falling back to Gemini's own segment
 * text, explicitly marked evidenceQuality: 'reduced', when extraction
 * itself fails for a given URL.
 *
 * NOT live-verified this session: Gemini's API-key quota was exhausted
 * (both the AI-Studio free tier and, separately, a billing-linked project's
 * prepay credits) every time this was tested. The request/response shapes
 * below (tools: [{ google_search: {} }], candidates[].groundingMetadata.
 * {groundingChunks, groundingSupports}) are Gemini's own documented,
 * long-stable `generateContent` grounding contract — not invented — but
 * spot-check a real call before trusting this in production.
 */
@Injectable()
export class GeminiGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(GeminiGroundedSearchService.name);
  private readonly apiUrl =
    'https://generativelanguage.googleapis.com/v1beta/models';
  private readonly timeoutMs = 25000;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
    private readonly tavilyExtract: TavilyExtractService,
  ) {}

  private get model(): string {
    return this.config.geminiGroundedSearchModel;
  }

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const apiKey = this.config.discoveryExtractor.gemini.apiKey;
    if (!apiKey) {
      return {
        provider: 'gemini',
        model: this.model,
        groundingStatus: 'unavailable',
        evidence: [],
        failureReason: 'missing_gemini_api_key',
      };
    }

    const prompt = this.buildPrompt(request);
    try {
      const response = await this.callGenerateContent(apiKey, prompt);
      const candidate = response.candidates?.[0];
      const groundingMetadata = candidate?.groundingMetadata;
      const modelOutputText =
        candidate?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('\n')
          .trim() ?? '';

      const { evidence, evidenceProvenance } = await this.buildEvidence(
        groundingMetadata,
        modelOutputText,
      );

      return {
        provider: 'gemini',
        model: this.model,
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        evidenceProvenance,
        rawOutput: response,
      };
    } catch (error: any) {
      this.logger.error(`Gemini grounded search failed: ${error.message}`);
      return {
        provider: 'gemini',
        model: this.model,
        groundingStatus: 'failed',
        evidence: [],
        failureReason: error.message,
      };
    }
  }

  /**
   * Built from the request's own structured fields, not the flat keyword
   * `query` string ExperienceDiscoveryPlannerService builds for plain
   * search APIs — Gemini is an LLM, not a keyword search box, so it gets a
   * real instruction, matching the same "research real, named places;
   * never invent" discipline as the extraction prompts
   * (groq-discovery.provider.ts / gemini-discovery.provider.ts).
   */
  private buildPrompt(request: GroundedSearchRequest): string {
    const lines = [
      `Research real, named tourism experiences for this destination using web search.`,
      `Destination: ${request.destinationName}${request.destinationCountry ? `, ${request.destinationCountry}` : ''}`,
      `Themes: ${request.requestedThemes.join(', ') || 'none specified'}`,
    ];
    if (request.additionalPreferences) {
      lines.push(`Additional preferences: ${request.additionalPreferences}`);
    }
    if (request.query) {
      lines.push(`Focus search terms: ${request.query}`);
    }
    lines.push(
      'Only describe real, named, verifiable places or routes found via search.',
      'Do not invent names, coordinates, or details not supported by search results.',
    );
    return lines.join('\n');
  }

  private async callGenerateContent(
    apiKey: string,
    prompt: string,
  ): Promise<GeminiGenerateContentResponse> {
    const response = await fetch(
      `${this.apiUrl}/${this.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `Gemini generateContent error ${response.status}: ${errBody}`,
      );
    }

    return response.json();
  }

  private async buildEvidence(
    groundingMetadata: GeminiGroundingMetadata | undefined,
    modelOutputText: string,
  ): Promise<{
    evidence: GroundingEvidence[];
    evidenceProvenance: ExperienceEvidenceProvenance[];
  }> {
    const chunks = groundingMetadata?.groundingChunks ?? [];
    const supports = groundingMetadata?.groundingSupports ?? [];
    const searchQueries = groundingMetadata?.webSearchQueries ?? [];
    if (chunks.length === 0 || supports.length === 0) {
      return { evidence: [], evidenceProvenance: [] };
    }

    // Recover original content for every cited URL in one batched call —
    // TavilyExtractService itself dedups/caps/caches.
    const urls = chunks
      .map((chunk) => chunk.web?.uri)
      .filter((uri): uri is string => Boolean(uri));
    const extracted = await this.tavilyExtract.extract(urls);

    const evidence: GroundingEvidence[] = [];
    const evidenceProvenance: ExperienceEvidenceProvenance[] = [];
    let counter = 0;

    for (const [supportIndex, support] of supports.entries()) {
      const claimText = support.segment?.text?.trim();
      const chunkIndices = support.groundingChunkIndices ?? [];
      for (const chunkIndex of chunkIndices) {
        const chunk = chunks[chunkIndex];
        const url = chunk?.web?.uri;
        const title = chunk?.web?.title;
        const extractResult = url ? extracted.get(url) : undefined;
        counter += 1;
        const key = `ev-gemini-${counter}`;

        if (extractResult?.status === 'success' && extractResult.content) {
          evidence.push({
            key,
            source: title || url || 'gemini-google-search',
            snippet: extractResult.content.slice(0, MAX_SNIPPET_CHARS),
            title,
            url,
          });
          evidenceProvenance.push({
            provider: 'gemini-google-search',
            searchQueries,
            url,
            title,
            extractionProvider: 'tavily',
            extractionStatus: 'success',
            evidenceQuality: 'original_content',
            evidenceKeys: [key],
          });
        } else if (claimText) {
          // Fallback: extraction failed (or no URL) — use Gemini's own
          // synthesized segment text, explicitly marked lower confidence.
          // A failure here is never silent (rule: no quiet degradation) —
          // evidenceQuality: 'reduced' surfaces in the Bitácora precisely so
          // this is visible, not hidden behind a plausible-looking snippet.
          evidence.push({
            key,
            source: title || url || 'gemini-model-output',
            snippet: claimText.slice(0, MAX_SNIPPET_CHARS),
            title,
            url,
          });
          evidenceProvenance.push({
            provider: 'gemini-google-search',
            searchQueries,
            url,
            title,
            extractionProvider: 'gemini-model-output',
            extractionStatus: 'fallback',
            evidenceQuality: 'reduced',
            evidenceKeys: [key],
            groundingSupportIndices: [supportIndex],
          });
        } else {
          // Neither real content nor a usable claim segment — drop this
          // specific (support, chunk) pair rather than emit an empty
          // evidence entry; other pairs from the same response still count.
          counter -= 1;
        }
      }
    }

    if (evidence.length === 0 && modelOutputText) {
      // Grounding metadata was present but yielded nothing usable per-claim
      // (e.g. no groundingChunkIndices on any support) — fall back to the
      // whole model output as a single, explicitly reduced-confidence
      // evidence item rather than reporting no evidence at all when Gemini
      // did produce a grounded answer.
      const key = 'ev-gemini-fallback-1';
      evidence.push({
        key,
        source: 'gemini-model-output',
        snippet: modelOutputText.slice(0, MAX_SNIPPET_CHARS),
      });
      evidenceProvenance.push({
        provider: 'gemini-google-search',
        searchQueries,
        extractionProvider: 'gemini-model-output',
        extractionStatus: 'fallback',
        evidenceQuality: 'reduced',
        evidenceKeys: [key],
      });
    }

    return { evidence, evidenceProvenance };
  }
}
