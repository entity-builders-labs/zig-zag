/**
 * Deterministic source-support admission gate (Stage 2 cutover:
 * docs/superpowers/plans/2026-09-22-component-resolution-and-partial-
 * composite-recovery-plan.md; docs/superpowers/specs/2026-09-22-component-
 * resolution-geographic-validation-and-enrichment-amendment.md §2/§4/§5).
 *
 * Answers exactly one question, deterministically, without trusting any new
 * LLM assertion: "did the cited tourism evidence actually originate/support
 * this component?" It never attempts identity resolution (aliases,
 * translations, canonical naming are Stage 3 concerns) and never uses
 * geographic proximity to rescue an unsupported component.
 *
 * A textual (web-extraction) componentHint must supply `supportSpan`: a
 * short phrase/sentence the extractor claims is copied verbatim from one of
 * its own cited evidence records. This backend verifies that claim by exact
 * (case/whitespace-normalized) substring containment against the REAL
 * captured text of that specific cited evidence record -- never a fuzzy
 * name match, never checked against evidence the component did not cite.
 *
 * The extractor is shown each evidence record as `[key] title-or-source:
 * snippet` (buildDiscoveryEvidenceBlock), so a real, verbatim supportSpan
 * may legitimately come from either half of that line. Checking only the
 * snippet half would reject a valid componentHint whose only real supporting
 * text happens to be the record's title.
 *
 * A structured-source componentHint (`StructuredExperienceCandidateSynthesizerService`)
 * does not go through this function at all: its componentHints are built
 * mechanically 1:1 from the originating `SourceObservation`'s own `title`,
 * so the cited record IS the component by construction (amendment §4,
 * "Structured source support").
 */

export type ComponentSourceSupportReason =
  | 'NO_SUPPORT_SPAN'
  | 'MISSING_EVIDENCE_TEXT'
  | 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE'
  | 'AMBIGUOUS_SUPPORTING_EVIDENCE'
  | 'MISSING_NORMALIZATION_KIND'
  | 'INVALID_NORMALIZATION_KIND';

export type ComponentEvidenceAttributionStatus =
  | 'DECLARED_KEY_VERIFIED'
  | 'REATTRIBUTED_UNIQUE_EXACT_SPAN'
  | 'NO_SUPPORTING_EVIDENCE'
  | 'AMBIGUOUS_SUPPORTING_EVIDENCE';

export type ComponentSourceSupportResult =
  | {
      supported: true;
      verifiedSupportSpan: string;
      declaredEvidenceKeys: string[];
      verifiedEvidenceKeys: string[];
      attributionStatus:
        | 'DECLARED_KEY_VERIFIED'
        | 'REATTRIBUTED_UNIQUE_EXACT_SPAN';
    }
  | {
      supported: false;
      reason: ComponentSourceSupportReason;
      declaredEvidenceKeys: string[];
      verifiedEvidenceKeys: string[];
      attributionStatus:
        | 'NO_SUPPORTING_EVIDENCE'
        | 'AMBIGUOUS_SUPPORTING_EVIDENCE';
    };

/**
 * Explicit type-predicate narrowing helper. This repo's tsconfig sets
 * `strictNullChecks: false`, under which plain `if (result.supported)`
 * control-flow narrowing of this discriminated union is unreliable; an
 * explicit type-predicate function narrows correctly regardless.
 */
export function isUnsupportedComponentSourceSupportResult(
  result: ComponentSourceSupportResult,
): result is {
  supported: false;
  reason: ComponentSourceSupportReason;
  declaredEvidenceKeys: string[];
  verifiedEvidenceKeys: string[];
  attributionStatus: 'NO_SUPPORTING_EVIDENCE' | 'AMBIGUOUS_SUPPORTING_EVIDENCE';
} {
  return result.supported === false;
}

/** The real captured title/snippet text of one cited evidence record. */
export interface EvidenceSupportText {
  title?: string;
  text: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*_~`#]+/g, ' ')
    .replace(/\s+([,.:;?!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMatchingSpan(candidate: string, trimmedSpan: string): string {
  const tokens = trimmedSpan
    .replace(/[*_~`#]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  try {
    const pattern = new RegExp(tokens.join('[\\s*_~`#]+'), 'i');
    const match = candidate.match(pattern);
    if (match && typeof match.index === 'number') {
      return candidate.slice(match.index, match.index + match[0].length);
    }
  } catch {
    // Fall back to trimmedSpan if regex pattern construction fails
  }
  return trimmedSpan;
}

function findMatchingRecordSpan(
  record: EvidenceSupportText,
  normalizedSpan: string,
  trimmedSpan: string,
): string | undefined {
  for (const text of [record.title, record.text]) {
    if (typeof text !== 'string' || !text.trim()) continue;
    if (normalize(text).includes(normalizedSpan)) {
      return extractMatchingSpan(text, trimmedSpan);
    }
  }
  return undefined;
}

/**
 * Verifies a textual componentHint's `supportSpan`:
 *
 * 1. Validate against the declared evidence key(s) exactly as today.
 * 2. If supported: preserve existing behavior; no fallback search.
 * 3. If SPAN_NOT_FOUND_IN_CITED_EVIDENCE:
 *    - search the same normalized support span across the active evidence set
 *      available to this extraction;
 *    - use the existing canonical source-text normalization;
 *    - zero fuzzy matching and zero semantic similarity.
 * 4. Outcomes:
 *    - 0 matching evidence items: preserve rejection.
 *    - exactly 1 matching evidence item: treat as source-supported; canonical
 *      verified evidence attribution becomes that evidence key; record that
 *      attribution was re-attributed (REATTRIBUTED_UNIQUE_EXACT_SPAN).
 *    - 2 or more matching evidence items: fail closed as ambiguous; do not
 *      arbitrarily choose one (AMBIGUOUS_SUPPORTING_EVIDENCE).
 */
export function verifyTextualComponentSourceSupport(
  supportSpan: string | undefined,
  evidenceKeys: string[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): ComponentSourceSupportResult {
  const declaredKeys = Array.isArray(evidenceKeys) ? evidenceKeys : [];
  const trimmedSpan = typeof supportSpan === 'string' ? supportSpan.trim() : '';
  if (!trimmedSpan) {
    return {
      supported: false,
      reason: 'NO_SUPPORT_SPAN',
      declaredEvidenceKeys: declaredKeys,
      verifiedEvidenceKeys: [],
      attributionStatus: 'NO_SUPPORTING_EVIDENCE',
    };
  }

  const normalizedSpan = normalize(trimmedSpan);

  // 1. Validate against the declared evidence key(s) exactly as today.
  let sawEvidenceText = false;
  for (const key of declaredKeys) {
    const record = evidenceByKey.get(key);
    if (!record) continue;
    if (
      (typeof record.title === 'string' && record.title.trim()) ||
      (typeof record.text === 'string' && record.text.trim())
    ) {
      sawEvidenceText = true;
    }
    const matchedSpan = findMatchingRecordSpan(
      record,
      normalizedSpan,
      trimmedSpan,
    );
    // 2. If supported: preserve existing behavior; no fallback search.
    if (matchedSpan !== undefined) {
      return {
        supported: true,
        verifiedSupportSpan: matchedSpan,
        declaredEvidenceKeys: declaredKeys,
        verifiedEvidenceKeys: [key],
        attributionStatus: 'DECLARED_KEY_VERIFIED',
      };
    }
  }

  // 3. If SPAN_NOT_FOUND_IN_CITED_EVIDENCE:
  // Search the same normalized support span across the active evidence set available to this extraction.
  // Use existing canonical source-text normalization; no fuzzy or semantic matching.
  interface ActiveMatch {
    key: string;
    verifiedSupportSpan: string;
  }
  const matchingActive: ActiveMatch[] = [];

  for (const [key, record] of evidenceByKey.entries()) {
    if (!record) continue;
    const matchedSpan = findMatchingRecordSpan(
      record,
      normalizedSpan,
      trimmedSpan,
    );
    if (matchedSpan !== undefined) {
      matchingActive.push({ key, verifiedSupportSpan: matchedSpan });
    }
  }

  // 4. Outcomes:
  // 0 matching evidence items -> preserve current rejection
  if (matchingActive.length === 0) {
    return {
      supported: false,
      reason: sawEvidenceText
        ? 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE'
        : 'MISSING_EVIDENCE_TEXT',
      declaredEvidenceKeys: declaredKeys,
      verifiedEvidenceKeys: [],
      attributionStatus: 'NO_SUPPORTING_EVIDENCE',
    };
  }

  // Exactly 1 matching evidence item -> treat span as supported, canonical verified evidence attribution becomes that key
  if (matchingActive.length === 1) {
    return {
      supported: true,
      verifiedSupportSpan: matchingActive[0].verifiedSupportSpan,
      declaredEvidenceKeys: declaredKeys,
      verifiedEvidenceKeys: [matchingActive[0].key],
      attributionStatus: 'REATTRIBUTED_UNIQUE_EXACT_SPAN',
    };
  }

  // 2 or more matching evidence items -> fail closed as ambiguous; do not arbitrarily choose one
  return {
    supported: false,
    reason: 'AMBIGUOUS_SUPPORTING_EVIDENCE',
    declaredEvidenceKeys: declaredKeys,
    verifiedEvidenceKeys: [],
    attributionStatus: 'AMBIGUOUS_SUPPORTING_EVIDENCE',
  };
}
