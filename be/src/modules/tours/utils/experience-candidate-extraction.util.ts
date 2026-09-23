import {
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';
import { normalizeExperienceCandidateFacets } from './experience-candidate-facet-normalizer.util';
import {
  ComponentSourceSupportReason,
  isUnsupportedComponentSourceSupportResult,
  verifyTextualComponentSourceSupport,
} from './component-source-support.util';

const ROLES = new Set(['area', 'waypoint', 'route', 'venue']);
const KINDS = new Set(['PLACE', 'AREA', 'ROUTE']);
const MAX_HINTS = 8;

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
  role: GeoEntityHint['role'];
  expectedKind: GeoEntityHint['expectedKind'];
  evidenceKeys: string[];
  status: ComponentSourceSupportStatus;
  reason?: ComponentSourceSupportReason;
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
  components: ComponentSourceSupportAudit[];
}

export interface ExperienceExtractionResult {
  candidates: ExperienceCandidate[];
  validationErrors: string[];
  sourceSupportAudits: CandidateSourceSupportAudit[];
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
} {
  if (Array.isArray(raw)) {
    return { entries: raw, repairNotes: [] };
  }
  if (raw && typeof raw === 'object') {
    const wrapped = (raw as Record<string, unknown>).candidates;
    if (Array.isArray(wrapped)) {
      return { entries: wrapped, repairNotes: [] };
    }
    const name = (raw as Record<string, unknown>).name;
    const componentHints = (raw as Record<string, unknown>).componentHints;
    if (typeof name === 'string' && Array.isArray(componentHints)) {
      return {
        entries: [raw],
        repairNotes: [
          'extractor_envelope_repaired: response was a single bare candidate object instead of {"candidates":[...]}; wrapped automatically',
        ],
      };
    }
  }
  return { entries: [], repairNotes: [] };
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
  const { entries, repairNotes } = normalizeExtractorEnvelope(raw);
  const candidates: ExperienceCandidate[] = [];
  const validationErrors: string[] = [...repairNotes];
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
        if (isUnsupportedComponentSourceSupportResult(support)) {
          componentAudits.push({
            index: hintIndex,
            key,
            name,
            role: hint.role,
            expectedKind: hint.expectedKind,
            evidenceKeys: hintEvidenceKeys,
            status: 'UNSUPPORTED',
            reason: support.reason,
          });
          continue;
        }
        componentAudits.push({
          index: hintIndex,
          key,
          name,
          role: hint.role,
          expectedKind: hint.expectedKind,
          evidenceKeys: hintEvidenceKeys,
          status: 'SUPPORTED',
        });

        const addressHint =
          typeof hint.addressHint === 'string' && hint.addressHint.trim()
            ? hint.addressHint.trim()
            : undefined;
        hints.push({
          key,
          name,
          role: hint.role,
          expectedKind: hint.expectedKind,
          evidenceKeys: hintEvidenceKeys,
          ...(addressHint ? { addressHint } : {}),
        });
      }
    }

    const unsupportedAudits = componentAudits.filter(
      (audit) => audit.status === 'UNSUPPORTED',
    );
    const hasSourceContractViolation = unsupportedAudits.length > 0;
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
      evidenceKeys: candidate.evidenceKeys.map(String),
      shortReason:
        typeof candidate.shortReason === 'string'
          ? candidate.shortReason.trim()
          : '',
      orderedByEvidence: candidate.orderedByEvidence === true,
    });
  }
  return { candidates, validationErrors, sourceSupportAudits };
}
