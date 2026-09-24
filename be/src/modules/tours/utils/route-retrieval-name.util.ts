/**
 * ROUTE retrieval-name normalization -- QUERY GENERATION ONLY.
 *
 * A route hint's name often carries a redundant generic designator
 * ("Defensa Street", "Pasaje San Lorenzo", "San Lorenzo Passage") while the
 * provider's own `name` tag may not ("Defensa", "San Lorenzo"). The hint's
 * `expectedKind=ROUTE` already carries the "this is a street/passage"
 * concept, so dropping ONE generic designator yields a second query variant.
 *
 * This is deliberately NOT identity verification and never authorizes a
 * RESOLVED on its own: it only decides which exact names a targeted provider
 * query is sent with. No per-place aliases, no translation tables, no
 * similarity scoring -- only a small, generic, closed designator taxonomy.
 * Do not reuse it inside IdentityVerifier or any matching policy.
 */

export type RouteRetrievalVariantKind = 'RAW' | 'DESIGNATOR_NORMALIZED';

export interface RouteRetrievalVariant {
  variant: RouteRetrievalVariantKind;
  name: string;
}

// Designators that conventionally PRECEDE the name (Spanish usage).
const LEADING_ROUTE_DESIGNATORS: ReadonlySet<string> = new Set([
  'calle',
  'avenida',
  'av',
  'avda',
  'pasaje',
  'psje',
  'pje',
  'callejon',
  'bulevar',
  'boulevard',
]);

// Designators that conventionally FOLLOW the name (English usage). "St" is
// only accepted here: a leading "St." is usually "Saint".
const TRAILING_ROUTE_DESIGNATORS: ReadonlySet<string> = new Set([
  'street',
  'st',
  'avenue',
  'ave',
  'road',
  'rd',
  'lane',
  'passage',
  'alley',
  'boulevard',
  'blvd',
]);

function designatorKey(token: string): string {
  return token
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
}

/**
 * At most two variants: the raw (whitespace-normalized) name, and -- only
 * when it differs -- the name with one leading and/or one trailing generic
 * designator removed. A designator is never stripped if nothing would remain.
 */
export function routeRetrievalQueryVariants(
  rawName: string,
): RouteRetrievalVariant[] {
  const raw = rawName.trim().replace(/\s+/g, ' ');
  if (!raw) return [];

  const tokens = raw.split(' ');
  let start = 0;
  let end = tokens.length;
  if (
    end - start > 1 &&
    LEADING_ROUTE_DESIGNATORS.has(designatorKey(tokens[start]))
  ) {
    start += 1;
  }
  if (
    end - start > 1 &&
    TRAILING_ROUTE_DESIGNATORS.has(designatorKey(tokens[end - 1]))
  ) {
    end -= 1;
  }

  const variants: RouteRetrievalVariant[] = [{ variant: 'RAW', name: raw }];
  const normalized = tokens.slice(start, end).join(' ');
  if (normalized !== raw) {
    variants.push({ variant: 'DESIGNATOR_NORMALIZED', name: normalized });
  }
  return variants;
}
