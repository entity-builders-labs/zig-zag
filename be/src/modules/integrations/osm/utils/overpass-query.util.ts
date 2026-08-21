import {
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
} from '../interfaces/overpass.interface';

const MAX_NAME_LENGTH = 200;
// Matches every ECMA-regex metacharacter Overpass QL's `~"...",i` operator
// interprets as a pattern. `\\$&` escapes the matched char in-place.
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;
// Quotes would close the QL string literal early; control chars (including
// newlines) have no legitimate use in a place name and could otherwise
// inject additional QL statements.
const CONTROL_CHAR_CODES = { start: 0, end: 31, del: 127 };
const QUOTES_AND_CONTROL_CHARS = new RegExp(
  `["${String.fromCharCode(CONTROL_CHAR_CODES.start)}-${String.fromCharCode(CONTROL_CHAR_CODES.end)}${String.fromCharCode(CONTROL_CHAR_CODES.del)}]`,
  'g',
);

/**
 * Makes `name` safe to interpolate into a `~"NAME",i` Overpass QL regex
 * clause. Two independent concerns, applied in order:
 *  1. Escape every regex metacharacter so `name` is matched as literal text,
 *     not as a pattern — otherwise a crafted input can cause catastrophic
 *     backtracking (ReDoS) against Overpass's regex engine, even without
 *     ever breaking the surrounding string.
 *  2. Strip quotes/control characters so nothing can break out of the
 *     double-quoted string literal itself.
 * Real place names contain apostrophes, accents, etc. — this exists as much
 * for correctness (don't let a stray `"` break the query) as for defense
 * against a future caller that feeds this less-trusted input than today's
 * operator-typed `--name` CLI flag.
 */
export function sanitizeOverpassName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  const regexEscaped = trimmed.replace(REGEX_METACHARACTERS, '\\$&');
  return regexEscaped.replace(QUOTES_AND_CONTROL_CHARS, '');
}

export function buildBoundaryByNameQuery({
  name,
  latitude,
  longitude,
  radiusMeters,
}: QueryBoundaryByNameParams): string {
  const safeName = sanitizeOverpassName(name);
  const around = `(around:${radiusMeters},${latitude},${longitude})`;
  return [
    '[out:json][timeout:25];',
    '(',
    `  relation["boundary"="administrative"]["name"~"${safeName}",i]${around};`,
    `  way["boundary"="administrative"]["name"~"${safeName}",i]${around};`,
    ');',
    'out geom;',
  ].join('\n');
}

export function buildContainingBoundaryQuery({
  latitude,
  longitude,
}: QueryContainingBoundaryParams): string {
  return [
    '[out:json][timeout:25];',
    `is_in(${latitude},${longitude})->.a;`,
    '(',
    '  way(pivot.a)["boundary"="administrative"];',
    '  relation(pivot.a)["boundary"="administrative"];',
    ');',
    'out geom;',
  ].join('\n');
}

export function buildStreetsQuery({
  latitude,
  longitude,
  radiusMeters,
}: QueryStreetsParams): string {
  return [
    '[out:json][timeout:25];',
    `way["highway"]["name"](around:${radiusMeters},${latitude},${longitude});`,
    'out geom;',
  ].join('\n');
}

export function buildBoundaryByIdQuery({ osmType, osmId }: QueryByIdParams): string {
  return ['[out:json][timeout:25];', `${osmType}(${osmId});`, 'out geom;'].join('\n');
}

// All three "within area" queries below share the same map_to_area pattern —
// validated live against Overpass in the spike (see docs/superpowers/specs/
// 2026-08-21-activity-engine-design.md, "Spike validation"): a resolved
// relation/way's own real polygon, never a radius guess.
export function buildAdminBoundariesWithinAreaQuery({ osmType, osmId }: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    '(',
    '  relation["boundary"="administrative"](area.a);',
    '  way["boundary"="administrative"](area.a);',
    ');',
    'out tags center;',
  ].join('\n');
}

export function buildStreetsWithinAreaQuery({ osmType, osmId }: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    'way["highway"]["name"](area.a);',
    'out tags center;',
  ].join('\n');
}

export function buildPoisWithinAreaQuery({ osmType, osmId }: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    '(',
    '  node["tourism"]["name"](area.a);',
    '  node["amenity"~"^(marketplace|place_of_worship)$"]["name"](area.a);',
    '  node["historic"]["name"](area.a);',
    '  node["leisure"~"^(park|square)$"]["name"](area.a);',
    ');',
    'out tags center;',
  ].join('\n');
}
