import { EvidenceCapture, ProvenanceSignal } from '../contracts';
import { locateQuote } from '../research/documents';
import { isGovernmentHosted, registrableDomain } from '../research/domain';
import { WebTools } from '../research/tools';
import { normalizeGeoName } from '../../../../be/src/modules/tours/utils/nominatim-match.util';

export type ProvenanceCheck =
  | { status: 'VERIFIED'; capture: EvidenceCapture }
  | { status: 'NOT_REPRODUCIBLE'; capture: EvidenceCapture; detail: string }
  | { status: 'UNAVAILABLE'; capture: EvidenceCapture; detail: string };

interface JsonLdOrganization {
  name: string;
  url: string;
}

/** Organizations declared in JSON-LD (top level, @graph, publisher/author). */
export function jsonLdOrganizations(blocks: string[]): JsonLdOrganization[] {
  const found: JsonLdOrganization[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Record<string, unknown>;
    const type = ([] as unknown[]).concat(obj['@type'] ?? []).map(String);
    if (type.some((t) => /Organization|Government|TouristInformationCenter/i.test(t)) && typeof obj.name === 'string' && typeof obj.url === 'string') {
      found.push({ name: obj.name, url: obj.url });
    }
    for (const key of ['@graph', 'publisher', 'author', 'sourceOrganization', 'isPartOf']) visit(obj[key]);
  };
  for (const block of blocks) {
    try {
      visit(JSON.parse(block));
    } catch {
      // malformed JSON-LD is simply not a provenance signal
    }
  }
  return found;
}

/**
 * Provenance (authenticity) for one capture, independent of the claim:
 * re-fetch through the grounding purpose, require the captured span, record
 * fingerprint drift, and establish the publisher only from a
 * machine-checkable property (JSON-LD Organization whose url matches the
 * fetched host). Government hosting is recorded as one signal only.
 */
export async function verifyProvenance(capture: EvidenceCapture, tools: WebTools): Promise<ProvenanceCheck> {
  if (capture.locator.kind !== 'URL' || capture.capture.kind !== 'PROSE_SPAN') {
    return { status: 'NOT_REPRODUCIBLE', capture, detail: 'spike verifies URL prose captures only' };
  }
  let doc;
  try {
    doc = await tools.fetch(capture.locator.url, 'grounding');
  } catch (error) {
    return { status: 'UNAVAILABLE', capture, detail: (error as Error).message };
  }
  if (!locateQuote(doc.text, capture.capture.text)) {
    return { status: 'NOT_REPRODUCIBLE', capture, detail: 'captured span absent from re-fetched content' };
  }
  const domain = registrableDomain(capture.locator.url);
  const signals: ProvenanceSignal[] = [
    { kind: 'REPRODUCIBLE', refetchedAt: doc.retrievedAt, fingerprintDrift: doc.fingerprint !== capture.contentFingerprint },
  ];
  const publisher = jsonLdOrganizations(doc.jsonLd).find((org) => {
    try {
      return registrableDomain(org.url) === domain;
    } catch {
      return false;
    }
  });
  if (publisher) {
    signals.push({ kind: 'PUBLISHER_ESTABLISHED', publisher: publisher.name, basis: 'JSON_LD_ORGANIZATION_URL_MATCHES_HOST', registrableDomain: domain });
  }
  if (isGovernmentHosted(domain)) signals.push({ kind: 'GOVERNMENT_HOSTED', registrableDomain: domain });
  return { status: 'VERIFIED', capture: { ...capture, registrableDomain: domain, provenanceSignals: signals } };
}

export function hasSignal(capture: EvidenceCapture, kind: ProvenanceSignal['kind']): boolean {
  return capture.provenanceSignals.some((s) => s.kind === kind);
}

/** Publisher identity for independence: established publisher, else registrable domain. */
export function publisherOf(capture: EvidenceCapture): string {
  const established = capture.provenanceSignals.find((s) => s.kind === 'PUBLISHER_ESTABLISHED');
  if (established && established.kind === 'PUBLISHER_ESTABLISHED') return `publisher:${normalizeGeoName(established.publisher)}`;
  return `domain:${capture.registrableDomain ?? (capture.locator.kind === 'URL' ? registrableDomain(capture.locator.url) : capture.locator.dataset)}`;
}
