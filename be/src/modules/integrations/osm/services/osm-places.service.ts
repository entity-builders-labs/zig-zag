import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IOverpassApiService,
  OverpassElement,
  OverpassSelector,
  QueryContainingBoundaryParams,
  QueryHighwaysByNameParams,
} from '../interfaces/overpass.interface';
import {
  GeoJsonGeometry,
  overpassElementToGeoJson,
} from '../utils/osm-geometry.util';

export interface OsmCandidate {
  id: string; // "osm:way:829393" | "osm:relation:49518" | "osm:node:123"
  name: string;
  // A POI candidate from findPoisWithin is genuinely a node (a single
  // point), not a way/relation boundary — its own centroid-free geometry
  // (see osm-geometry.util.ts's node handling).
  osmType: 'way' | 'relation' | 'node';
  osmId: number;
  geometry: GeoJsonGeometry;
  tags: Record<string, string>;
  // Populated in Fase 3, when the candidate carries a `wikidata` tag and
  // Wikidata content is available and passes the content-safety check.
  narrativeContext?: string;
}

export interface OsmLookupResult<T> {
  value: T;
  status: 'success' | 'failed';
  failureReason?: string;
}

// Narrow result for proactive feature discovery only (keeps the shared
// OsmLookupResult untouched). `rawResultCount` is the raw OverpassElement
// count before adapter filtering (name/identity/geometry), so downstream
// provenance can report discovery yield vs. usable candidates.
export interface OsmFeatureLookupResult
  extends OsmLookupResult<OsmCandidate[]> {
  rawResultCount: number;
}

/**
 * One OSM highway way normalized for ROUTE acquisition. `nodes` are the
 * way's ordered OSM node refs: a shared ref is the provider-native
 * topological fact that two ways are connected.
 */
export interface OsmRouteSegment {
  externalId: string; // "osm:way:48113515"
  osmId: number;
  name: string;
  highway: string;
  nodes: number[];
  geometry: Array<{ lat: number; lon: number }>;
}

export type OsmRouteObjectRejectionReason =
  | 'INVALID_IDENTITY'
  | 'NOT_A_WAY'
  | 'NOT_A_HIGHWAY'
  | 'HIGHWAY_AREA_NOT_LINEAR'
  | 'MISSING_NAME'
  | 'MISSING_GEOMETRY';

export interface OsmRouteSegmentLookup {
  rawCount: number;
  segments: OsmRouteSegment[];
  rejected: Array<{
    externalId: string;
    reason: OsmRouteObjectRejectionReason;
  }>;
}

/** An administrative unit containing a point, normalized from OSM tags. */
export interface OsmAdminUnit {
  osmType: 'relation' | 'way';
  osmId: number;
  name?: string;
  adminLevel?: number;
  /** ISO 3166-1 alpha-2, present on country-level units. */
  countryCode?: string;
}

const OSM_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'node',
  'way',
  'relation',
]);

function isValidOsmIdentity(type: unknown, id: unknown): boolean {
  return (
    typeof type === 'string' &&
    OSM_ELEMENT_TYPES.has(type) &&
    typeof id === 'number' &&
    Number.isInteger(id) &&
    id > 0
  );
}

function classifyRouteObject(
  element: OverpassElement,
): OsmRouteSegment | OsmRouteObjectRejectionReason {
  if (!isValidOsmIdentity(element?.type, element?.id)) {
    return 'INVALID_IDENTITY';
  }
  if (element.type !== 'way') return 'NOT_A_WAY';
  const tags = element.tags ?? {};
  if (!tags.highway) return 'NOT_A_HIGHWAY';
  // OSM's own convention for a pedestrian plaza / carriageway surface: an
  // area, not a linear route.
  if (tags.area === 'yes') return 'HIGHWAY_AREA_NOT_LINEAR';
  const geometry = (element.geometry ?? []).filter(
    (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon),
  );
  if (geometry.length < 2) return 'MISSING_GEOMETRY';
  if (!tags.name) return 'MISSING_NAME';
  return {
    externalId: `osm:way:${element.id}`,
    osmId: element.id,
    name: tags.name,
    highway: tags.highway,
    nodes: element.nodes ?? [],
    geometry,
  };
}

function toAdminUnit(element: OverpassElement): OsmAdminUnit | null {
  if (!isValidOsmIdentity(element?.type, element?.id)) return null;
  if (element.type !== 'relation' && element.type !== 'way') return null;
  const tags = element.tags ?? {};
  const adminLevel = Number(tags.admin_level);
  const iso = tags['ISO3166-1:alpha2'] ?? tags['ISO3166-1'];
  return {
    osmType: element.type,
    osmId: element.id,
    ...(tags.name ? { name: tags.name } : {}),
    ...(Number.isFinite(adminLevel) ? { adminLevel } : {}),
    ...(iso ? { countryCode: iso.toUpperCase() } : {}),
  };
}

// OSM's admin_level varies a lot by country, but 8-11 is the plausible
// range for a city/neighborhood-level boundary in most tagging schemes.
// When queryContainingBoundary returns multiple candidates for the same
// point (neighborhood + commune + city all technically "contain" it), the
// most specific (highest) admin_level in this range wins — if nothing
// falls in range, we discard rather than guess.
const NEIGHBORHOOD_ADMIN_LEVEL_RANGE = { min: 8, max: 11 };
const DESTINATION_BOUNDARY_ADMIN_LEVEL_RANGE = { min: 5, max: 12 };
const DEFAULT_MAX_STREETS_RADIUS_METERS = 2500;
// Proactive feature discovery (lookupFeaturesNear) legitimately wants a wider
// reach than a walkable-streets query, but still bounded so a single union
// query can never aim an unbounded `around:` at a shared Overpass instance.
const DEFAULT_MAX_FEATURES_RADIUS_METERS = 8000;
const GENERIC_STREET_NAMES = new Set([
  'sin nombre',
  'unnamed',
  'unnamed road',
  'unknown',
  's n',
]);

@Injectable()
export class OsmPlacesService {
  private readonly logger = new Logger(OsmPlacesService.name);

  constructor(
    @Inject('OverpassApiService')
    private readonly overpassApi: IOverpassApiService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * A neighborhood_walk is walkable by definition, so queryStreets never
   * inherits the tour's own general search radius (up to 50km) — in a
   * dense city that would return tens of thousands of ways and likely
   * time out or get the shared public Overpass instance's IP banned.
   */
  private get maxStreetsRadiusMeters(): number {
    return parseInt(
      this.configService.get<string>('OVERPASS_MAX_RADIUS_METERS') ||
        String(DEFAULT_MAX_STREETS_RADIUS_METERS),
      10,
    );
  }

  private get maxFeaturesRadiusMeters(): number {
    return parseInt(
      this.configService.get<string>('OVERPASS_MAX_FEATURES_RADIUS_METERS') ||
        String(DEFAULT_MAX_FEATURES_RADIUS_METERS),
      10,
    );
  }

  private toCandidate(element: OverpassElement): OsmCandidate | null {
    // Defensive identity check at the OverpassElement -> OsmCandidate seam: a
    // malformed external payload must never mint an identity like
    // `osm:node:undefined`, `osm:way:NaN`, `osm:foo:123` or `osm:relation:-1`.
    // Skip the bad sibling; never throw, never fail the whole lookup, never
    // synthesise identity from name/coordinates.
    if (!isValidOsmIdentity(element?.type, element?.id)) return null;

    const geometry = overpassElementToGeoJson(element);
    if (!geometry) return null;

    const tags = element.tags || {};
    if (!tags.name) return null;

    return {
      id: `osm:${element.type}:${element.id}`,
      name: tags.name,
      osmType: element.type,
      osmId: element.id,
      geometry,
      tags,
    };
  }

  private toStreetCandidate(element: OverpassElement): OsmCandidate | null {
    const candidate = this.toCandidate(element);
    if (!candidate) return null;

    const normalizedName = candidate.name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return GENERIC_STREET_NAMES.has(normalizedName) ? null : candidate;
  }

  /**
   * Named streets near a point — candidates for a ROUTE whose own trace is
   * the content of the experience (e.g. "walk through Caminito"), never for
   * the merely incidental path between stops of a NEIGHBORHOOD_WALK (that's
   * resolved client-side, never persisted — see Activity.boundary).
   * Never throws — a failed/unconfigured Overpass call degrades to "no
   * street candidates this generation", not a broken tour.
   */
  async findStreetsNear(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<OsmCandidate[]> {
    return (await this.lookupStreetsNear(latitude, longitude, radiusMeters))
      .value;
  }

  async lookupStreetsNear(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<OsmLookupResult<OsmCandidate[]>> {
    const cappedRadiusMeters = Math.min(
      radiusMeters,
      this.maxStreetsRadiusMeters,
    );
    try {
      const elements = await this.overpassApi.queryStreets({
        latitude,
        longitude,
        radiusMeters: cappedRadiusMeters,
      });
      return {
        status: 'success',
        value: elements
          .map((el) => this.toStreetCandidate(el))
          .filter((c): c is OsmCandidate => c !== null),
      };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryStreets failed, continuing without street candidates: ${error.message}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * Radius-based sibling of findPoisWithin, for a point-scale destination —
   * one with no real OSM area/relation to scope a `map_to_area` query
   * against (queryPoisWithinArea's `osmId` would be a synthetic placeholder,
   * which Overpass itself rejects outright: verified live, `relation(0)`
   * returns a hard HTTP 400 "only positive integers are allowed", not a slow
   * query or an empty result). Never throws, same defensive fallback as
   * findStreetsNear.
   */
  async findPoisNear(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<OsmCandidate[]> {
    return (await this.lookupPoisNear(latitude, longitude, radiusMeters)).value;
  }

  async lookupPoisNear(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<OsmLookupResult<OsmCandidate[]>> {
    const cappedRadiusMeters = Math.min(
      radiusMeters,
      this.maxStreetsRadiusMeters,
    );
    try {
      const elements = await this.overpassApi.queryPois({
        latitude,
        longitude,
        radiusMeters: cappedRadiusMeters,
      });
      return {
        status: 'success',
        value: elements
          .map((el) => this.toCandidate(el))
          .filter((c): c is OsmCandidate => c !== null),
      };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryPois failed, continuing without POI candidates: ${error.message}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * Proactive feature discovery for the acquisition pipeline: one bounded
   * Overpass `around:` union query built from an explicit, structured
   * selector list (never interpolated concept strings — see
   * OsmAcquisitionProvider + osm-acquisition-concepts.ts). Radius is capped
   * to maxFeaturesRadiusMeters. Never throws — a failed/unconfigured Overpass
   * call degrades to "no OSM feature candidates this pass", same defensive
   * contract as findStreetsNear/findPoisNear. `toCandidate` already drops
   * elements with no `name` tag.
   */
  async lookupFeaturesNear(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    selectors: OverpassSelector[],
  ): Promise<OsmFeatureLookupResult> {
    if (!selectors || selectors.length === 0) {
      return { status: 'success', value: [], rawResultCount: 0 };
    }
    const cappedRadiusMeters = Math.min(
      radiusMeters,
      this.maxFeaturesRadiusMeters,
    );
    try {
      const elements = await this.overpassApi.queryFeaturesNear({
        latitude,
        longitude,
        radiusMeters: cappedRadiusMeters,
        selectors,
      });
      return {
        status: 'success',
        value: elements
          .map((el) => this.toCandidate(el))
          .filter((c): c is OsmCandidate => c !== null),
        rawResultCount: elements.length,
      };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryFeaturesNear failed, continuing without OSM feature candidates: ${error.message}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error.message || 'unknown Overpass error',
        rawResultCount: 0,
      };
    }
  }

  /**
   * The neighborhood/administrative boundary that contains a point — the
   * area candidate offered to the LLM so it never has to invent which
   * experience grouping a composite belongs to. Never throws, same defensive
   * fallback as findStreetsNear.
   */
  async findContainingBoundary(
    latitude: number,
    longitude: number,
  ): Promise<OsmCandidate | null> {
    return (await this.lookupContainingBoundary(latitude, longitude)).value;
  }

  async lookupContainingBoundary(
    latitude: number,
    longitude: number,
  ): Promise<OsmLookupResult<OsmCandidate | null>> {
    try {
      const elements = await this.overpassApi.queryContainingBoundary({
        latitude,
        longitude,
      });

      const ranked = elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null)
        .map((candidate) => ({
          candidate,
          adminLevel: parseInt(candidate.tags.admin_level || '', 10),
        }))
        .filter(
          ({ adminLevel }) =>
            !isNaN(adminLevel) &&
            adminLevel >= NEIGHBORHOOD_ADMIN_LEVEL_RANGE.min &&
            adminLevel <= NEIGHBORHOOD_ADMIN_LEVEL_RANGE.max,
        )
        .sort((a, b) => b.adminLevel - a.adminLevel);

      return {
        status: 'success',
        value: ranked[0]?.candidate ?? null,
      };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryContainingBoundary failed, continuing without an area candidate: ${error.message}`,
      );
      return {
        status: 'failed',
        value: null,
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * Resolves the operational polygon for a settlement that Nominatim models
   * as a node. Unlike lookupContainingBoundary (which intentionally chooses
   * the most specific neighborhood), this method only accepts a containing
   * administrative boundary whose name matches structured container data
   * returned by Nominatim. It never guesses from admin_level alone.
   */
  async lookupDestinationBoundary(
    latitude: number,
    longitude: number,
    expectedContainerNames: string[],
  ): Promise<OsmLookupResult<OsmCandidate | null>> {
    const normalizedExpectedNames = expectedContainerNames
      .map((name) => this.normalizeBoundaryName(name))
      .filter(Boolean);

    if (normalizedExpectedNames.length === 0) {
      return { status: 'success', value: null };
    }

    try {
      const elements = await this.overpassApi.queryContainingBoundary({
        latitude,
        longitude,
      });
      const ranked = elements
        .map((element) => this.toCandidate(element))
        .filter(
          (
            candidate,
          ): candidate is OsmCandidate & {
            osmType: 'way' | 'relation';
          } =>
            candidate !== null &&
            candidate.osmType !== 'node' &&
            !candidate.tags.highway,
        )
        .map((candidate) => {
          const adminLevel = Number.parseInt(
            candidate.tags.admin_level || '',
            10,
          );
          const candidateNames = [
            candidate.name,
            candidate.tags.official_name,
            candidate.tags.short_name,
            candidate.tags.alt_name,
          ]
            .filter((name): name is string => Boolean(name))
            .map((name) => this.normalizeBoundaryName(name));
          const expectedIndex = normalizedExpectedNames.findIndex((expected) =>
            candidateNames.includes(expected),
          );
          return { candidate, adminLevel, expectedIndex };
        })
        .filter(
          ({ adminLevel, expectedIndex }) =>
            expectedIndex >= 0 &&
            Number.isInteger(adminLevel) &&
            adminLevel >= DESTINATION_BOUNDARY_ADMIN_LEVEL_RANGE.min &&
            adminLevel <= DESTINATION_BOUNDARY_ADMIN_LEVEL_RANGE.max,
        )
        .sort(
          (a, b) =>
            a.expectedIndex - b.expectedIndex || b.adminLevel - a.adminLevel,
        );

      return { status: 'success', value: ranked[0]?.candidate ?? null };
    } catch (error: any) {
      this.logger.warn(
        `Overpass destination-boundary lookup failed, continuing point-scale: ${error.message}`,
      );
      return {
        status: 'failed',
        value: null,
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  private normalizeBoundaryName(name: string): string {
    return name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * Boundary for an area already known by name (the generate-templates CLI,
   * Fase 5) — as opposed to findContainingBoundary, which resolves the area
   * from a point alone for live generation.
   */
  async findBoundaryByName(
    name: string,
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<OsmCandidate | null> {
    try {
      const elements = await this.overpassApi.queryBoundaryByName({
        name,
        latitude,
        longitude,
        radiusMeters,
      });
      const candidates = elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
      return candidates[0] ?? null;
    } catch (error) {
      this.logger.warn(
        `Overpass queryBoundaryByName failed for "${name}": ${error.message}`,
      );
      return null;
    }
  }

  /**
   * A specific boundary already identified by id (e.g. from
   * DestinationResolutionService's Nominatim lookup) — as opposed to
   * findContainingBoundary (point-based) or findBoundaryByName (name-based
   * search near a point). Never throws, same defensive fallback as its
   * siblings.
   */
  async getBoundaryById(
    osmType: 'way' | 'relation',
    osmId: number,
  ): Promise<OsmCandidate | null> {
    return (await this.lookupBoundaryById(osmType, osmId)).value;
  }

  async lookupBoundaryById(
    osmType: 'way' | 'relation',
    osmId: number,
  ): Promise<OsmLookupResult<OsmCandidate | null>> {
    try {
      const elements = await this.overpassApi.queryBoundaryById({
        osmType,
        osmId,
      });
      const candidates = elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
      return { status: 'success', value: candidates[0] ?? null };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryBoundaryById failed for ${osmType}/${osmId}: ${error.message}`,
      );
      return {
        status: 'failed',
        value: null,
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * Real named neighborhoods inside a resolved city boundary — a true
   * polygon-containment query (map_to_area), not one arbitrary point's
   * containing boundary. Filtered to admin_level = the city's own level + 1,
   * relative rather than a fixed absolute range: the spike showed
   * admin_level semantics vary by country (Buenos Aires' own city boundary
   * is admin_level=8, immediately adjacent to its real barrios at
   * admin_level=9) — see docs/superpowers/specs/2026-08-21-activity-engine-
   * design.md. Never throws.
   */
  async findNeighborhoodsWithin(
    boundary: OsmCandidate,
  ): Promise<OsmCandidate[]> {
    return (await this.lookupNeighborhoodsWithin(boundary)).value;
  }

  async lookupNeighborhoodsWithin(
    boundary: OsmCandidate,
  ): Promise<OsmLookupResult<OsmCandidate[]>> {
    const cityAdminLevel = Number(boundary.tags.admin_level);
    if (
      !Number.isInteger(cityAdminLevel) ||
      cityAdminLevel < 1 ||
      cityAdminLevel >= 12
    ) {
      return {
        status: 'failed',
        value: [],
        failureReason: `Boundary ${boundary.id} has no usable administrative level`,
      };
    }

    try {
      const elements = await this.overpassApi.queryAdminBoundariesWithinArea({
        osmType: boundary.osmType as 'way' | 'relation',
        osmId: boundary.osmId,
        childAdminLevel: cityAdminLevel + 1,
      });
      const seenIds = new Set<string>();
      return {
        status: 'success',
        value: elements
          .filter(
            (el) =>
              parseInt(el.tags?.admin_level || '', 10) === cityAdminLevel + 1 &&
              (el.type === 'relation' ||
                (el.type === 'way' && !el.tags?.highway)),
          )
          .map((el) => this.toCandidate(el))
          .filter((c): c is OsmCandidate => c !== null)
          .filter((candidate) => {
            if (seenIds.has(candidate.id)) return false;
            seenIds.add(candidate.id);
            return true;
          }),
      };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryAdminBoundariesWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * Named streets within a resolved neighborhood's own polygon — replaces
   * findStreetsNear's radius guess for the area-scale path (point-scale
   * destinations still use findStreetsNear, which has no polygon of its
   * own to query against). Never throws.
   */
  async findStreetsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]> {
    return (await this.lookupStreetsWithin(boundary)).value;
  }

  async lookupStreetsWithin(
    boundary: OsmCandidate,
  ): Promise<OsmLookupResult<OsmCandidate[]>> {
    try {
      const elements = await this.overpassApi.queryStreetsWithinArea({
        osmType: boundary.osmType as 'way' | 'relation',
        osmId: boundary.osmId,
      });
      return {
        status: 'success',
        value: elements
          .map((el) => this.toStreetCandidate(el))
          .filter((c): c is OsmCandidate => c !== null),
      };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryStreetsWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * Named tourism/historic/etc POI nodes within a resolved neighborhood's
   * own polygon. Never throws.
   */
  async findPoisWithin(boundary: OsmCandidate): Promise<OsmCandidate[]> {
    return (await this.lookupPoisWithin(boundary)).value;
  }

  async lookupPoisWithin(
    boundary: OsmCandidate,
  ): Promise<OsmLookupResult<OsmCandidate[]>> {
    try {
      const elements = await this.overpassApi.queryPoisWithinArea({
        osmType: boundary.osmType as 'way' | 'relation',
        osmId: boundary.osmId,
      });
      return {
        status: 'success',
        value: elements
          .map((el) => this.toCandidate(el))
          .filter((c): c is OsmCandidate => c !== null),
      };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryPoisWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * Targeted ROUTE acquisition: highway ways whose name tag EXACTLY equals
   * `name` around a destination point, normalized into route segments. The
   * structural filter lives here, at the adapter boundary, so callers never
   * read raw OSM tags.
   */
  async lookupHighwaysByName(
    params: QueryHighwaysByNameParams,
  ): Promise<OsmLookupResult<OsmRouteSegmentLookup>> {
    try {
      const elements = await this.overpassApi.queryHighwaysByName(params);
      const lookup: OsmRouteSegmentLookup = {
        rawCount: elements.length,
        segments: [],
        rejected: [],
      };
      for (const element of elements) {
        const classified = classifyRouteObject(element);
        if (typeof classified === 'string') {
          lookup.rejected.push({
            externalId: `osm:${element?.type}:${element?.id}`,
            reason: classified,
          });
        } else {
          lookup.segments.push(classified);
        }
      }
      return { status: 'success', value: lookup };
    } catch (error: any) {
      this.logger.warn(`Overpass queryHighwaysByName failed: ${error.message}`);
      return {
        status: 'failed',
        value: { rawCount: 0, segments: [], rejected: [] },
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }

  /**
   * The administrative units containing a point (`is_in`), coarse to fine.
   * Admin-hierarchy facts only; never used as an acquisition scope.
   */
  async lookupContainingAdminUnits(
    params: QueryContainingBoundaryParams,
  ): Promise<OsmLookupResult<OsmAdminUnit[]>> {
    try {
      const elements =
        await this.overpassApi.queryContainingAdminBoundaries(params);
      const units = elements
        .map(toAdminUnit)
        .filter((unit): unit is OsmAdminUnit => unit !== null)
        .sort(
          (a, b) =>
            (a.adminLevel ?? Number.MAX_SAFE_INTEGER) -
              (b.adminLevel ?? Number.MAX_SAFE_INTEGER) || a.osmId - b.osmId,
        );
      return { status: 'success', value: units };
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryContainingAdminBoundaries failed: ${error.message}`,
      );
      return {
        status: 'failed',
        value: [],
        failureReason: error.message || 'unknown Overpass error',
      };
    }
  }
}
