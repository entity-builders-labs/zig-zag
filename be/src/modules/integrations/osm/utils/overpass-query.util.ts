import {
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
  QueryAdminBoundariesWithinAreaParams,
} from '../interfaces/overpass.interface';

const MAX_NAME_LENGTH = 200;
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
