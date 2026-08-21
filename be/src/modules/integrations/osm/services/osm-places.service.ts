import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IOverpassApiService,
  OverpassElement,
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

// OSM's admin_level varies a lot by country, but 8-11 is the plausible
// range for a city/neighborhood-level boundary in most tagging schemes.
// When queryContainingBoundary returns multiple candidates for the same
// point (neighborhood + commune + city all technically "contain" it), the
// most specific (highest) admin_level in this range wins — if nothing
// falls in range, we discard rather than guess.
const NEIGHBORHOOD_ADMIN_LEVEL_RANGE = { min: 8, max: 11 };
const DEFAULT_MAX_STREETS_RADIUS_METERS = 2500;

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

  private toCandidate(element: OverpassElement): OsmCandidate | null {
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
      return elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
    } catch (error) {
      this.logger.warn(
        `Overpass queryStreets failed, continuing without street candidates: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * The neighborhood/administrative boundary that contains a point — the
   * area candidate offered to the LLM so it never has to invent which
   * ActivityFamily a composite belongs to. Never throws, same defensive
   * fallback as findStreetsNear.
   */
  async findContainingBoundary(
    latitude: number,
    longitude: number,
  ): Promise<OsmCandidate | null> {
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

      return ranked[0]?.candidate ?? null;
    } catch (error) {
      this.logger.warn(
        `Overpass queryContainingBoundary failed, continuing without an area candidate: ${error.message}`,
      );
      return null;
    }
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
    try {
      const elements = await this.overpassApi.queryBoundaryById({
        osmType,
        osmId,
      });
      const candidates = elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
      return candidates[0] ?? null;
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryBoundaryById failed for ${osmType}/${osmId}: ${error.message}`,
      );
      return null;
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
    const cityAdminLevel = parseInt(boundary.tags.admin_level || '', 10);
    if (isNaN(cityAdminLevel)) return [];

    try {
      const elements = await this.overpassApi.queryAdminBoundariesWithinArea({
        osmType: boundary.osmType as 'way' | 'relation',
        osmId: boundary.osmId,
      });
      return elements
        .filter(
          (el) =>
            parseInt(el.tags?.admin_level || '', 10) === cityAdminLevel + 1,
        )
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryAdminBoundariesWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Named streets within a resolved neighborhood's own polygon — replaces
   * findStreetsNear's radius guess for the area-scale path (point-scale
   * destinations still use findStreetsNear, which has no polygon of its
   * own to query against). Never throws.
   */
  async findStreetsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]> {
    try {
      const elements = await this.overpassApi.queryStreetsWithinArea({
        osmType: boundary.osmType as 'way' | 'relation',
        osmId: boundary.osmId,
      });
      return elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryStreetsWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Named tourism/historic/etc POI nodes within a resolved neighborhood's
   * own polygon. Never throws.
   */
  async findPoisWithin(boundary: OsmCandidate): Promise<OsmCandidate[]> {
    try {
      const elements = await this.overpassApi.queryPoisWithinArea({
        osmType: boundary.osmType as 'way' | 'relation',
        osmId: boundary.osmId,
      });
      return elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryPoisWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return [];
    }
  }
}
