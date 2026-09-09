import {
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
  QueryAdminBoundariesWithinAreaParams,
  QueryFeaturesNearParams,
  OverpassSelector,
} from '../interfaces/overpass.interface';

const MAX_NAME_LENGTH = 200;

// A concept registry entry, not free text, feeds queryFeaturesNear — but its
// tag key/value tokens are still hard-validated here so no path can ever emit
// raw Overpass QL from an arbitrary string. OSM tag keys/values are
// `[A-Za-z0-9_:]` in practice; anything else (quotes, whitespace, regex
// metacharacters, brackets, control chars) is rejected outright.
const OVERPASS_TAG_TOKEN = /^[A-Za-z0-9_:]+$/;

// Defensive server-side cap for the proactive discovery union query. The
// caller (OsmPlacesService.lookupFeaturesNear) already clamps to a
// configurable limit; this is a floor of last resort so a bad caller can
// never aim an unbounded `around:` at a shared Overpass instance.
const FEATURES_NEAR_MAX_RADIUS_METERS = 8000;

export function sanitizeOverpassTagToken(token: string): string {
  if (typeof token !== 'string' || !OVERPASS_TAG_TOKEN.test(token)) {
    throw new Error(
      `Invalid Overpass tag token ${JSON.stringify(token)}: expected only [A-Za-z0-9_:]`,
    );
  }
  return token;
}
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;
const CONTROL_CHAR_CODES = { start: 0, end: 31, del: 127 };
const QUOTES_AND_CONTROL_CHARS = new RegExp(
  `["${String.fromCharCode(CONTROL_CHAR_CODES.start)}-${String.fromCharCode(CONTROL_CHAR_CODES.end)}${String.fromCharCode(CONTROL_CHAR_CODES.del)}]`,
  'g',
);

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

// Radius-based sibling of buildPoisWithinAreaQuery, for a point-scale
// destination (no real OSM area/relation to scope a `map_to_area` query
// against) — same tag filters, `around:radius,lat,lon` instead of an area
// reference. See ExperienceProposalResolverService's own use of this: a
// destination that degraded to point-scale has no real osmId to query
// "within", so lookupPoisWithin/lookupStreetsWithin must not be used for it.
export function buildPoisQuery({
  latitude,
  longitude,
  radiusMeters,
}: QueryStreetsParams): string {
  const around = `(around:${radiusMeters},${latitude},${longitude})`;
  return [
    '[out:json][timeout:25];',
    '(',
    `  nwr["tourism"]["name"]${around};`,
    `  nwr["amenity"~"^(marketplace|place_of_worship)$"]["name"]${around};`,
    `  nwr["historic"]["name"]${around};`,
    `  nwr["leisure"~"^(park|square|beach_resort)$"]["name"]${around};`,
    `  nwr["natural"="beach"]["name"]${around};`,
    ');',
    'out tags center;',
  ].join('\n');
}

// Proactive feature discovery: ONE bounded `around:` union query for every
// structured selector in the plan (not one request per concept). `out tags
// center` — discovery only needs tags + a centroid, never full geometry.
export function buildFeaturesNearQuery({
  latitude,
  longitude,
  radiusMeters,
  selectors,
}: QueryFeaturesNearParams): string {
  if (!Array.isArray(selectors) || selectors.length === 0) {
    throw new Error('buildFeaturesNearQuery requires at least one selector');
  }
  const cappedRadius = Math.min(
    Math.max(1, Math.round(radiusMeters)),
    FEATURES_NEAR_MAX_RADIUS_METERS,
  );
  const around = `(around:${cappedRadius},${latitude},${longitude})`;

  const lines: string[] = [];
  for (const selector of selectors) {
    lines.push(...buildSelectorLines(selector, around));
  }

  return [
    '[out:json][timeout:25];',
    '(',
    ...lines.map((line) => `  ${line}`),
    ');',
    'out tags center;',
  ].join('\n');
}

function buildSelectorLines(
  selector: OverpassSelector,
  around: string,
): string[] {
  const key = sanitizeOverpassTagToken(selector.key);
  const tagFilter =
    selector.value === undefined
      ? `["${key}"]`
      : `["${key}"="${sanitizeOverpassTagToken(selector.value)}"]`;
  const nameFilter = selector.requireName === false ? '' : '["name"]';

  const allTypes: Array<'node' | 'way' | 'relation'> = [
    'node',
    'way',
    'relation',
  ];
  const requested =
    selector.elementTypes && selector.elementTypes.length > 0
      ? allTypes.filter((type) => selector.elementTypes!.includes(type))
      : allTypes;

  // All three element types -> the `nwr` shorthand; a strict subset -> one
  // line per type so `elementTypes` is genuinely enforced.
  const prefixes = requested.length === allTypes.length ? ['nwr'] : requested;

  return prefixes.map(
    (prefix) => `${prefix}${tagFilter}${nameFilter}${around};`,
  );
}

export function buildBoundaryByIdQuery({
  osmType,
  osmId,
}: QueryByIdParams): string {
  return ['[out:json][timeout:25];', `${osmType}(${osmId});`, 'out geom;'].join(
    '\n',
  );
}

export function buildAdminBoundariesWithinAreaQuery({
  osmType,
  osmId,
  childAdminLevel,
}: QueryAdminBoundariesWithinAreaParams): string {
  if (
    !Number.isInteger(childAdminLevel) ||
    childAdminLevel < 1 ||
    childAdminLevel > 12
  ) {
    throw new RangeError('Child admin level must be an integer from 1 to 12');
  }
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    '(',
    `  relation["boundary"="administrative"]["admin_level"="${childAdminLevel}"](area.a);`,
    `  way["boundary"="administrative"]["admin_level"="${childAdminLevel}"][!"highway"](area.a)(if:is_closed());`,
    ');',
    'out tags center;',
  ].join('\n');
}

export function buildStreetsWithinAreaQuery({
  osmType,
  osmId,
}: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    'way["highway"]["name"](area.a);',
    'out tags center;',
  ].join('\n');
}

export function buildPoisWithinAreaQuery({
  osmType,
  osmId,
}: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    '(',
    '  nwr["tourism"]["name"](area.a);',
    '  nwr["amenity"~"^(marketplace|place_of_worship)$"]["name"](area.a);',
    '  nwr["historic"]["name"](area.a);',
    '  nwr["leisure"~"^(park|square|beach_resort)$"]["name"](area.a);',
    '  nwr["natural"="beach"]["name"](area.a);',
    ');',
    'out tags center;',
  ].join('\n');
}
