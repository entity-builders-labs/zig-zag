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
  | { supported: true }
  | { supported: false; reason: ComponentSourceSupportReason };

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Verifies a textual componentHint's `supportSpan` against the real
 * captured text of ITS OWN cited evidence keys only -- a span that is real
 * text from a different, uncited evidence record does not count (this is
 * exactly the "support points to wrong evidence record" failure mode).
 */
export function verifyTextualComponentSourceSupport(
  supportSpan: string | undefined,
  evidenceKeys: string[],
  evidenceTextByKey: ReadonlyMap<string, string>,
): ComponentSourceSupportResult {
  const trimmedSpan = typeof supportSpan === 'string' ? supportSpan.trim() : '';
  if (!trimmedSpan) {
    return { supported: false, reason: 'NO_SUPPORT_SPAN' };
  }

  const normalizedSpan = normalize(trimmedSpan);
  let sawEvidenceText = false;
  for (const key of evidenceKeys) {
    const text = evidenceTextByKey.get(key);
    if (typeof text !== 'string' || !text.trim()) continue;
    sawEvidenceText = true;
    if (normalize(text).includes(normalizedSpan)) {
      return { supported: true };
    }
  }

  return {
    supported: false,
    reason: sawEvidenceText
      ? 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE'
      : 'MISSING_EVIDENCE_TEXT',
  };
}
