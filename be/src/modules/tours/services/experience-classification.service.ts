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
 * Retry/backoff on 429 is NOT reimplemented here: `LangChainService`
 * already retries a Groq 429 response (bounded, respecting `retry-after`)
 * internally, so calling it directly already satisfies "sequential calls,
 * bounded retry/backoff on 429" (plan Task B2 / spec D1) without a second
 * retry loop.
 *
 * This service does not persist anything and is not wired into any live
 * orchestration path yet -- that is Checkpoint D's job, matching how A7's
 * `computeExplorationSignals` and `computeExplorationTilt` were built as
 * pure primitives first, wired later.
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
import { sanitizeClassifierTraits } from '../utils/trait-shape-guard.util';

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
    return this.config.classification.groq.model;
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
          providerOverride: 'groq',
          modelOverride: this.model,
          responseFormat: { type: 'json_object' },
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

    if (!isPlainObject(parsed)) {
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

    const traits = sanitizeClassifierTraits(parsed.traits).filter((value) =>
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
  return isValidPersistedClassificationShape(classification);
}

function isValidPersistedClassificationShape(
  value: Record<string, unknown>,
): boolean {
  if (!Array.isArray(value.themes)) return false;
  if (!Array.isArray(value.intents)) return false;
  if (!Array.isArray(value.traits)) return false;
  if (!Array.isArray(value.reasoningEvidence)) return false;
  if (typeof value.modelId !== 'string' || !value.modelId) return false;
  if (typeof value.promptVersion !== 'number') return false;
  if (value.state !== 'classified' && value.state !== 'degraded') {
    return false;
  }
  return true;
}
