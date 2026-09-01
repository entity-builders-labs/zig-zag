import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '@shared/ai/langchain.service';
import { redactTracePayload } from '../utils/trace-redaction.util';
import {
  NormalizedPreferenceIntent,
  PreferenceInterpretationTrace,
} from '../interfaces/preference-interpretation.interface';

const SYSTEM_PROMPT = `Interpret the user's supplemental tourism preferences into normalized intent.
Return JSON only. You interpret language; deterministic code enforces the result.
Never invent geographic entities, provider IDs, coordinates, or evidence.
Fields: preferredThemes, preferredTraits, excludedThemes, excludedTraits,
hardExclusions, positiveSemanticQuery, notes. Use short lowercase phrases.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    preferredThemes: { type: 'array', items: { type: 'string' } },
    preferredTraits: { type: 'array', items: { type: 'string' } },
    excludedThemes: { type: 'array', items: { type: 'string' } },
    excludedTraits: { type: 'array', items: { type: 'string' } },
    hardExclusions: { type: 'array', items: { type: 'string' } },
    positiveSemanticQuery: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'preferredThemes',
    'preferredTraits',
    'excludedThemes',
    'excludedTraits',
    'hardExclusions',
    'positiveSemanticQuery',
    'notes',
  ],
};

const EMPTY_INTENT: NormalizedPreferenceIntent = {
  preferredThemes: [],
  preferredTraits: [],
  excludedThemes: [],
  excludedTraits: [],
  hardExclusions: [],
  positiveSemanticQuery: '',
  notes: [],
};

@Injectable()
export class PreferenceInterpreterService {
  private readonly logger = new Logger(PreferenceInterpreterService.name);

  constructor(private readonly langChainService: LangChainService) {}

  async interpret(text?: string): Promise<{
    intent: NormalizedPreferenceIntent;
    trace: PreferenceInterpretationTrace;
  }> {
    const userPrompt = text?.trim() || '';
    const startedAt = Date.now();
    if (!userPrompt) {
      return {
        intent: EMPTY_INTENT,
        trace: {
          stage: 'preference_interpretation',
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          responseSchema: RESPONSE_SCHEMA,
          parsedResponse: EMPTY_INTENT,
          validationErrors: [],
          status: 'skipped',
          durationMs: 0,
        },
      };
    }

    try {
      const rawResponse = await this.langChainService.generateChatResponse(
        SYSTEM_PROMPT,
        userPrompt,
        {},
        { responseFormat: { type: 'json_object' } },
      );
      const parsed = this.normalize(JSON.parse(rawResponse));
      return {
        intent: parsed,
        trace: redactTracePayload({
          stage: 'preference_interpretation',
          provider: (this.langChainService as any).config?.provider,
          model: (this.langChainService as any).config?.defaultModel,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          responseSchema: RESPONSE_SCHEMA,
          rawResponse,
          parsedResponse: parsed,
          validationErrors: [],
          status: 'applied',
          durationMs: Date.now() - startedAt,
        }),
      };
    } catch (error: any) {
      const fallback = this.fallback(userPrompt);
      this.logger.warn(`Preference interpretation fallback: ${error.message}`);
      return {
        intent: fallback,
        trace: redactTracePayload({
          stage: 'preference_interpretation',
          provider: (this.langChainService as any).config?.provider,
          model: (this.langChainService as any).config?.defaultModel,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          responseSchema: RESPONSE_SCHEMA,
          parsedResponse: fallback,
          validationErrors: [error.message || 'interpretation_failed'],
          status: 'fallback',
          durationMs: Date.now() - startedAt,
        }),
      };
    }
  }

  private normalize(value: any): NormalizedPreferenceIntent {
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20)
        : [];
    return {
      preferredThemes: list(value?.preferredThemes),
      preferredTraits: list(value?.preferredTraits),
      excludedThemes: list(value?.excludedThemes),
      excludedTraits: list(value?.excludedTraits),
      hardExclusions: list(value?.hardExclusions),
      positiveSemanticQuery:
        typeof value?.positiveSemanticQuery === 'string'
          ? value.positiveSemanticQuery.trim().slice(0, 500)
          : '',
      notes: list(value?.notes),
    };
  }

  private fallback(text: string): NormalizedPreferenceIntent {
    const lower = text.toLowerCase();
    const excludedThemes: string[] = [];
    const excludedTraits: string[] = [];
    if (/religios|iglesia|templo|mezquita|sin culto/.test(lower))
      excludedThemes.push('religion');
    if (/vegana|vegano|vegan/.test(lower))
      excludedTraits.push('non-vegan food');
    const preferredThemes = [
      'arquitectura',
      'comida',
      'naturaleza',
      'cultura',
      'arte',
      'historia',
    ].filter((theme) => lower.includes(theme));
    const positiveSemanticQuery = text
      .replace(/\b(no quiero|sin|evitar|evito)\b[^,.!?;]*/gi, '')
      .trim();
    return {
      ...EMPTY_INTENT,
      preferredThemes,
      excludedThemes,
      excludedTraits,
      hardExclusions: [...excludedThemes, ...excludedTraits],
      positiveSemanticQuery,
      notes: ['deterministic_fallback'],
    };
  }
}
