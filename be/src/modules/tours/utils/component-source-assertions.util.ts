import {
  ComponentLocalityAssertion,
  ComponentPhysicalKindAssertion,
  ComponentSourceLink,
} from '../interfaces/experience-discovery.interface';
import {
  EvidenceSupportText,
  verifyTextualComponentSourceSupport,
} from './component-source-support.util';
import {
  foldLiteralText,
  literalOccurrences,
  occurrencesOverlap,
  sourceStatements,
} from './literal-source-text.util';

/**
 * Deterministic admission of component-specific source facts (RW4
 * contextual identity, amendment §19). An assertion is kept only when:
 *  - its span is a literal substring of THIS component's own verified
 *    evidence (never re-attributed to another evidence item), and
 *  - one statement of that span names both the component and the fact,
 *    with the fact written outside the component's own name ("Azul" in
 *    "Bodega Azul" states no locality, "Bodega" states no kind).
 * The same-statement rule is what keeps an itinerary heading ("Lujan de
 * Cuyo Itinerary") or a neighbouring component's passage from becoming a
 * component assertion. A rejected assertion is dropped and audited; it
 * never invalidates the component itself.
 *
 * The physical kind is proposed by the discovery extractor. The locality is
 * proposed by source locality recovery (`component-locality-recovery.util.ts`,
 * §19.1), which also checks attribution before calling this gate.
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
  reason?: ComponentAssertionRejection | LocalityRecoveryRejection;
  /** Locality audits only: the locality that was proposed. */
  proposedLocality?: string;
}

/**
 * Why source locality recovery admitted no locality for a component, before
 * or instead of the gate below (§19.1).
 */
export type LocalityRecoveryRejection =
  | 'SAME_NAME_IN_SEVERAL_COMPOSITIONS'
  | 'STATEMENT_LIMIT_EXCEEDED'
  | 'STATEMENT_NAMES_ANOTHER_COMPONENT'
  | 'SEVERAL_PLACES_IN_STATEMENT'
  | 'LOCATION_QUALIFIED'
  | 'CONFLICTING_LOCALITIES';

export interface VerifiedComponentAssertions {
  physicalKindAssertion?: ComponentPhysicalKindAssertion;
  sourceLink?: ComponentSourceLink;
  audits: ComponentAssertionAudit[];
}

const PHYSICAL_KINDS = new Set(['ESTABLISHMENT', 'SETTLEMENT']);

/**
 * Whether one statement of the span names the component and, outside that
 * name, the fact.
 */
function statedWithComponent(
  span: string,
  componentName: string,
  fact: string,
): boolean {
  return sourceStatements(span).some((statement) => {
    const names = literalOccurrences(statement, componentName);
    if (names.length === 0) return false;
    return literalOccurrences(statement, fact).some(
      (occurrence) =>
        !names.some((name) => occurrencesOverlap(name, occurrence)),
    );
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

/**
 * Admits a proposed locality for one component. `supportSpan` must be a
 * literal substring of the component's own evidence, and one statement of
 * it must name the component and, outside that name, the locality.
 */
export function verifyLocalityAssertion(
  proposal: { locality: string; supportSpan: string },
  sourceName: string,
  componentKeys: readonly string[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): {
  localityAssertion?: ComponentLocalityAssertion;
  audit: ComponentAssertionAudit;
} {
  const locality = nonEmpty(proposal.locality);
  const audit = (
    status: ComponentAssertionAudit['status'],
    reason?: ComponentAssertionRejection,
  ): ComponentAssertionAudit => ({
    assertion: 'LOCALITY',
    status,
    ...(reason ? { reason } : {}),
    ...(locality ? { proposedLocality: locality } : {}),
  });
  if (!locality) return { audit: audit('REJECTED', 'MALFORMED') };
  const verified = verifySpanInComponentEvidence(
    proposal.supportSpan,
    componentKeys,
    evidenceByKey,
  );
  if (!verified) {
    return { audit: audit('REJECTED', 'SPAN_NOT_IN_COMPONENT_EVIDENCE') };
  }
  if (!statedWithComponent(verified.supportSpan, sourceName, locality)) {
    return {
      audit: audit('REJECTED', 'NOT_STATED_IN_ONE_SENTENCE_WITH_COMPONENT'),
    };
  }
  return {
    localityAssertion: { locality, ...verified },
    audit: audit('ACCEPTED'),
  };
}

export function verifyComponentSourceAssertions(
  rawHint: { physicalKindAssertion?: unknown },
  sourceName: string,
  componentKeys: readonly string[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): VerifiedComponentAssertions {
  const result: VerifiedComponentAssertions = { audits: [] };

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
    } else if (!statedWithComponent(verified.supportSpan, sourceName, term)) {
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

  const needle = foldLiteralText(sourceName);
  const links = new Map<string, { evidenceKey: string; linkText: string }>();
  for (const key of componentKeys) {
    const record = evidenceByKey.get(key);
    for (const text of [record?.title, record?.text]) {
      if (typeof text !== 'string') continue;
      for (const match of text.matchAll(MARKDOWN_LINK)) {
        if (
          needle &&
          foldLiteralText(match[1]) === needle &&
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
