import {
  ComponentLocalityAssertion,
  ComponentPhysicalKindAssertion,
  ComponentSourceLink,
} from '../interfaces/experience-discovery.interface';
import {
  EvidenceSupportText,
  supportSpanNamesEntity,
  verifyTextualComponentSourceSupport,
} from './component-source-support.util';

/**
 * Deterministic admission of component-specific source facts proposed by
 * the extractor (RW4 contextual identity, amendment §19). An assertion is
 * kept only when:
 *  - its span is a literal substring of THIS component's own verified
 *    evidence (never re-attributed to another evidence item), and
 *  - one sentence of that span names both the component and the fact.
 * The same-sentence rule is what keeps an itinerary heading ("Lujan de
 * Cuyo Itinerary") or a neighbouring component's passage from becoming a
 * component assertion. A rejected assertion is dropped and audited; it
 * never invalidates the component itself.
 *
 * A source link is never an LLM claim: it is a Markdown link in the
 * component's own evidence whose text is the component's source name, with
 * exactly one distinct target.
 */

export type ComponentAssertionKind =
  | 'LOCALITY'
  | 'PHYSICAL_KIND'
  | 'SOURCE_LINK';

export type ComponentAssertionRejection =
  | 'MALFORMED'
  | 'SPAN_NOT_IN_COMPONENT_EVIDENCE'
  | 'NOT_STATED_IN_ONE_SENTENCE_WITH_COMPONENT'
  | 'AMBIGUOUS_LINK';

export interface ComponentAssertionAudit {
  assertion: ComponentAssertionKind;
  status: 'ACCEPTED' | 'REJECTED';
  reason?: ComponentAssertionRejection;
}

export interface VerifiedComponentAssertions {
  localityAssertion?: ComponentLocalityAssertion;
  physicalKindAssertion?: ComponentPhysicalKindAssertion;
  sourceLink?: ComponentSourceLink;
  audits: ComponentAssertionAudit[];
}

const PHYSICAL_KINDS = new Set(['ESTABLISHMENT', 'SETTLEMENT']);

function sentencesOf(span: string): string[] {
  return span
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function statedTogether(span: string, ...names: string[]): boolean {
  return sentencesOf(span).some((sentence) =>
    names.every((name) => supportSpanNamesEntity(sentence, name)),
  );
}

/**
 * The kind term must be stated by the sentence itself, not merely be part
 * of the component's own name ("Bodega" in "Bodega Azul" states nothing).
 */
function kindStatedWithComponent(
  span: string,
  componentName: string,
  term: string,
): boolean {
  const name = foldLinkText(componentName);
  return sentencesOf(span).some((sentence) => {
    if (!supportSpanNamesEntity(sentence, componentName)) return false;
    const withoutName = ` ${foldLinkText(sentence)} `
      .split(` ${name} `)
      .join(' ');
    return supportSpanNamesEntity(withoutName, term);
  });
}

function verifySpanInComponentEvidence(
  supportSpan: unknown,
  componentKeys: readonly string[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): { evidenceKey: string; supportSpan: string } | undefined {
  if (typeof supportSpan !== 'string' || !supportSpan.trim()) return undefined;
  const ownEvidence = new Map(
    componentKeys
      .filter((key) => evidenceByKey.has(key))
      .map((key) => [key, evidenceByKey.get(key)!] as const),
  );
  const support = verifyTextualComponentSourceSupport(
    supportSpan,
    [...componentKeys],
    ownEvidence,
  );
  if (!support.supported) return undefined;
  return {
    evidenceKey: support.verifiedEvidenceKeys[0],
    supportSpan: support.verifiedSupportSpan,
  };
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

function foldLinkText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function verifyComponentSourceAssertions(
  rawHint: { localityAssertion?: unknown; physicalKindAssertion?: unknown },
  sourceName: string,
  componentKeys: readonly string[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): VerifiedComponentAssertions {
  const result: VerifiedComponentAssertions = { audits: [] };

  const rawLocality = rawHint.localityAssertion as
    | { locality?: unknown; supportSpan?: unknown }
    | undefined;
  if (rawLocality !== undefined) {
    const locality = nonEmpty(rawLocality?.locality);
    const verified = locality
      ? verifySpanInComponentEvidence(
          rawLocality.supportSpan,
          componentKeys,
          evidenceByKey,
        )
      : undefined;
    if (!locality) {
      result.audits.push({
        assertion: 'LOCALITY',
        status: 'REJECTED',
        reason: 'MALFORMED',
      });
    } else if (!verified) {
      result.audits.push({
        assertion: 'LOCALITY',
        status: 'REJECTED',
        reason: 'SPAN_NOT_IN_COMPONENT_EVIDENCE',
      });
    } else if (!statedTogether(verified.supportSpan, sourceName, locality)) {
      result.audits.push({
        assertion: 'LOCALITY',
        status: 'REJECTED',
        reason: 'NOT_STATED_IN_ONE_SENTENCE_WITH_COMPONENT',
      });
    } else {
      result.localityAssertion = { locality, ...verified };
      result.audits.push({ assertion: 'LOCALITY', status: 'ACCEPTED' });
    }
  }

  const rawKind = rawHint.physicalKindAssertion as
    | { kind?: unknown; term?: unknown; supportSpan?: unknown }
    | undefined;
  if (rawKind !== undefined) {
    const kind =
      typeof rawKind?.kind === 'string' && PHYSICAL_KINDS.has(rawKind.kind)
        ? (rawKind.kind as ComponentPhysicalKindAssertion['kind'])
        : undefined;
    const term = nonEmpty(rawKind?.term);
    const verified =
      kind && term
        ? verifySpanInComponentEvidence(
            rawKind.supportSpan,
            componentKeys,
            evidenceByKey,
          )
        : undefined;
    if (!kind || !term) {
      result.audits.push({
        assertion: 'PHYSICAL_KIND',
        status: 'REJECTED',
        reason: 'MALFORMED',
      });
    } else if (!verified) {
      result.audits.push({
        assertion: 'PHYSICAL_KIND',
        status: 'REJECTED',
        reason: 'SPAN_NOT_IN_COMPONENT_EVIDENCE',
      });
    } else if (
      !kindStatedWithComponent(verified.supportSpan, sourceName, term)
    ) {
      result.audits.push({
        assertion: 'PHYSICAL_KIND',
        status: 'REJECTED',
        reason: 'NOT_STATED_IN_ONE_SENTENCE_WITH_COMPONENT',
      });
    } else {
      result.physicalKindAssertion = { kind, term, ...verified };
      result.audits.push({ assertion: 'PHYSICAL_KIND', status: 'ACCEPTED' });
    }
  }

  const needle = foldLinkText(sourceName);
  const links = new Map<string, { evidenceKey: string; linkText: string }>();
  for (const key of componentKeys) {
    const record = evidenceByKey.get(key);
    for (const text of [record?.title, record?.text]) {
      if (typeof text !== 'string') continue;
      for (const match of text.matchAll(MARKDOWN_LINK)) {
        if (
          needle &&
          foldLinkText(match[1]) === needle &&
          !links.has(match[2])
        ) {
          links.set(match[2], { evidenceKey: key, linkText: match[1].trim() });
        }
      }
    }
  }
  if (links.size === 1) {
    const [[url, link]] = [...links.entries()];
    result.sourceLink = { url, ...link };
    result.audits.push({ assertion: 'SOURCE_LINK', status: 'ACCEPTED' });
  } else if (links.size > 1) {
    result.audits.push({
      assertion: 'SOURCE_LINK',
      status: 'REJECTED',
      reason: 'AMBIGUOUS_LINK',
    });
  }

  return result;
}
