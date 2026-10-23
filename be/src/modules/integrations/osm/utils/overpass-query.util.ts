import {
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
  QueryAdminBoundariesWithinAreaParams,
  QueryFeaturesNearParams,
  QueryHighwaysByNameParams,
  QueryElementGeometriesParams,
  OverpassSelector,
} from '../interfaces/overpass.interface';
import {
  OSM_ADMISSION_DISCOVERY_SELECTORS,
  OsmAdmissionDiscoverySelector,
} from './osm-admission-adapter';

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

// Operational ceiling for the targeted highway-by-name `around:` query, to
// protect the shared Overpass instance (provider/load constraint, like the
// other caps above). It never decides geographic validity: a caller window
// larger than this is REFUSED (the lookup fails, so the targeted route
// resolver reports UNAVAILABLE / incomplete coverage) instead of being
// silently clamped into a smaller search whose emptiness would read as an
// identity-negative NOT_FOUND.
export const HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS = 50_000;

// Accommodation tourism values and the destination-scope POI selector list
// live in the OSM admission adapter (osm-admission-adapter.ts) — the single
// source for the OSM tag → signal/exclusion mapping (design C7, task 37.1).
// Nothing else maintains a hand-written tourism selector or exclusion list.

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

// Radius-based sibling of buildPoisWithinAreaQuery, for a point-scale
// destination (no real OSM area/relation to scope a `map_to_area` query
// against) — same tag selectors, `around:radius,lat,lon` instead of an area
// reference. See ExperienceProposalResolverService's own use of this: a
// destination that degraded to point-scale has no real osmId to query
// "within", so lookupPoisWithin/lookupStreetsWithin must not be used for it.

/** Renders one destination-scope discovery selector to Overpass tag filters. */
function poiSelectorFilters(selector: OsmAdmissionDiscoverySelector): string {
  const { key } = selector;
  const filters: string[] = [];
  if (selector.includeValues && selector.includeValues.length > 0) {
    filters.push(
      selector.includeValues.length === 1
        ? `["${key}"="${selector.includeValues[0]}"]`
        : `["${key}"~"^(${selector.includeValues.join('|')})$"]`,
    );
  } else {
    filters.push(`["${key}"]`);
  }
  if (selector.excludeValues && selector.excludeValues.length > 0) {
    filters.push(`["${key}"!~"^(${selector.excludeValues.join('|')})$"]`);
  }
  return filters.join('');
}

/** One `nwr[...]["name"]<scope>` line for a discovery selector. */
function poiSelectorLine(
  selector: OsmAdmissionDiscoverySelector,
  scope: string,
): string {
  return `nwr${poiSelectorFilters(selector)}["name"]${scope}`;
}

export function buildPoisQuery({
  latitude,
  longitude,
  radiusMeters,
}: QueryStreetsParams): string {
  const around = `(around:${radiusMeters},${latitude},${longitude})`;
  const lines = OSM_ADMISSION_DISCOVERY_SELECTORS.map(
    (selector) => `  ${poiSelectorLine(selector, around)}`,
  );
  return [
    '[out:json][timeout:25];',
    '(',
    ...lines,
    ');',
    'out tags center;',
  ].join('\n');
}

// Proactive feature discovery: ONE bounded `around:` union query for every
// structured selector in the plan (not one request per concept). `out body
// center` keeps relation member IDs/roles for structured parent evidence,
// without requesting full geometry.
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
    'out body center;',
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
  const requiredFilters = (selector.requireKeys ?? [])
    .map((required) => `["${sanitizeOverpassTagToken(required)}"]`)
    .join('');
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
    (prefix) =>
      `${prefix}${tagFilter}${requiredFilters}${nameFilter}${around};`,
  );
}

/**
 * Full area geometry of already-discovered ways/relations, by exact id
 * (task 39.5): the parent-site areas design C5 containment needs, which the
 * lightweight `out body center` discovery query deliberately omits.
 */
export function buildElementGeometriesQuery({
  elements,
}: QueryElementGeometriesParams): string {
  const ids = (type: 'way' | 'relation') =>
    [
      ...new Set(
        elements
          .filter(
            (element) =>
              element.osmType === type &&
              Number.isSafeInteger(element.osmId) &&
              element.osmId > 0,
          )
          .map((element) => element.osmId),
      ),
    ].sort((a, b) => a - b);
  const ways = ids('way');
  const relations = ids('relation');
  if (ways.length + relations.length === 0) {
    throw new Error('buildElementGeometriesQuery requires at least one id');
  }
  return [
    '[out:json][timeout:60];',
    '(',
    ...(ways.length ? [`  way(id:${ways.join(',')});`] : []),
    ...(relations.length ? [`  relation(id:${relations.join(',')});`] : []),
    ');',
    'out geom;',
  ].join('\n');
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

export function buildPoisWithinAreaQuery({
  osmType,
  osmId,
}: QueryByIdParams): string {
  const scope = '(area.a)';
  const lines = OSM_ADMISSION_DISCOVERY_SELECTORS.map(
    (selector) => `  ${poiSelectorLine(selector, scope)}`,
  );
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    '(',
    ...lines,
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
  const radius = Math.max(0, Math.round(radiusMeters));
  if (radius > HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS) {
    throw new Error(
      `buildHighwaysByNameQuery window ${radius} m exceeds the operational ` +
        `cap ${HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS} m; coverage ` +
        'would be incomplete',
    );
  }
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
