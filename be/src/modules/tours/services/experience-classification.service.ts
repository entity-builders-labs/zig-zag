/**
 * Evidence-only semantic classification (spec §9, plan Task B2).
 *
 * `ExperienceClassificationService.classify()` is a pure Stage-6 primitive:
 * given ONE Experience's canonical name and its real grounded evidence
 * (never traveler preferences -- that would make preference matching
 * circular, spec §9), it asks the model which canonical themes, canonical
 * intents and freeform traits that evidence substantially supports, then
 * deterministically re-validates the response before trusting any of it.
 *
 * Provider and model are capability-specific configuration. The classifier
 * remains evidence-only and deterministic regardless of whether the active
 * provider is Groq or Gemini.
 *
 * This service does not persist anything itself. Cutover M4 wires it into
 * the live orchestration path via
 * `experience-classification-convergence.util.ts`'s
 * `classifyAcceptedResultsByExperience`, called from
 * `ExperienceAcquisitionService.materializeExecution()` -- the ONE shared
 * canonical materialization boundary every acquisition strategy converges
 * on, never a per-strategy opt-in.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LangChainService } from '@shared/ai/langchain.service';
import aiConfig from '@shared/ai/ai.config';
import { ExperienceGroundingEvidence } from '../interfaces/experience-grounding.interface';
import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  CANONICAL_INTENT_KEYS,
  CANONICAL_THEME_KEYS,
} from '../prompts/experience-semantic-classification.prompt';
import {
  isValidClassifierTraitShape,
  sanitizeClassifierTraits,
} from '../utils/trait-shape-guard.util';
import {
  canonicalizeFacetKey,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';

/**
 * Bump whenever the prompt/output contract changes in a way that would
 * make a previously-persisted classification unsafe to reuse (D2 --
 * `canReuseClassification` below is the ONLY thing allowed to gate reuse).
 */
export const CURRENT_CLASSIFICATION_PROMPT_VERSION = 1;

export interface ClassificationReasoningEvidence {
  facet: string;
  evidenceKeys: string[];
  reason: string;
}

export interface ClassificationResult {
  themes: string[];
  intents: string[];
  traits: string[];
  reasoningEvidence: ClassificationReasoningEvidence[];
  modelId: string;
  promptVersion: number;
  state: 'classified' | 'degraded';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizedFacetKey(dimension: string, key: string): string {
  return `${dimension}:${key.trim().toLowerCase()}`;
}

/**
 * True when `value` canonicalizes to a real controlled theme or intent key.
 * Reuses the same single source of truth
 * (`experience-candidate-facet-normalizer.util.ts` / discovery extraction
 * repair) rather than a second local taxonomy -- a controlled theme/intent
 * key may never remain inside `traits` (open-ended by contract).
 */
function isControlledVocabularyValue(value: string): boolean {
  return (
    !!canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, value) ||
    !!canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, value)
  );
}

/**
 * Minimal structural check on the raw LLM envelope, BEFORE any sanitizing.
 * A response missing one of the four required arrays entirely (e.g. `{}`)
 * is a malformed envelope, not a valid empty classification -- it must
 * degrade rather than be silently "repaired" into `state: 'classified'`
 * with empty arrays. A genuinely well-formed response with all four arrays
 * present but empty is a normal, accurate, classified result.
 */
function hasValidClassificationEnvelopeShape(
  value: Record<string, unknown>,
): boolean {
  return (
    Array.isArray(value.themes) &&
    Array.isArray(value.intents) &&
    Array.isArray(value.traits) &&
    Array.isArray(value.reasoningEvidence)
  );
}

/**
 * Sanitizes the raw `reasoningEvidence` array against the REAL evidence
 * keys this classification run was given. An entry survives only when its
 * `facet`/`reason` are non-empty strings and EVERY cited evidenceKey is
 * real (matching the discovery-extraction precedent of rejecting a whole
 * fact rather than partially trusting it) -- never invents a fact with no
 * genuine evidence backing it.
 */
function sanitizeReasoningEvidence(
  raw: unknown,
  realEvidenceKeys: ReadonlySet<string>,
): ClassificationReasoningEvidence[] {
  if (!Array.isArray(raw)) return [];

  const sanitized: ClassificationReasoningEvidence[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const facet = typeof entry.facet === 'string' ? entry.facet.trim() : '';
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    const evidenceKeys = asStringArray(entry.evidenceKeys);
    if (!facet || !reason || evidenceKeys.length === 0) continue;
    if (evidenceKeys.some((key) => !realEvidenceKeys.has(key))) continue;
    sanitized.push({ facet: facet.toLowerCase(), evidenceKeys, reason });
  }
  return sanitized;
}

@Injectable()
export class ExperienceClassificationService {
  private readonly logger = new Logger(ExperienceClassificationService.name);

  constructor(
    private readonly langChainService: LangChainService,
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  private get model(): string {
    const providerConfig =
      this.config.classification[this.config.classification.provider];
    if (!providerConfig) {
      throw new Error(
        `Missing classification configuration for provider ${this.config.classification.provider}`,
      );
    }
    return providerConfig.model;
  }

  private get provider(): 'groq' | 'gemini' | 'ollama' {
    return this.config.classification.provider;
  }

  getAuditIdentity(): { provider: string; model: string } {
    return { provider: this.provider, model: this.model };
  }

  private emptyResult(state: 'classified' | 'degraded'): ClassificationResult {
    return {
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
      modelId: this.model,
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state,
    };
  }

  async classify(
    canonicalName: string,
    evidence: ExperienceGroundingEvidence[],
  ): Promise<ClassificationResult> {
    // No evidence -> nothing can be substantiated. This is a normal,
    // accurate empty classification (spec: "empty arrays allowed"), not a
    // failure -- skip the call entirely rather than asking the model to
    // classify nothing.
    if (evidence.length === 0) {
      return this.emptyResult('classified');
    }

    const realEvidenceKeys = new Set(evidence.map((item) => item.key));

    let raw: string;
    try {
      raw = await this.langChainService.generateChatResponse(
        buildClassificationSystemPrompt(),
        buildClassificationUserPrompt(canonicalName, evidence),
        {},
        {
          providerOverride: this.provider,
          modelOverride: this.model,
          responseFormat: { type: 'json_object' },
          // Stage 6 classification remains deterministic across providers.
          temperature: 0,
          // D2: classification has no cache table of its own and must
          // never read/write the shared AI response cache -- reuse is
          // decided exclusively by canReuseClassification() against the
          // persisted metadata.classification, never by an opaque
          // prompt-keyed cache entry.
          bypassCache: true,
        },
      );
    } catch (error: any) {
      this.logger.warn(
        `Experience classification failed for "${canonicalName}": ${error.message}`,
      );
      return this.emptyResult('degraded');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn(
        `Experience classification returned non-JSON output for "${canonicalName}"`,
      );
      return this.emptyResult('degraded');
    }

    if (
      !isPlainObject(parsed) ||
      !hasValidClassificationEnvelopeShape(parsed)
    ) {
      this.logger.warn(
        `Experience classification returned a malformed envelope for "${canonicalName}"`,
      );
      return this.emptyResult('degraded');
    }

    const sanitizedEvidence = sanitizeReasoningEvidence(
      parsed.reasoningEvidence,
      realEvidenceKeys,
    );
    const substantiatedFacets = new Set(
      sanitizedEvidence.map((entry) => entry.facet),
    );

    const themeCanonicalSet = new Set(CANONICAL_THEME_KEYS);
    const themes = asStringArray(parsed.themes).filter(
      (key) =>
        themeCanonicalSet.has(key) &&
        substantiatedFacets.has(normalizedFacetKey('theme', key)),
    );

    const intentCanonicalSet = new Set(CANONICAL_INTENT_KEYS);
    const intents = asStringArray(parsed.intents).filter(
      (key) =>
        intentCanonicalSet.has(key) &&
        substantiatedFacets.has(normalizedFacetKey('intent', key)),
    );

    const traits = sanitizeClassifierTraits(parsed.traits)
      // traits is open-ended by contract -- a value that canonicalizes to
      // a real controlled theme/intent key must never survive here, even
      // if the shape guard and evidence citation would otherwise accept
      // it (matches the same hard invariant already enforced for
      // discovery extraction).
      .filter((value) => !isControlledVocabularyValue(value))
      .filter((value) =>
        substantiatedFacets.has(normalizedFacetKey('trait', value)),
      );

    // The returned reasoningEvidence must stay internally consistent: only
    // keep entries whose facet actually survived into the final
    // themes/intents/traits above (a raw entry can cite real evidence for
    // an out-of-vocabulary theme or a sentence-shaped trait, which is
    // correctly dropped from the arrays but must not linger in the trace).
    const finalAcceptedFacets = new Set([
      ...themes.map((key) => normalizedFacetKey('theme', key)),
      ...intents.map((key) => normalizedFacetKey('intent', key)),
      ...traits.map((value) => normalizedFacetKey('trait', value)),
    ]);
    const reasoningEvidence = sanitizedEvidence.filter((entry) =>
      finalAcceptedFacets.has(entry.facet),
    );

    return {
      themes,
      intents,
      traits,
      reasoningEvidence,
      modelId: this.model,
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'classified',
    };
  }
}

/**
 * D2 reuse predicate (spec §9, plan Task B2). True ONLY when a persisted
 * classification exists, is for the CURRENT prompt version, and passes a
 * deterministic shape guard -- never merely because an Experience id
 * exists. Runtime-unknown `metadata` (a JSON blob from the DB) is handled
 * defensively; malformed input degrades to `false`, never throws.
 */
export function canReuseClassification(
  metadata: unknown,
  currentPromptVersion: number,
): boolean {
  if (!isPlainObject(metadata)) return false;
  const classification = metadata.classification;
  if (!isPlainObject(classification)) return false;
  if (classification.promptVersion !== currentPromptVersion) return false;
  // A degraded classification is a valid, honestly-recorded failure
  // outcome (see ClassificationResult), but it must never be treated as
  // reusable: Stage 6 should be retried on a future run until it actually
  // succeeds, not silently skipped forever because a past attempt failed.
  if (classification.state !== 'classified') return false;
  return isValidPersistedClassificationShape(classification);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidPersistedThemeList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === 'string' && CANONICAL_THEME_KEYS.includes(item),
    )
  );
}

function isValidPersistedIntentList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'string' && CANONICAL_INTENT_KEYS.includes(item),
    )
  );
}

function isValidPersistedTraitList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'string' &&
        isValidClassifierTraitShape(item) &&
        !isControlledVocabularyValue(item),
    )
  );
}

function isValidPersistedReasoningEvidenceList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (!isPlainObject(entry)) return false;
      if (!isNonEmptyString(entry.facet)) return false;
      if (!isNonEmptyString(entry.reason)) return false;
      return (
        Array.isArray(entry.evidenceKeys) &&
        entry.evidenceKeys.length > 0 &&
        entry.evidenceKeys.every((key) => isNonEmptyString(key))
      );
    })
  );
}

/**
 * Cross-consistency check between the accepted semantic facts
 * (themes/intents/traits) and their reasoningEvidence trace -- the same
 * 1:1 correspondence `classify()` itself produces (see its own
 * `finalAcceptedFacets`/`reasoningEvidence` filtering above). A persisted
 * classification is reusable only when EVERY accepted theme/intent/trait
 * has at least one matching reasoningEvidence entry, AND no
 * reasoningEvidence entry exists for a fact that isn't actually present in
 * themes/intents/traits (a dangling trace entry). Callers must have
 * already validated that `themes`/`intents`/`traits` are string arrays and
 * `reasoningEvidence` is an array of `{facet: string}`-shaped entries.
 */
function hasConsistentAcceptedFacetEvidence(
  themes: string[],
  intents: string[],
  traits: string[],
  reasoningEvidence: Array<{ facet: string }>,
): boolean {
  const acceptedFacets = new Set([
    ...themes.map((value) => normalizedFacetKey('theme', value)),
    ...intents.map((value) => normalizedFacetKey('intent', value)),
    ...traits.map((value) => normalizedFacetKey('trait', value)),
  ]);
  const evidencedFacets = new Set(
    reasoningEvidence.map((entry) => entry.facet.trim().toLowerCase()),
  );

  for (const facet of acceptedFacets) {
    if (!evidencedFacets.has(facet)) return false;
  }
  for (const facet of evidencedFacets) {
    if (!acceptedFacets.has(facet)) return false;
  }
  return true;
}

/**
 * Deterministic persisted-classification shape guard (D2). Every field is
 * validated against the SAME contract `classify()` itself enforces --
 * themes/intents must be real canonical keys, traits must pass the
 * trait-shape guard and must not be a controlled theme/intent leaking
 * through, each reasoningEvidence entry must be well-formed, and every
 * accepted theme/intent/trait must have exactly the reasoningEvidence
 * trace `classify()` would itself have produced for it (no unevidenced
 * accepted fact, no dangling evidence entry). This does not re-check that
 * cited evidenceKeys still exist in the DB (that belongs to the
 * wiring/persistence layer, not this pure helper) -- only that the
 * persisted payload itself still honestly matches the current contract.
 */
function isValidPersistedClassificationShape(
  value: Record<string, unknown>,
): boolean {
  if (!isValidPersistedThemeList(value.themes)) return false;
  if (!isValidPersistedIntentList(value.intents)) return false;
  if (!isValidPersistedTraitList(value.traits)) return false;
  if (!isValidPersistedReasoningEvidenceList(value.reasoningEvidence)) {
    return false;
  }
  if (!isNonEmptyString(value.modelId)) return false;
  if (typeof value.promptVersion !== 'number') return false;
  if (value.state !== 'classified' && value.state !== 'degraded') {
    return false;
  }
  if (
    !hasConsistentAcceptedFacetEvidence(
      value.themes as string[],
      value.intents as string[],
      value.traits as string[],
      value.reasoningEvidence as Array<{ facet: string }>,
    )
  ) {
    return false;
  }
  return true;
}

/** Projects an already validated persisted classification for audit only. */
export function readPersistedClassification(
  metadata: unknown,
): ClassificationResult | undefined {
  if (
    !canReuseClassification(metadata, CURRENT_CLASSIFICATION_PROMPT_VERSION)
  ) {
    return undefined;
  }
  if (!isPlainObject(metadata) || !isPlainObject(metadata.classification)) {
    return undefined;
  }
  const value = metadata.classification;
  return {
    themes: value.themes as string[],
    intents: value.intents as string[],
    traits: value.traits as string[],
    reasoningEvidence:
      value.reasoningEvidence as ClassificationReasoningEvidence[],
    modelId: typeof value.modelId === 'string' ? value.modelId : '',
    promptVersion:
      typeof value.promptVersion === 'number'
        ? value.promptVersion
        : CURRENT_CLASSIFICATION_PROMPT_VERSION,
    state: 'classified',
  };
}
