import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '@shared/ai/langchain.service';
import { redactTracePayload } from '../utils/trace-redaction.util';
import {
  NormalizedPreferenceIntent,
  FacetNormalizationDecision,
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
- Map history to theme and walk to intent. nature_type is only for mountain, forest, coast, river, desert, or park. local_character is only for authentic, residential, traditional, or contemporary. A named neighborhood such as San Telmo is an anchor, not local_character.
- confidence: float between 0 and 1 indicating certainty.
- strength: "strong" | "medium" | "weak" indicating user emphasis.
Do not invent arbitrary importance numbers; code derives importance deterministically from strength.
Also output anchoredPlaces: concrete named places/areas/routes the user explicitly mentioned by
name (never a generic theme). For each, output:
- rawName: the name as mentioned by the user.
- usage: "geographic_scope" | "specific_destination" | "named_path" | "unknown". This describes how the phrase uses the name, not what geographic entity it is.
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
    usage: {
      type: 'string',
      enum: [
        'geographic_scope',
        'specific_destination',
        'named_path',
        'unknown',
      ],
    },
    priority: { type: 'string', enum: ['soft', 'must'] },
  },
  required: ['rawName', 'usage', 'priority'],
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
          facetNormalizationDecisions: [],
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
      const normalized = this.normalize(JSON.parse(rawResponse));
      const parsed = normalized.intent;
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
          facetNormalizationDecisions: normalized.facetNormalizationDecisions,
          validationErrors: [],
          status: 'applied',
          durationMs: Date.now() - startedAt,
        }),
      };
    } catch (error: any) {
      const fallbackResult = this.fallback(userPrompt);
      const fallback = fallbackResult.intent;
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
          facetNormalizationDecisions:
            fallbackResult.facetNormalizationDecisions,
          validationErrors: [error.message || 'interpretation_failed'],
          status: 'fallback',
          durationMs: Date.now() - startedAt,
        }),
      };
    }
  }

  private normalize(value: any): {
    intent: NormalizedPreferenceIntent;
    facetNormalizationDecisions: FacetNormalizationDecision[];
  } {
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20)
        : [];

    const facetResult = this.normalizeFacetsWithDecisions(
      value?.preferredFacets,
    );
    return {
      intent: {
        preferredFacets: facetResult.facets,
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
      },
      facetNormalizationDecisions: facetResult.decisions,
    };
  }

  private normalizeFacets(rawFacets: unknown): PreferenceFacet[] {
    return this.normalizeFacetsWithDecisions(rawFacets).facets;
  }

  private normalizeFacetsWithDecisions(rawFacets: unknown): {
    facets: PreferenceFacet[];
    decisions: FacetNormalizationDecision[];
  } {
    if (!Array.isArray(rawFacets)) {
      return { facets: [], decisions: [] };
    }

    const merged = new Map<string, PreferenceFacet>();
    const decisions: FacetNormalizationDecision[] = [];
    const inferableDimensions = [
      'theme',
      'intent',
      'winery_scale',
      'tourism_intensity',
      'nature_type',
      'local_character',
    ];

    for (const item of rawFacets) {
      if (!item || typeof item !== 'object') {
        decisions.push({
          rawDimension:
            typeof item.dimension === 'string' ? item.dimension : '',
          rawKey: '',
          accepted: false,
          reason: 'UNKNOWN_DIMENSION',
        });
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
        decisions.push({
          rawDimension: rawDim,
          rawKey:
            typeof item.key === 'string' ? item.key.trim().toLowerCase() : '',
          accepted: false,
          reason: 'DORMANT_DIMENSION',
        });
        continue;
      }

      const rawKey =
        typeof item.key === 'string' ? item.key.trim().toLowerCase() : '';
      if (!rawKey) {
        decisions.push({
          rawDimension: rawDim,
          rawKey,
          accepted: false,
          reason: 'UNKNOWN_KEY',
        });
        continue;
      }

      let normalizedDim = rawDim;
      let canonicalKey = canonicalizeFacetKey(rawDim, rawKey);
      let reason: FacetNormalizationDecision['reason'] = 'VALID_AS_EMITTED';
      if (!canonicalKey) {
        const owners = inferableDimensions.filter((dimension) =>
          canonicalizeFacetKey(dimension, rawKey),
        );
        if (owners.length === 1) {
          normalizedDim = owners[0];
          canonicalKey = canonicalizeFacetKey(normalizedDim, rawKey);
          reason = 'REPAIRED_UNIQUE_VOCABULARY_MATCH';
        } else {
          decisions.push({
            rawDimension: rawDim,
            rawKey,
            accepted: false,
            reason:
              owners.length > 1
                ? 'AMBIGUOUS_CROSS_DIMENSION_KEY'
                : 'UNKNOWN_KEY',
          });
          continue;
        }
      }
      decisions.push({
        rawDimension: rawDim,
        rawKey,
        normalizedDimension: normalizedDim,
        normalizedKey: canonicalKey,
        accepted: true,
        reason,
      });

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
      const compoundKey = `${normalizedDim}:${canonicalKey}`;

      if (!merged.has(compoundKey)) {
        merged.set(compoundKey, {
          dimension: normalizedDim,
          key: canonicalKey,
          importance,
          confidence,
          source: 'free_text',
        });
      }
    }

    return { facets: Array.from(merged.values()), decisions };
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

      // The model may emit the historical kind field, but it is deliberately
      // discarded here. Geographic reality belongs to GeoEntity resolution.
      const kind: AnchoredPlace['kind'] = 'unknown';

      const validUsages: AnchoredPlace['usage'][] = [
        'geographic_scope',
        'specific_destination',
        'named_path',
        'unknown',
      ];
      const usage: AnchoredPlace['usage'] = validUsages.includes(
        (item as any).usage,
      )
        ? (item as any).usage
        : 'unknown';

      const rawPriority = (item as any).priority;
      const priority: AnchoredPlace['priority'] = validPriorities.includes(
        rawPriority,
      )
        ? rawPriority
        : 'soft';

      anchors.push({ rawName, usage, kind, priority });
    }

    return anchors.slice(0, MAX_ANCHORED_PLACES);
  }

  private fallback(text: string): {
    intent: NormalizedPreferenceIntent;
    facetNormalizationDecisions: FacetNormalizationDecision[];
  } {
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

    const facetResult = this.normalizeFacetsWithDecisions(rawFallbackFacets);
    const preferredFacets = facetResult.facets;

    const positiveSemanticQuery = text
      .replace(/\b(no quiero|sin|evitar|evito)\b[^,.!?;]*/gi, '')
      .trim();

    return {
      intent: {
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
      },
      facetNormalizationDecisions: facetResult.decisions,
    };
  }
}
