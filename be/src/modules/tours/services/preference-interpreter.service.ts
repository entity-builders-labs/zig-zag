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
import { AnchoredPlace } from '../interfaces/preference-spec.interface';

/** Conservative cap on extracted named anchors per request (plan Task A2). */
const MAX_ANCHORED_PLACES = 5;

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
Also output anchoredPlaces: concrete named places/areas/routes the user explicitly mentioned by
name (never a generic theme). For each, output:
- rawName: the name as mentioned by the user.
- kind: "venue" | "area" | "route" | "unknown".
- priority: "must" ONLY for explicit, unambiguous named-place intent, for example
  "quiero visitar X", "incluí X", "sí o sí quiero ir a X", "no me quiero perder X".
  Anything weaker or ambiguous -- including a place mentioned only in passing while
  describing a theme, e.g. "me interesa la arquitectura de X" -- is priority "soft".
Extract anchors conservatively: when in doubt about the name or the intent, omit the anchor
rather than guessing. Do not invent named places that were not mentioned.
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

const ANCHORED_PLACE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rawName: { type: 'string' },
    kind: { type: 'string', enum: ['venue', 'area', 'route', 'unknown'] },
    priority: { type: 'string', enum: ['soft', 'must'] },
  },
  required: ['rawName', 'kind', 'priority'],
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    preferredFacets: {
      type: 'array',
      items: PREFERRED_FACET_SCHEMA,
    },
    anchoredPlaces: {
      type: 'array',
      items: ANCHORED_PLACE_SCHEMA,
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
    'anchoredPlaces',
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
  anchoredPlaces: [],
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

function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

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
      const parsed = this.normalize(parseModelJson(rawResponse));
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
      anchoredPlaces: this.normalizeAnchors(value?.anchoredPlaces),
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

      if (
        typeof item.dimension !== 'string' ||
        item.dimension.trim().length === 0
      ) {
        continue;
      }

      const rawDim = item.dimension.trim().toLowerCase();

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

  /**
   * Normalizes raw LLM-emitted anchored places (plan Task A2 / spec §4, D3).
   * Degrades malformed input safely: unknown `kind` values fall back to
   * `'unknown'`, unknown/missing `priority` falls back to `'soft'` (never
   * `'must'`), blank/non-string names are dropped, and the result is capped
   * conservatively. The LLM emits `priority` directly per the prompt rule;
   * this method only validates/defaults it -- it never re-derives priority
   * from the raw text.
   */
  private normalizeAnchors(rawAnchors: unknown): AnchoredPlace[] {
    if (!Array.isArray(rawAnchors)) {
      return [];
    }

    const validKinds: AnchoredPlace['kind'][] = [
      'venue',
      'area',
      'route',
      'unknown',
    ];
    const validPriorities: AnchoredPlace['priority'][] = ['soft', 'must'];

    const anchors: AnchoredPlace[] = [];

    for (const item of rawAnchors) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const rawName =
        typeof (item as any).rawName === 'string'
          ? (item as any).rawName.trim()
          : '';
      if (!rawName) {
        continue;
      }

      const rawKind = (item as any).kind;
      const kind: AnchoredPlace['kind'] = validKinds.includes(rawKind)
        ? rawKind
        : 'unknown';

      const rawPriority = (item as any).priority;
      const priority: AnchoredPlace['priority'] = validPriorities.includes(
        rawPriority,
      )
        ? rawPriority
        : 'soft';

      anchors.push({ rawName, kind, priority });
    }

    return anchors.slice(0, MAX_ANCHORED_PLACES);
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
