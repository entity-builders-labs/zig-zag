/**
 * Registrable domain (eTLD+1) without a bundled public-suffix list. Spike
 * approximation: a two-letter country TLD preceded by a common second-level
 * label (com, gob, gov, org, net, edu, ac, co, tur) counts as a two-label
 * suffix (e.g. turismo.buenosaires.gob.ar -> buenosaires.gob.ar). Used only
 * for publisher independence fallback and provenance signals, never as an
 * allowlist.
 */
const SECOND_LEVEL = new Set(['com', 'gob', 'gov', 'org', 'net', 'edu', 'ac', 'co', 'tur', 'mil', 'int']);

export function registrableDomain(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    // already a host
  }
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * Whether the registrable domain sits under a government second-level label
 * (gob.xx / gov.xx / .gov). Recorded only as ONE provenance signal; it
 * authorizes nothing by itself.
 */
export function isGovernmentHosted(domain: string): boolean {
  const labels = domain.split('.');
  return labels.includes('gob') || labels.includes('gov') || labels[labels.length - 1] === 'gov';
}
