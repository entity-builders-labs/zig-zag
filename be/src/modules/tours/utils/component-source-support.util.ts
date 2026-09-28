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
  | 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE';

export type ComponentSourceSupportResult =
  | { supported: true; verifiedSupportSpan: string }
  | { supported: false; reason: ComponentSourceSupportReason };

/**
 * Explicit type-predicate narrowing helper. This repo's tsconfig sets
 * `strictNullChecks: false`, under which plain `if (result.supported)`
 * control-flow narrowing of this discriminated union is unreliable; an
 * explicit type-predicate function narrows correctly regardless.
 */
export function isUnsupportedComponentSourceSupportResult(
  result: ComponentSourceSupportResult,
): result is { supported: false; reason: ComponentSourceSupportReason } {
  return result.supported === false;
}

/** The real captured title/snippet text of one cited evidence record. */
export interface EvidenceSupportText {
  title?: string;
  text: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Verifies a textual componentHint's `supportSpan` against the real
 * captured title/snippet text of ITS OWN cited evidence keys only -- a span
 * that is real text from a different, uncited evidence record does not
 * count (this is exactly the "support points to wrong evidence record"
 * failure mode), and neither does a fuzzy/alias/semantic match.
 */
export function verifyTextualComponentSourceSupport(
  supportSpan: string | undefined,
  evidenceKeys: string[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): ComponentSourceSupportResult {
  const trimmedSpan = typeof supportSpan === 'string' ? supportSpan.trim() : '';
  if (!trimmedSpan) {
    return { supported: false, reason: 'NO_SUPPORT_SPAN' };
  }

  const normalizedSpan = normalize(trimmedSpan);
  let sawEvidenceText = false;
  for (const key of evidenceKeys) {
    const record = evidenceByKey.get(key);
    if (!record) continue;
    for (const candidate of [record.title, record.text]) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      sawEvidenceText = true;
      if (normalize(candidate).includes(normalizedSpan)) {
        // Preferred: extract the actual matching substring from the captured
        // raw source text so verifiedSupportSpan reflects true source wording.
        const tokens = trimmedSpan
          .split(/\s+/)
          .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        try {
          const pattern = new RegExp(tokens.join('\\s+'), 'i');
          const match = candidate.match(pattern);
          if (match && typeof match.index === 'number') {
            return {
              supported: true,
              verifiedSupportSpan: candidate.slice(
                match.index,
                match.index + match[0].length,
              ),
            };
          }
        } catch {
          // Fall back to trimmedSpan if regex pattern construction fails
        }
        return { supported: true, verifiedSupportSpan: trimmedSpan };
      }
    }
  }

  return {
    supported: false,
    reason: sawEvidenceText
      ? 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE'
      : 'MISSING_EVIDENCE_TEXT',
  };
}
