import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '@shared/ai/langchain.service';
import { redactTracePayload } from '../utils/trace-redaction.util';
import {
  NormalizedPreferenceIntent,
  FacetNormalizationDecision,
  PreferenceInterpretationTrace,
} from '../interfaces/preference-interpretation.interface';
import {
  mapStrengthToImportance,
  PreferenceAssertion,
  PreferenceConstraint,
  PreferenceEvidence,
  PreferencePolarity,
  PreferenceProvenance,
  PreferenceStrength,
  dedupeAssertions,
  UnresolvedPreferenceConcept,
} from '../preferences/preference-assertion.interface';
import {
  ASSERTION_TARGET_DIMENSIONS,
  AssertionTargetDimension,
  canonicalTargetKey,
  INITIAL_DIMENSION_VOCABULARY,
} from '../preferences/preference-facet-vocabulary';
import { InterpretedAnchor } from '../interfaces/preference-spec.interface';
import { containsTokenBoundedSpan } from '../utils/token-bounded-span.util';

/** Conservative cap on extracted named anchors per request (plan Task A2). */
const MAX_ANCHORED_PLACES = 5;

/** The typed targets the extractor may assert, rendered from the schema. */
const TARGET_SCHEMA_TEXT = ASSERTION_TARGET_DIMENSIONS.map(
  (dimension) =>
    `- ${dimension}: ${INITIAL_DIMENSION_VOCABULARY[dimension].join(', ')}`,
).join('\n');

const SYSTEM_PROMPT = `Interpret the user's supplemental tourism preferences into typed assertions.
Return JSON only. You interpret language; deterministic code only validates the result.
Never invent geographic entities, provider IDs, coordinates, or evidence.
Do not turn ambiguity into a hard rule. Preserve uncertainty in ambiguities.

assertions: one object per preference that maps to a typed target below, with:
- dimension and key: exactly one of these typed targets (use the key as written):
${TARGET_SCHEMA_TEXT}
- polarity: "INCLUDE" when the user wants it, "EXCLUDE" when the user does not want it
  (e.g. "no me interesa la arquitectura" is EXCLUDE architecture, never INCLUDE).
- constraint: "HARD" only when the user states a requirement or prohibition that must be
  guaranteed (e.g. a dietary need, "nada de X"); otherwise "SOFT".
- provenance: "DIRECT" when the user explicitly expressed this concept in their own words;
  "INFERRED" when you derived it (generalization, entity knowledge, interpretation).
- strength: "strong" | "medium" | "weak", the user's emphasis.
- confidence: 0..1, how sure you are of this interpretation.
- evidence: one or more excerpts copied verbatim from the user's text that support it.
  Never invent evidence; assertions without verbatim evidence are rejected.

unresolvedConcepts: preferences you understood that match no typed target above
(e.g. a quiet atmosphere, a kind of place not listed). For each: label (a short English
description), polarity, constraint, evidence (verbatim excerpts). Do not force them into
a typed target.

anchoredPlaces: concrete named places/areas/routes the user explicitly mentioned by
name (never a generic theme). For each, output:
- rawName: the name as mentioned by the user.
- usage: "geographic_scope" | "specific_destination" | "named_path" | "unknown". This describes how the phrase uses the name, not what geographic entity it is.
- priority: "must" ONLY for explicit, unambiguous named-place intent, for example
  "quiero visitar X", "incluí X", "sí o sí quiero ir a X", "no me quiero perder X".
  Anything weaker or ambiguous -- including a place mentioned only in passing while
  describing a theme, e.g. "me interesa la arquitectura de X" -- is priority "soft".
Extract anchors conservatively: when in doubt about the name or the intent, omit the anchor
rather than guessing. Do not invent named places that were not mentioned.

Other fields: softConstraints, ambiguities, budgetPreferences,
groupPreferences, positiveSemanticQuery (the positive interests only), notes.
Use short lowercase phrases.`;

const STRING_ARRAY = { type: 'array', items: { type: 'string' } };

const ASSERTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    key: { type: 'string' },
    polarity: { type: 'string', enum: ['INCLUDE', 'EXCLUDE'] },
    constraint: { type: 'string', enum: ['SOFT', 'HARD'] },
    provenance: { type: 'string', enum: ['DIRECT', 'INFERRED'] },
    strength: { type: 'string', enum: ['strong', 'medium', 'weak'] },
    confidence: { type: 'number' },
    evidence: STRING_ARRAY,
  },
  required: [
    'dimension',
    'key',
    'polarity',
    'constraint',
    'provenance',
    'strength',
    'confidence',
    'evidence',
  ],
};

const UNRESOLVED_CONCEPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string' },
    polarity: { type: 'string', enum: ['INCLUDE', 'EXCLUDE'] },
    constraint: { type: 'string', enum: ['SOFT', 'HARD'] },
    evidence: STRING_ARRAY,
  },
  required: ['label', 'polarity', 'constraint', 'evidence'],
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
    assertions: {
      type: 'array',
      items: ASSERTION_SCHEMA,
    },
    unresolvedConcepts: {
      type: 'array',
      items: UNRESOLVED_CONCEPT_SCHEMA,
    },
    anchoredPlaces: {
      type: 'array',
      items: ANCHORED_PLACE_SCHEMA,
    },
    softConstraints: STRING_ARRAY,
    ambiguities: STRING_ARRAY,
    budgetPreferences: STRING_ARRAY,
    groupPreferences: STRING_ARRAY,
    positiveSemanticQuery: { type: 'string' },
    notes: STRING_ARRAY,
  },
  required: [
    'assertions',
    'unresolvedConcepts',
    'anchoredPlaces',
    'softConstraints',
    'ambiguities',
    'budgetPreferences',
    'groupPreferences',
    'positiveSemanticQuery',
    'notes',
  ],
};

const EMPTY_INTENT: NormalizedPreferenceIntent = {
  interpretationStatus: 'complete',
  assertions: [],
  unresolvedConcepts: [],
  anchoredPlaces: [],
  softConstraints: [],
  ambiguities: [],
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
        {
          responseFormat: { type: 'json_object' },
          groq: { maxCompletionTokens: 800 },
        },
      );
      const normalized = this.normalize(JSON.parse(rawResponse), userPrompt);
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
      // No lexical fallback (owner, 2026-10-15): when semantic extraction
      // fails, the free text yields no assertion and stays unresolved.
      this.logger.warn(`Preference interpretation failed: ${error.message}`);
      const failed: NormalizedPreferenceIntent = {
        ...EMPTY_INTENT,
        interpretationStatus: 'failed',
        unresolvedFreeText: userPrompt,
      };
      return {
        intent: failed,
        trace: redactTracePayload({
          stage: 'preference_interpretation',
          ...this.providerMetadata(),
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          responseSchema: RESPONSE_SCHEMA,
          parsedResponse: failed,
          facetNormalizationDecisions: [],
          validationErrors: [error.message || 'interpretation_failed'],
          status: 'failed',
          unresolvedFreeText: userPrompt,
          durationMs: Date.now() - startedAt,
        }),
      };
    }
  }

  private normalize(
    value: any,
    supportingText = '',
  ): {
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

    const assertionResult = this.validateAssertions(
      value?.assertions,
      supportingText,
    );
    return {
      intent: {
        assertions: assertionResult.assertions,
        unresolvedConcepts: this.validateUnresolvedConcepts(
          value?.unresolvedConcepts,
          supportingText,
        ),
        anchoredPlaces: this.normalizeAnchors(value?.anchoredPlaces),
        softConstraints: list(value?.softConstraints),
        ambiguities: list(value?.ambiguities),
        budgetPreferences: list(value?.budgetPreferences),
        groupPreferences: list(value?.groupPreferences),
        positiveSemanticQuery:
          typeof value?.positiveSemanticQuery === 'string'
            ? value.positiveSemanticQuery.trim().slice(0, 500)
            : '',
        notes: list(value?.notes),
      },
      facetNormalizationDecisions: assertionResult.decisions,
    };
  }

  /**
   * Validates the extractor's assertions without reinterpreting the text:
   * the target must be a typed schema key, every field a valid enum value,
   * and every evidence excerpt must occur, token-bounded, in the user's text.
   * Anything else is rejected and recorded. Duplicates of one target and
   * polarity keep the DIRECT one, then the higher importance x confidence.
   */
  private validateAssertions(
    raw: unknown,
    supportingText: string,
  ): {
    assertions: PreferenceAssertion[];
    decisions: FacetNormalizationDecision[];
  } {
    if (!Array.isArray(raw)) return { assertions: [], decisions: [] };
    const decisions: FacetNormalizationDecision[] = [];
    const accepted: PreferenceAssertion[] = [];
    for (const item of raw) {
      const rawDimension =
        typeof item?.dimension === 'string'
          ? item.dimension.trim().toLowerCase()
          : '';
      const rawKey = typeof item?.key === 'string' ? item.key.trim() : '';
      const reject = (reason: FacetNormalizationDecision['reason']) =>
        decisions.push({ rawDimension, rawKey, accepted: false, reason });
      if (
        !(ASSERTION_TARGET_DIMENSIONS as readonly string[]).includes(
          rawDimension,
        )
      ) {
        reject('UNKNOWN_DIMENSION');
        continue;
      }
      const key = canonicalTargetKey(rawDimension, rawKey);
      if (!key) {
        reject('UNKNOWN_KEY');
        continue;
      }
      const polarity = enumValue<PreferencePolarity>(item.polarity, [
        'INCLUDE',
        'EXCLUDE',
      ]);
      const constraint = enumValue<PreferenceConstraint>(item.constraint, [
        'SOFT',
        'HARD',
      ]);
      const provenance = enumValue<PreferenceProvenance>(item.provenance, [
        'DIRECT',
        'INFERRED',
      ]);
      const strength = enumValue<PreferenceStrength>(item.strength, [
        'strong',
        'medium',
        'weak',
      ]);
      const confidence =
        typeof item.confidence === 'number' &&
        Number.isFinite(item.confidence) &&
        item.confidence >= 0 &&
        item.confidence <= 1
          ? item.confidence
          : null;
      if (
        !polarity ||
        !constraint ||
        !provenance ||
        !strength ||
        confidence === null
      ) {
        reject('INVALID_ASSERTION_FIELD');
        continue;
      }
      const evidence = this.groundedEvidence(item.evidence, supportingText);
      if (evidence.failure) {
        reject(evidence.failure);
        continue;
      }
      decisions.push({
        rawDimension,
        rawKey,
        normalizedDimension: rawDimension,
        normalizedKey: key,
        accepted: true,
        evidence: evidence.spans.map((span) => span.text),
        reason: 'VALID_AS_EMITTED',
      });
      const assertion: PreferenceAssertion = {
        target: { dimension: rawDimension as AssertionTargetDimension, key },
        polarity,
        constraint,
        provenance,
        importance: mapStrengthToImportance(strength),
        confidence,
        evidence: evidence.spans,
      };
      accepted.push(assertion);
    }
    return { assertions: dedupeAssertions(accepted), decisions };
  }

  private validateUnresolvedConcepts(
    raw: unknown,
    supportingText: string,
  ): UnresolvedPreferenceConcept[] {
    if (!Array.isArray(raw)) return [];
    const concepts: UnresolvedPreferenceConcept[] = [];
    for (const item of raw) {
      const label = typeof item?.label === 'string' ? item.label.trim() : '';
      const polarity = enumValue<PreferencePolarity>(item?.polarity, [
        'INCLUDE',
        'EXCLUDE',
      ]);
      const constraint = enumValue<PreferenceConstraint>(item?.constraint, [
        'SOFT',
        'HARD',
      ]);
      const evidence = this.groundedEvidence(item?.evidence, supportingText);
      if (!label || !polarity || !constraint || evidence.failure) continue;
      concepts.push({
        label: label.slice(0, 120),
        polarity,
        constraint,
        evidence: evidence.spans,
        reason: 'UNRESOLVED_OPEN_CONCEPT',
      });
    }
    return concepts.slice(0, 20);
  }

  /** Every excerpt must occur token-bounded in the user's text. */
  private groundedEvidence(
    raw: unknown,
    supportingText: string,
  ): {
    spans: UserTextSpanEvidence[];
    failure: 'MISSING_EVIDENCE' | 'UNSUPPORTED_BY_INPUT' | null;
  } {
    const spans = this.normalizeEvidence(raw);
    if (spans.length === 0) return { spans, failure: 'MISSING_EVIDENCE' };
    const grounded = spans.every((span) =>
      containsTokenBoundedSpan(supportingText, span.text),
    );
    return { spans, failure: grounded ? null : 'UNSUPPORTED_BY_INPUT' };
  }

  private normalizeEvidence(value: unknown): UserTextSpanEvidence[] {
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((text) => text.trim())
          .filter((text) => text.length > 0)
          .slice(0, 3)
          .map((text) => ({ kind: 'USER_TEXT_SPAN' as const, text }))
      : [];
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
  private normalizeAnchors(rawAnchors: unknown): InterpretedAnchor[] {
    if (!Array.isArray(rawAnchors)) {
      return [];
    }

    const validPriorities: InterpretedAnchor['priority'][] = ['soft', 'must'];

    const anchors: InterpretedAnchor[] = [];

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

      const validUsages: InterpretedAnchor['usage'][] = [
        'geographic_scope',
        'specific_destination',
        'named_path',
        'unknown',
      ];
      const usage: InterpretedAnchor['usage'] = validUsages.includes(
        (item as any).usage,
      )
        ? (item as any).usage
        : 'unknown';

      const rawPriority = (item as any).priority;
      const priority: InterpretedAnchor['priority'] = validPriorities.includes(
        rawPriority,
      )
        ? rawPriority
        : 'soft';

      anchors.push({ rawName, usage, priority });
    }

    return anchors.slice(0, MAX_ANCHORED_PLACES);
  }
}

type UserTextSpanEvidence = Extract<
  PreferenceEvidence,
  { kind: 'USER_TEXT_SPAN' }
>;

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
