import { createHash } from 'crypto';
import { EvidenceCapture } from '../contracts';

/** A fetched document as the research and grounding tools see it. */
export interface FetchedDocument {
  url: string;
  retrievedAt: string;
  /** Visible text, whitespace-normalized; capture offsets refer to it. */
  text: string;
  fingerprint: string;
  /** Raw JSON-LD blocks found in the page (parsed lazily by grounding). */
  jsonLd: string[];
  title?: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
  hellip: '…', laquo: '«', raquo: '»', ordm: 'º', ordf: 'ª', deg: '°',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m);
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Deterministic HTML -> visible text (scripts, styles and tags removed). */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return normalizeWhitespace(decodeEntities(body));
}

export function extractJsonLd(html: string): string[] {
  const blocks: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) blocks.push(m[1].trim());
  return blocks;
}

export function documentFromHtml(url: string, html: string, retrievedAt: string): FetchedDocument {
  const text = htmlToText(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    url,
    retrievedAt,
    text,
    fingerprint: createHash('sha256').update(text).digest('hex'),
    jsonLd: extractJsonLd(html),
    ...(title ? { title: normalizeWhitespace(decodeEntities(title)) } : {}),
  };
}

/** Typographic variants treated as equal when locating a quote. */
function foldForMatch(text: string): string {
  return text
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

/** Locates `quote` in `text`; returns offsets into `text` or undefined. */
export function locateQuote(text: string, quote: string): { start: number; end: number } | undefined {
  const q = normalizeWhitespace(quote);
  if (q.length < 12) return undefined;
  const direct = text.indexOf(q);
  if (direct >= 0) return { start: direct, end: direct + q.length };
  // Folding is length-preserving per character, so offsets stay valid.
  const folded = foldForMatch(text).indexOf(foldForMatch(q));
  return folded >= 0 ? { start: folded, end: folded + q.length } : undefined;
}

/**
 * Builds a PROSE_SPAN capture from a fetched document and a quote the agent
 * says it contains. Returns undefined when the quote is not in the document
 * (the claim is then discarded: no capture, no claim).
 */
export function captureFromQuote(
  doc: FetchedDocument,
  quote: string,
  registrableDomain: string,
  proposedAuthorityClass?: string,
): EvidenceCapture | undefined {
  const at = locateQuote(doc.text, quote);
  if (!at) return undefined;
  const text = doc.text.slice(at.start, at.end);
  return {
    id: createHash('sha256').update(`${doc.url}#${at.start}:${at.end}`).digest('hex').slice(0, 16),
    locator: { kind: 'URL', url: doc.url },
    retrievedAt: doc.retrievedAt,
    contentFingerprint: doc.fingerprint,
    capture: { kind: 'PROSE_SPAN', start: at.start, end: at.end, text },
    registrableDomain,
    ...(proposedAuthorityClass ? { proposedAuthorityClass } : {}),
    provenanceSignals: [],
    supportVerdicts: [],
  };
}
