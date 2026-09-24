import {
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
  QueryAdminBoundariesWithinAreaParams,
  QueryFeaturesNearParams,
  QueryHighwaysByNameParams,
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

// Server-side ceiling for the targeted highway-by-name query. The query is
// already narrow (one exact name, highway ways only), so it can safely cover
// a whole destination city; this matches the shared 50 km "still plausibly
// this destination" scale the Nominatim/Places biases already use.
const HIGHWAYS_BY_NAME_MAX_RADIUS_METERS = 50_000;

// Zig-Zag's product scope is tourist EXPERIENCES, not businesses -- an
// accommodation is never itself a component of one (hotels are explicitly
// out of scope; see the 2026-09-18 product-scope clarification). OSM's
// bare `tourism=*` wildcard used below also matches every accommodation
// subtype, which live-verified against the real Buenos Aires local pool
// made up fully a third of it (259/779 = 33% `tourism=hotel` alone, 40%
// once hostels/guest_houses/apartments/motels are included) --
// polluting the candidate pool with real, non-touristic businesses that
// then become spurious fuzzy-match targets (e.g. a real "Recoleta
// Cemetery" hint matching "Hotel Urban Suites Recoleta" purely because
// both real places happen to be tagged with the shared "Recoleta" word).
// This is a category-level exclusion grounded in OSM's own standard
// `tourism=*` value vocabulary -- not a per-name/per-language word list.
const NON_EXPERIENCE_TOURISM_VALUES =
  'hotel|hostel|guest_house|motel|apartment|camp_site|caravan_site|chalet|wilderness_hut';

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

// For an exact `["key"="value"]` match (not a `~` regex): only the string
// literal itself must be protected, so quotes, backslashes and control
// characters are stripped while dots/accents/parentheses stay verbatim --
// regex-escaping them here would make the exact match miss the real tag.
export function sanitizeOverpassExactValue(value: string): string {
  return value
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .replace(/\\/g, '')
    .replace(QUOTES_AND_CONTROL_CHARS, '')
    .trim();
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
    `  nwr["tourism"]["tourism"!~"^(${NON_EXPERIENCE_TOURISM_VALUES})$"]["name"]${around};`,
    `  nwr["amenity"~"^(marketplace|place_of_worship)$"]["name"]${around};`,
    `  nwr["historic"]["name"]${around};`,
    `  nwr["leisure"~"^(park|square|beach_resort)$"]["name"]${around};`,
    `  nwr["natural"="beach"]["name"]${around};`,
    // Named indoor pedestrian galleries/arcades -- real, historic shopping
    // passages (e.g. Buenos Aires' "Galería Güemes", 1915) are commonly
    // tagged ONLY highway=corridor + indoor=yes in OSM, with no
    // tourism/historic/amenity/leisure tag at all, so they never entered
    // the pool before. Live-verified: a 15km-radius scan around Buenos
    // Aires turned up only 6 real named corridors total, all genuine
    // galleries/passages -- a narrow category, not name-specific noise.
    `  nwr["highway"="corridor"]["name"]${around};`,
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
    `  nwr["tourism"]["tourism"!~"^(${NON_EXPERIENCE_TOURISM_VALUES})$"]["name"](area.a);`,
    '  nwr["amenity"~"^(marketplace|place_of_worship)$"]["name"](area.a);',
    '  nwr["historic"]["name"](area.a);',
    '  nwr["leisure"~"^(park|square|beach_resort)$"]["name"](area.a);',
    '  nwr["natural"="beach"]["name"](area.a);',
    // See buildPoisQuery's identical addition for the real-evidence
    // rationale (named indoor pedestrian galleries/arcades).
    '  nwr["highway"="corridor"]["name"](area.a);',
    ');',
    'out tags center;',
  ].join('\n');
}

export function buildHighwaysByNameQuery({
  name,
  latitude,
  longitude,
  radiusMeters,
}: QueryHighwaysByNameParams): string {
  const safeName = sanitizeOverpassExactValue(name);
  if (!safeName) {
    throw new Error('buildHighwaysByNameQuery requires a non-empty name');
  }
  const radius = Math.min(
    Math.max(0, Math.round(radiusMeters)),
    HIGHWAYS_BY_NAME_MAX_RADIUS_METERS,
  );
  return [
    '[out:json][timeout:25];',
    `way["highway"]["name"="${safeName}"](around:${radius},${latitude},${longitude});`,
    'out geom;',
  ].join('\n');
}

export function buildContainingAdminBoundariesQuery({
  latitude,
  longitude,
}: QueryContainingBoundaryParams): string {
  return [
    '[out:json][timeout:25];',
    `is_in(${latitude},${longitude})->.a;`,
    'rel(pivot.a)["boundary"="administrative"];',
    'out tags;',
  ].join('\n');
}
