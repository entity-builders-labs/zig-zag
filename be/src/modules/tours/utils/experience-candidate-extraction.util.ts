import {
  ComponentNormalizationKind,
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';
import { normalizeExperienceCandidateFacets } from './experience-candidate-facet-normalizer.util';
import {
  ComponentEvidenceAttributionStatus,
  ComponentSourceSupportReason,
  isUnsupportedComponentSourceSupportResult,
  supportSpanNamesEntity,
  verifyTextualComponentSourceSupport,
} from './component-source-support.util';
import {
  ComponentAssertionAudit,
  verifyComponentSourceAssertions,
} from './component-source-assertions.util';
import type { LocalityRecoveryAudit } from './component-locality-recovery.util';

const ROLES = new Set(['area', 'waypoint', 'route', 'venue']);
const KINDS = new Set(['PLACE', 'AREA', 'ROUTE']);
const MAX_HINTS = 8;
const VALID_NORMALIZATION_KINDS = new Set<string>([
  'TYPO_CORRECTION',
  'TRANSLATION',
  'CANONICAL_NAME',
]);

/** One evidence record's key and its real captured title/snippet text, used
 * only for the deterministic source-support gate (see
 * component-source-support.util.ts). `key` must match
 * `ExperienceGroundingEvidence.key`; `title`/`text` are that same record's
 * own title and snippet, never a different record's text -- the extractor
 * is shown both halves (`buildDiscoveryEvidenceBlock`: "[key] title: text"),
 * so a real supportSpan may legitimately come from either. */
export interface DiscoveryEvidenceRecord {
  key: string;
  title?: string;
  text: string;
}

export type ComponentSourceSupportStatus = 'SUPPORTED' | 'UNSUPPORTED';

/**
 * Per-component fact from the deterministic source-support gate: did THIS
 * declared componentHint's own cited evidence actually support it? This is
 * an extractor/source-authority question, orthogonal to identity/geography
 * (Stage 3/4 concerns) -- a component may be SUPPORTED here and still fail
 * identity resolution later, or vice versa is impossible (an UNSUPPORTED
 * component never reaches identity resolution at all; see
 * CandidateSourceSupportAudit).
 */
export interface ComponentSourceSupportAudit {
  index: number;
  key: string;
  name: string;
  sourceName?: string;
  normalizationKind?: ComponentNormalizationKind;
  role: GeoEntityHint['role'];
  expectedKind: GeoEntityHint['expectedKind'];
  evidenceKeys: string[];
  declaredEvidenceKeys: string[];
  verifiedEvidenceKeys: string[];
  attributionStatus: ComponentEvidenceAttributionStatus;
  status: ComponentSourceSupportStatus;
  reason?: ComponentSourceSupportReason;
  /** The exact source substring that verified this component's supportSpan.
   * AUDIT / EVIDENCE ONLY — never enters identity, geography, ranking,
   * fingerprints, dedupe, or planning. Populated only when verification
   * succeeded. */
  verifiedSupportSpan?: string;
  /** Admission of the component's own source facts (locality, kind, link). */
  assertionAudits?: ComponentAssertionAudit[];
}

/**
 * Source-composition-authority audit for one raw extracted candidate
 * (component-resolution-and-partial-composite-recovery-plan.md, final Stage
 * 2 corrective fix). Answers a narrower, prior question than identity/
 * geography resolution: did the extractor's own cited evidence actually
 * support the composition it emitted? An extractor MUST NOT be granted
 * authority to silently rewrite raw source composition A-B-C into a smaller
 * canonical candidate A-B merely because C failed source support -- that is
 * a SOURCE_CONTRACT_VIOLATION on the whole raw candidate, not proof that the
 * source only ever supported A-B. This is unrelated to, and preserved
 * separately from, later source-backed-but-identity/geography-unresolved
 * partial-composite characterization (Stage 4/5).
 */
export interface CandidateSourceSupportAudit {
  candidateName: string;
  status: 'SUPPORTED' | 'SOURCE_CONTRACT_VIOLATION';
  emittedComponentCount: number;
  supportedComponentCount: number;
  unsupportedComponentCount: number;
  declaredEvidenceKeys?: string[];
  verifiedEvidenceKeys?: string[];
  components: ComponentSourceSupportAudit[];
}

export interface ExperienceExtractionResult {
  candidates: ExperienceCandidate[];
  /**
   * Audit list of every validation message, in order: extraction-level
   * failures, envelope repair notes, and per-candidate rejections.
   */
  validationErrors: string[];
  /**
   * Extraction-level failures only: the extractor response as a whole was
   * unusable (missing credentials, truncated output, unparseable JSON,
   * unrecognized envelope). Each also appears in `validationErrors`.
   * Candidate-level rejections and envelope repairs never appear here: an
   * invalid candidate says nothing about whether the supplied evidence is
   * worth enriching.
   */
  extractionFailures: string[];
  sourceSupportAudits: CandidateSourceSupportAudit[];
  /**
   * Source locality recovery for this extraction (§19.1), set by the
   * shared recovery step that runs after every provider's extraction.
   */
  localityRecovery?: LocalityRecoveryAudit;
}

/**
 * The result of an extraction whose response as a whole was unusable: no
 * candidates, and the reason recorded as an extraction-level failure.
 */
export function failedExtraction(reason: string): ExperienceExtractionResult {
  return {
    candidates: [],
    validationErrors: [reason],
    extractionFailures: [reason],
    sourceSupportAudits: [],
  };
}

/**
 * Some discovery extractor providers (confirmed live: Groq/qwen3.8-27b in
 * `response_format: {type:'json_object'}` mode, which guarantees valid JSON
 * but never a specific top-level shape) sometimes return a single candidate
 * object directly instead of the documented `{"candidates":[...]}` envelope
 * the prompt asks for. Before this fix, that shape fell through to `[]`
 * with zero validationErrors — a real, well-evidenced multi-component
 * candidate was silently discarded with no observable signal anywhere.
 *
 * This is a structural, provider-agnostic repair (bare object with the two
 * fields every real candidate must have: `name` and `componentHints`),
 * never a per-provider or per-candidate-name special case. The repair is
 * always reported via `validationErrors` — never silent — so it stays
 * visible in `WebAcquisitionResult.validationErrors` and the generation
 * trace without any new plumbing.
 */
function normalizeExtractorEnvelope(raw: unknown): {
  entries: unknown[];
  repairNotes: string[];
  envelopeFailures: string[];
} {
  if (Array.isArray(raw)) {
    return { entries: raw, repairNotes: [], envelopeFailures: [] };
  }
  if (raw && typeof raw === 'object') {
    const wrapped = (raw as Record<string, unknown>).candidates;
    if (Array.isArray(wrapped)) {
      return { entries: wrapped, repairNotes: [], envelopeFailures: [] };
    }
    const name = (raw as Record<string, unknown>).name;
    const componentHints = (raw as Record<string, unknown>).componentHints;
    if (typeof name === 'string' && Array.isArray(componentHints)) {
      return {
        entries: [raw],
        repairNotes: [
          'extractor_envelope_repaired: response was a single bare candidate object instead of {"candidates":[...]}; wrapped automatically',
        ],
        envelopeFailures: [],
      };
    }
  }
  // Not repaired, but never silent: an unreadable shape must not look like
  // a genuine empty result in the trace. Shape only (keys), never content.
  const shape =
    raw && typeof raw === 'object'
      ? `object keys [${Object.keys(raw).sort().join(', ')}]`
      : raw === null
        ? 'null'
        : typeof raw;
  return {
    entries: [],
    repairNotes: [],
    envelopeFailures: [
      `extractor_envelope_unrecognized: top-level ${shape}; no candidates read`,
    ],
  };
}

export function extractExperienceCandidates(
  raw: unknown,
  evidence: DiscoveryEvidenceRecord[],
  maxCandidates: number,
): ExperienceExtractionResult {
  const evidenceKeys = new Set(evidence.map((item) => item.key));
  const evidenceByKey = new Map(
    evidence.map((item) => [item.key, { title: item.title, text: item.text }]),
  );
  const { entries, repairNotes, envelopeFailures } =
    normalizeExtractorEnvelope(raw);
  const candidates: ExperienceCandidate[] = [];
  const validationErrors: string[] = [...envelopeFailures, ...repairNotes];
  const sourceSupportAudits: CandidateSourceSupportAudit[] = [];

  for (const [index, value] of entries.slice(0, maxCandidates).entries()) {
    const candidate = value as any;
    const errors: string[] = [];
    if (
      !candidate ||
      typeof candidate.name !== 'string' ||
      !candidate.name.trim()
    )
      errors.push('name is required');
    if (!Array.isArray(candidate?.themes))
      errors.push('themes must be an array');
    if (!Array.isArray(candidate?.traits))
      errors.push('traits must be an array');
    if (!Array.isArray(candidate?.intents))
      errors.push('intents must be an array');
    if (
      !Array.isArray(candidate?.componentHints) ||
      candidate.componentHints.length === 0
    )
      errors.push('componentHints is required');
    if (
      !Array.isArray(candidate?.evidenceKeys) ||
      candidate.evidenceKeys.length === 0
    )
      errors.push('evidenceKeys is required');
    if (
      Array.isArray(candidate?.evidenceKeys) &&
      candidate.evidenceKeys.some(
        (key: unknown) => !evidenceKeys.has(String(key)),
      )
    )
      errors.push('candidate references unknown evidence');

    const candidateName =
      typeof candidate?.name === 'string' ? candidate.name.trim() : '';
    const hints: GeoEntityHint[] = [];
    const componentAudits: ComponentSourceSupportAudit[] = [];
    if (Array.isArray(candidate?.componentHints)) {
      for (const [hintIndex, hint] of candidate.componentHints
        .slice(0, MAX_HINTS)
        .entries()) {
        if (!hint || typeof hint.name !== 'string' || !hint.name.trim()) {
          errors.push(`component ${hintIndex + 1} name is required`);
          continue;
        }
        const hintEvidenceKeys: string[] = Array.isArray(hint.evidenceKeys)
          ? hint.evidenceKeys.map(String)
          : [];
        const hasValidStructure =
          ROLES.has(hint.role) &&
          KINDS.has(hint.expectedKind) &&
          hintEvidenceKeys.length > 0 &&
          hintEvidenceKeys.every((key) => evidenceKeys.has(key));
        if (!ROLES.has(hint.role) || !KINDS.has(hint.expectedKind))
          errors.push(`component ${hintIndex + 1} has invalid role/kind`);
        if (
          hintEvidenceKeys.length === 0 ||
          hintEvidenceKeys.some((key) => !evidenceKeys.has(key))
        )
          errors.push(`component ${hintIndex + 1} has invalid evidence`);

        // Only meaningful once the hint's own evidenceKeys are structurally
        // valid -- there is nothing to verify a supportSpan against
        // otherwise, and that case is already a hard candidate-level error
        // above.
        if (!hasValidStructure) continue;

        // Deterministic source-support admission gate. Source-composition-
        // authority correction: an UNSUPPORTED sibling is NOT simply dropped
        // while the rest of the raw candidate silently proceeds as a smaller
        // canonical composition -- that would grant the extractor authority
        // to rewrite source composition (raw A-B-C, C unsupported, MUST NOT
        // become canonical A-B). It is recorded in the source-support audit
        // and turns the WHOLE raw candidate into a SOURCE_CONTRACT_VIOLATION
        // below; no canonical candidate is emitted for it.
        const support = verifyTextualComponentSourceSupport(
          typeof hint.supportSpan === 'string' ? hint.supportSpan : undefined,
          hintEvidenceKeys,
          evidenceByKey,
        );
        const key = String(hint.key || `component-${hintIndex + 1}`);
        const name = hint.name.trim();
        const rawSourceName =
          typeof hint.sourceName === 'string' && hint.sourceName.trim()
            ? hint.sourceName.trim()
            : undefined;
        const sourceName = rawSourceName ?? name;
        const isNormalized = sourceName !== name;
        const rawNormalizationKind =
          typeof hint.normalizationKind === 'string' &&
          hint.normalizationKind.trim()
            ? hint.normalizationKind.trim()
            : undefined;
        const isValidNormalizationKind =
          rawNormalizationKind &&
          VALID_NORMALIZATION_KINDS.has(rawNormalizationKind);

        // Strict generic normalization contract (Finding 1):
        // 1. sourceName absent -> sourceName = name, normalizationKind absent
        // 2. sourceName == name -> normalizationKind absent
        // 3. sourceName != name AND valid explicit kind -> accept typed normalization
        // 4. sourceName != name AND kind missing/invalid -> SOURCE CONTRACT VIOLATION / reject candidate
        if (isNormalized && !isValidNormalizationKind) {
          const reason: ComponentSourceSupportReason = !rawNormalizationKind
            ? 'MISSING_NORMALIZATION_KIND'
            : 'INVALID_NORMALIZATION_KIND';
          componentAudits.push({
            index: hintIndex,
            key,
            name,
            sourceName,
            role: hint.role,
            expectedKind: hint.expectedKind,
            evidenceKeys: support.verifiedEvidenceKeys,
            declaredEvidenceKeys: support.declaredEvidenceKeys,
            verifiedEvidenceKeys: support.verifiedEvidenceKeys,
            attributionStatus: support.attributionStatus,
            status: 'UNSUPPORTED',
            reason,
            ...(isUnsupportedComponentSourceSupportResult(support)
              ? {}
              : { verifiedSupportSpan: support.verifiedSupportSpan }),
          });
          continue;
        }

        const normalizationKind: ComponentNormalizationKind | undefined =
          isNormalized
            ? (rawNormalizationKind as ComponentNormalizationKind)
            : undefined;

        // An `area` hint alongside member components (venue/waypoint) is a
        // candidate-owned SCOPE claim (spec 2026-10-02 Part II §P2-6 S-b):
        // its verified span must literally name the area. A lone area
        // component (the area IS the visit) keeps the ordinary contract.
        const claimsScope =
          hint.role === 'area' &&
          candidate.componentHints.some(
            (other: any) =>
              other?.role === 'venue' || other?.role === 'waypoint',
          );
        if (
          !isUnsupportedComponentSourceSupportResult(support) &&
          claimsScope &&
          !supportSpanNamesEntity(support.verifiedSupportSpan, sourceName)
        ) {
          componentAudits.push({
            index: hintIndex,
            key,
            name,
            sourceName,
            ...(normalizationKind ? { normalizationKind } : {}),
            role: hint.role,
            expectedKind: hint.expectedKind,
            evidenceKeys: support.verifiedEvidenceKeys,
            declaredEvidenceKeys: support.declaredEvidenceKeys,
            verifiedEvidenceKeys: support.verifiedEvidenceKeys,
            attributionStatus: support.attributionStatus,
            status: 'UNSUPPORTED',
            reason: 'SCOPE_NAME_NOT_IN_SUPPORT_SPAN',
            verifiedSupportSpan: support.verifiedSupportSpan,
          });
          continue;
        }

        if (isUnsupportedComponentSourceSupportResult(support)) {
          componentAudits.push({
            index: hintIndex,
            key,
            name,
            sourceName,
            ...(normalizationKind ? { normalizationKind } : {}),
            role: hint.role,
            expectedKind: hint.expectedKind,
            evidenceKeys: hintEvidenceKeys,
            declaredEvidenceKeys: support.declaredEvidenceKeys,
            verifiedEvidenceKeys: support.verifiedEvidenceKeys,
            attributionStatus: support.attributionStatus,
            status: 'UNSUPPORTED',
            reason: support.reason,
          });
          continue;
        }
        // Component-specific source facts (physical kind, link): admitted
        // only from THIS component's own verified evidence. The locality is
        // recovered afterwards from the same evidence (§19.1).
        const assertions = verifyComponentSourceAssertions(
          hint,
          sourceName,
          support.verifiedEvidenceKeys,
          evidenceByKey,
        );
        componentAudits.push({
          index: hintIndex,
          key,
          name,
          sourceName,
          ...(normalizationKind ? { normalizationKind } : {}),
          role: hint.role,
          expectedKind: hint.expectedKind,
          evidenceKeys: support.verifiedEvidenceKeys,
          declaredEvidenceKeys: support.declaredEvidenceKeys,
          verifiedEvidenceKeys: support.verifiedEvidenceKeys,
          attributionStatus: support.attributionStatus,
          status: 'SUPPORTED',
          verifiedSupportSpan: support.verifiedSupportSpan,
          ...(assertions.audits.length > 0
            ? { assertionAudits: assertions.audits }
            : {}),
        });

        const addressHint =
          typeof hint.addressHint === 'string' && hint.addressHint.trim()
            ? hint.addressHint.trim()
            : undefined;
        hints.push({
          key,
          name,
          sourceName,
          ...(normalizationKind ? { normalizationKind } : {}),
          role: hint.role,
          expectedKind: hint.expectedKind,
          evidenceKeys: support.verifiedEvidenceKeys,
          declaredEvidenceKeys: support.declaredEvidenceKeys,
          ...(addressHint ? { addressHint } : {}),
          ...(assertions.physicalKindAssertion
            ? { physicalKindAssertion: assertions.physicalKindAssertion }
            : {}),
          ...(assertions.sourceLink
            ? { sourceLink: assertions.sourceLink }
            : {}),
        });
      }
    }

    const unsupportedAudits = componentAudits.filter(
      (audit) => audit.status === 'UNSUPPORTED',
    );
    const hasSourceContractViolation = unsupportedAudits.length > 0;

    const declaredCandidateKeys = Array.isArray(candidate.evidenceKeys)
      ? candidate.evidenceKeys.map(String)
      : [];

    // Candidate-level evidence is canonical downstream provenance, not a
    // second unverified extractor assertion. Start with the extractor's
    // declared candidate keys, but a key proven wrong for a component cannot
    // remain canonical solely because the extractor also listed it here.
    // Replace each such key with its deterministically verified key(s);
    // retain the declared key only when another component independently
    // verified it. Then include every verified component key and preserve
    // insertion order through Set-based deterministic deduplication.
    const reattributedKeys = new Map<string, Set<string>>();
    for (const audit of componentAudits) {
      if (audit.attributionStatus === 'REATTRIBUTED_UNIQUE_EXACT_SPAN') {
        for (const declared of audit.declaredEvidenceKeys) {
          if (!reattributedKeys.has(declared)) {
            reattributedKeys.set(declared, new Set());
          }
          for (const verified of audit.verifiedEvidenceKeys) {
            reattributedKeys.get(declared)!.add(verified);
          }
        }
      }
    }

    const verifiedCandidateKeysSet = new Set<string>();
    for (const declared of declaredCandidateKeys) {
      if (reattributedKeys.has(declared)) {
        const alsoVerified = componentAudits.some(
          (a) =>
            a.attributionStatus === 'DECLARED_KEY_VERIFIED' &&
            a.verifiedEvidenceKeys.includes(declared),
        );
        if (alsoVerified) {
          verifiedCandidateKeysSet.add(declared);
        }
        for (const replacement of reattributedKeys.get(declared)!) {
          verifiedCandidateKeysSet.add(replacement);
        }
      } else {
        verifiedCandidateKeysSet.add(declared);
      }
    }
    for (const hint of hints) {
      for (const k of hint.evidenceKeys) {
        verifiedCandidateKeysSet.add(k);
      }
    }
    const finalCandidateEvidenceKeys = Array.from(verifiedCandidateKeysSet);

    if (componentAudits.length > 0) {
      sourceSupportAudits.push({
        candidateName,
        status: hasSourceContractViolation
          ? 'SOURCE_CONTRACT_VIOLATION'
          : 'SUPPORTED',
        emittedComponentCount: componentAudits.length,
        supportedComponentCount:
          componentAudits.length - unsupportedAudits.length,
        unsupportedComponentCount: unsupportedAudits.length,
        declaredEvidenceKeys: declaredCandidateKeys,
        verifiedEvidenceKeys: hasSourceContractViolation
          ? []
          : finalCandidateEvidenceKeys,
        components: componentAudits,
      });
    }
    if (hasSourceContractViolation) {
      errors.push(
        `SOURCE_CONTRACT_VIOLATION: ${unsupportedAudits
          .map(
            (audit) =>
              `component ${audit.index + 1} (${audit.name}) unsupported: ${audit.reason}`,
          )
          .join('; ')}`,
      );
    }
    if (errors.length) {
      validationErrors.push(`Candidate ${index + 1}: ${errors.join('; ')}`);
      continue;
    }
    // Deterministic, provider-neutral repair of the semantic facets: themes and
    // intents are controlled vocabularies, traits is open-ended, and a
    // controlled concept the model placed in the wrong array is moved to the
    // right one instead of leaking through (see
    // experience-candidate-facet-normalizer.util.ts).
    const facets = normalizeExperienceCandidateFacets({
      themes: candidate.themes,
      traits: candidate.traits,
      intents: candidate.intents,
    });
    candidates.push({
      name: candidate.name.trim(),
      description:
        typeof candidate.description === 'string'
          ? candidate.description.trim()
          : undefined,
      themes: facets.themes,
      traits: facets.traits,
      intents: facets.intents,
      suggestedDurationMinutes: Number.isInteger(
        candidate.suggestedDurationMinutes,
      )
        ? candidate.suggestedDurationMinutes
        : undefined,
      componentHints: hints,
      evidenceKeys: finalCandidateEvidenceKeys,
      declaredEvidenceKeys: declaredCandidateKeys,
      shortReason:
        typeof candidate.shortReason === 'string'
          ? candidate.shortReason.trim()
          : '',
      orderedByEvidence: candidate.orderedByEvidence === true,
    });
  }
  return {
    candidates,
    validationErrors,
    extractionFailures: envelopeFailures,
    sourceSupportAudits,
  };
}
