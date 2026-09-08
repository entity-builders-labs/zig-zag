import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '@shared/ai/langchain.service';
import { redactTracePayload } from '../utils/trace-redaction.util';
import {
  NormalizedPreferenceIntent,
  PreferenceInterpretationTrace,
} from '../interfaces/preference-interpretation.interface';
import {
  InterpretedPreferenceFacet,
  mapStrengthToImportance,
  PreferenceFacet,
  PreferenceFacetStrength,
} from '../preferences/preference-facet.interface';
import { canonicalizeFacetKey } from '../preferences/preference-facet-vocabulary';

const SYSTEM_PROMPT = `Interpret the user's supplemental tourism preferences into normalized intent.
Return JSON only. You interpret language; deterministic code enforces the result.
Never invent geographic entities, provider IDs, coordinates, or evidence.
Do not turn ambiguity into a hard rule. Preserve uncertainty in ambiguities.
For positive preferences, output preferredFacets as a list of objects with:
- dimension: active dimension name (theme, trait, intent, winery_scale, tourism_intensity, nature_type, local_character). Do NOT output exploration_style.
- key: CANONICAL domain key in English (e.g. "architecture" not "arquitectura", "food" not "comida", "walk" not "caminata", "history" not "historia").
- confidence: float between 0 and 1 indicating certainty.
- strength: "strong" | "medium" | "weak" indicating user emphasis.
Do not invent arbitrary importance numbers; code derives importance deterministically from strength.
Other fields: excludedThemes, excludedTraits, hardExclusions, softConstraints, ambiguities,
dietaryPreferences, accessibilityPreferences, budgetPreferences, groupPreferences,
positiveSemanticQuery, notes. Use short lowercase phrases.`;

const STRING_ARRAY = { type: 'array', items: { type: 'string' } };

const PREFERRED_FACET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    key: { type: 'string' },
    confidence: { type: 'number' },
    strength: { type: 'string', enum: ['strong', 'medium', 'weak'] },
  },
  required: ['dimension', 'key', 'confidence'],
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    preferredFacets: {
      type: 'array',
      items: PREFERRED_FACET_SCHEMA,
    },
    excludedThemes: STRING_ARRAY,
    excludedTraits: STRING_ARRAY,
    hardExclusions: STRING_ARRAY,
    softConstraints: STRING_ARRAY,
    ambiguities: STRING_ARRAY,
    dietaryPreferences: STRING_ARRAY,
    accessibilityPreferences: STRING_ARRAY,
    budgetPreferences: STRING_ARRAY,
    groupPreferences: STRING_ARRAY,
    positiveSemanticQuery: { type: 'string' },
    notes: STRING_ARRAY,
  },
  required: [
    'preferredFacets',
    'excludedThemes',
    'excludedTraits',
    'hardExclusions',
    'softConstraints',
    'ambiguities',
    'dietaryPreferences',
    'accessibilityPreferences',
    'budgetPreferences',
    'groupPreferences',
    'positiveSemanticQuery',
    'notes',
  ],
};

const EMPTY_INTENT: NormalizedPreferenceIntent = {
  preferredFacets: [],
  excludedThemes: [],
  excludedTraits: [],
  hardExclusions: [],
  softConstraints: [],
  ambiguities: [],
  dietaryPreferences: [],
  accessibilityPreferences: [],
  budgetPreferences: [],
  groupPreferences: [],
  positiveSemanticQuery: '',
  notes: [],
};

@Injectable()
export class PreferenceInterpreterService {
  private readonly logger = new Logger(PreferenceInterpreterService.name);

  constructor(private readonly langChainService: LangChainService) {}

  private providerMetadata() {
    return this.langChainService.getProviderMetadata?.() ?? {};
  }

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
          ...this.providerMetadata(),
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
          ...this.providerMetadata(),
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
      preferredFacets: this.normalizeFacets(value?.preferredFacets),
      excludedThemes: list(value?.excludedThemes),
      excludedTraits: list(value?.excludedTraits),
      hardExclusions: list(value?.hardExclusions),
      softConstraints: list(value?.softConstraints),
      ambiguities: list(value?.ambiguities),
      dietaryPreferences: list(value?.dietaryPreferences),
      accessibilityPreferences: list(value?.accessibilityPreferences),
      budgetPreferences: list(value?.budgetPreferences),
      groupPreferences: list(value?.groupPreferences),
      positiveSemanticQuery:
        typeof value?.positiveSemanticQuery === 'string'
          ? value.positiveSemanticQuery.trim().slice(0, 500)
          : '',
      notes: list(value?.notes),
    };
  }

  private normalizeFacets(rawFacets: unknown): PreferenceFacet[] {
    if (!Array.isArray(rawFacets)) {
      return [];
    }

    const merged = new Map<string, PreferenceFacet>();

    for (const item of rawFacets) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const rawDim =
        typeof item.dimension === 'string' && item.dimension.trim().length > 0
          ? item.dimension.trim().toLowerCase()
          : 'theme';

      // exploration_style is dormant in Phase 2
      if (rawDim === 'exploration_style') {
        continue;
      }

      const rawKey =
        typeof item.key === 'string' ? item.key.trim().toLowerCase() : '';
      if (!rawKey) {
        continue;
      }

      const canonicalKey = canonicalizeFacetKey(rawDim, rawKey);
      if (!canonicalKey) {
        continue;
      }

      const rawConfidence =
        typeof item.confidence === 'number' && !Number.isNaN(item.confidence)
          ? item.confidence
          : 0.7;
      const confidence = Math.max(0, Math.min(1, rawConfidence));

      const validStrengths: PreferenceFacetStrength[] = [
        'strong',
        'medium',
        'weak',
      ];
      const strength: PreferenceFacetStrength | undefined =
        validStrengths.includes(item.strength) ? item.strength : undefined;

      const importance = mapStrengthToImportance(strength);
      const compoundKey = `${rawDim}:${canonicalKey}`;

      if (!merged.has(compoundKey)) {
        merged.set(compoundKey, {
          dimension: rawDim,
          key: canonicalKey,
          importance,
          confidence,
          source: 'free_text',
        });
      }
    }

    return Array.from(merged.values());
  }

  private fallback(text: string): NormalizedPreferenceIntent {
    const lower = text.toLowerCase();
    const excludedThemes: string[] = [];
    const excludedTraits: string[] = [];
    const hardExclusions: string[] = [];
    const dietaryPreferences: string[] = [];
    const accessibilityPreferences: string[] = [];
    const budgetPreferences: string[] = [];
    const groupPreferences: string[] = [];

    if (
      /(no quiero|sin|evitar|evito)[^,.!?;]*(religios|iglesia|templo|mezquita|catedral)/.test(
        lower,
      )
    ) {
      excludedThemes.push('religion');
      hardExclusions.push('religion');
    }
    if (/vegana|vegano|vegan/.test(lower)) {
      dietaryPreferences.push('vegan');
      hardExclusions.push('non-vegan food');
    }
    if (
      /silla de ruedas|wheelchair|movilidad reducida|sin escaleras|accesible/.test(
        lower,
      )
    ) {
      accessibilityPreferences.push('accessibility');
    }
    if (/barato|economico|económico|low budget|budget/.test(lower)) {
      budgetPreferences.push('low budget');
    }
    if (/niños|ninos|kids|chicos|familia/.test(lower)) {
      groupPreferences.push('family friendly');
    }

    // Free text keywords mapped into candidate InterpretedPreferenceFacet objects
    const candidateKeywords = [
      { trigger: 'arquitectura', dimension: 'theme', rawKey: 'architecture' },
      { trigger: 'comida', dimension: 'theme', rawKey: 'food' },
      { trigger: 'gastronomia', dimension: 'theme', rawKey: 'gastronomy' },
      { trigger: 'gastronomía', dimension: 'theme', rawKey: 'gastronomy' },
      { trigger: 'naturaleza', dimension: 'theme', rawKey: 'nature' },
      { trigger: 'cultura', dimension: 'theme', rawKey: 'culture' },
      { trigger: 'arte', dimension: 'theme', rawKey: 'art' },
      { trigger: 'historia', dimension: 'theme', rawKey: 'history' },
      { trigger: 'tango', dimension: 'theme', rawKey: 'tango' },
      { trigger: 'vino', dimension: 'theme', rawKey: 'wine' },
      { trigger: 'bodega', dimension: 'theme', rawKey: 'wine' },
      { trigger: 'caminata', dimension: 'intent', rawKey: 'walk' },
      { trigger: 'caminar', dimension: 'intent', rawKey: 'walk' },
    ];

    const rawFallbackFacets: InterpretedPreferenceFacet[] = [];
    for (const kw of candidateKeywords) {
      if (lower.includes(kw.trigger)) {
        rawFallbackFacets.push({
          dimension: kw.dimension,
          key: kw.rawKey,
          confidence: 0.9,
          strength: 'strong',
        });
      }
    }

    const preferredFacets = this.normalizeFacets(rawFallbackFacets);

    const positiveSemanticQuery = text
      .replace(/\b(no quiero|sin|evitar|evito)\b[^,.!?;]*/gi, '')
      .trim();

    return {
      ...EMPTY_INTENT,
      preferredFacets,
      excludedThemes,
      excludedTraits,
      hardExclusions,
      dietaryPreferences,
      accessibilityPreferences,
      budgetPreferences,
      groupPreferences,
      positiveSemanticQuery,
      notes: ['deterministic_fallback'],
    };
  }
}
