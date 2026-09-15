import { Inject, Injectable, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { Coordinates } from '@shared/utils/distance.utils';
import {
  InterpretedAnchor,
  ResolvedAnchor,
} from '../interfaces/preference-spec.interface';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  bestNominatimMatch,
  isAreaScaleEligible,
  matchOsmCandidateByName,
} from '../utils/nominatim-match.util';

/**
 * Task B5 — resolves a single AREA/ROUTE anchor to a real, persisted
 * GeoEntity using the same trusted providers (Nominatim/Overpass) and the
 * same real name-matching semantics (`nominatim-match.util.ts`) the
 * resolver itself already uses — never invents geometry, and any missing
 * step is a NORMAL `{resolved: false}` outcome, not a failure.
 */
export type AnchorGeometryResolution =
  | {
      resolved: true;
      status: 'match';
      kind: 'area' | 'route';
      geoEntityId: string;
      canonicalName?: string;
      provider?: string;
      externalId?: string;
      // The raw geometry already in hand at upsert time -- feeds
      // ExperienceValidationScope.geometry directly, no extra DB
      // round-trip.
      geometry: GeoJsonGeometry;
    }
  | { resolved: false; status: 'no_match' | 'unavailable'; reason?: string };

type NormalizedAnchorResolution =
  | { status: 'match'; anchor: ResolvedAnchor }
  | { status: 'no_match' | 'unavailable'; reason: string };

interface AnchorGeoCandidate {
  kind: 'area' | 'route' | 'venue';
  canonicalName: string;
  provider: string;
  externalId?: string;
  geometry: GeoJsonGeometry;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, string>;
}

type CandidateDiscovery =
  | { status: 'match'; candidate: AnchorGeoCandidate }
  | { status: 'no_match' | 'unavailable'; reason: string };

function normalizePlacesProvider(
  provider: IPlacesApiService['provider'],
): string {
  switch (provider) {
    case 'google':
      return 'google_places';
    case 'geoapify':
      return 'geoapify';
    default:
      return assertNever(provider);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Places provider: ${String(value)}`);
}

function representativePoint(
  geometry: GeoJsonGeometry,
): { latitude: number; longitude: number } | undefined {
  if (geometry.type === 'Point') {
    return {
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
  }
  const coordinates: Array<[number, number]> =
    geometry.type === 'LineString'
      ? geometry.coordinates
      : geometry.type === 'Polygon'
        ? geometry.coordinates[0]
        : geometry.type === 'MultiPolygon'
          ? (geometry.coordinates[0]?.[0] ?? [])
          : [];
  if (coordinates.length === 0) return undefined;
  return {
    latitude:
      coordinates.reduce((sum, [, latitude]) => sum + latitude, 0) /
      coordinates.length,
    longitude:
      coordinates.reduce((sum, [longitude]) => sum + longitude, 0) /
      coordinates.length,
  };
}

@Injectable()
export class AreaRouteAnchorResolverService {
  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly catalog: ExperienceCatalogService,
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
    @Optional()
    @Inject('PlacesApiService')
    private readonly placesApi?: IPlacesApiService,
  ) {}

  /** Resolve interpreted names to canonical GeoEntity kinds. */
  async resolveNamedAnchors(
    anchors: InterpretedAnchor[],
    options: {
      destinationCountryCode?: string;
      destinationPoint?: Coordinates;
      geographicScope: GeographicScope;
    },
  ): Promise<ResolvedAnchor[]> {
    return Promise.all(
      anchors.map(async (anchor): Promise<ResolvedAnchor> => {
        // Usage is linguistic evidence only. Every plausible canonical kind
        // remains eligible; usage may influence ranking inside provider
        // matching, never remove a kind from consideration.
        const outcomes = await Promise.all([
          this.discoverArea(
            anchor,
            options.destinationCountryCode,
            options.destinationPoint,
          ),
          this.discoverRoute(anchor, options.geographicScope),
          this.discoverPlace(anchor, options.destinationCountryCode),
        ]);
        const match = this.selectCandidate(outcomes, anchor.usage);
        if (match?.status === 'match') {
          return this.persistCandidate(anchor, match.candidate);
        }
        const unavailable = outcomes.find(
          (outcome) => outcome.status === 'unavailable',
        );
        return {
          status: 'unresolved',
          rawName: anchor.rawName,
          usage: anchor.usage,
          priority: anchor.priority,
          unresolvedReason:
            unavailable?.status === 'unavailable'
              ? `GEO_PROVIDER_UNAVAILABLE:${unavailable.reason}`
              : 'NO_CONFIDENT_GEO_ENTITY_MATCH',
        };
      }),
    );
  }

  private async discoverPlace(
    anchor: InterpretedAnchor,
    destinationCountryCode?: string,
  ): Promise<CandidateDiscovery> {
    let nominatimUnavailable = false;
    if (this.nominatim) {
      try {
        const results = await this.nominatim.search(
          anchor.rawName,
          destinationCountryCode
            ? { countryCode: destinationCountryCode }
            : undefined,
        );
        const match = bestNominatimMatch(anchor.rawName, results);
        if (
          match &&
          Number.isFinite(match.latitude) &&
          Number.isFinite(match.longitude) &&
          !isAreaScaleEligible(match)
        ) {
          const canonicalName =
            match.displayName.split(',')[0]?.trim() || anchor.rawName;
          const externalId = `osm:${match.osmType}:${match.osmId}`;
          return {
            status: 'match',
            candidate: {
              kind: 'venue',
              canonicalName,
              provider: 'nominatim',
              externalId,
              latitude: match.latitude,
              longitude: match.longitude,
              geometry: {
                type: 'Point',
                coordinates: [match.longitude, match.latitude],
              },
            },
          };
        }
        // A no-match from this provider is not authoritative: the Places
        // identity capability may still know the named destination.
      } catch {
        // Continue to the independent Places identity capability.
        nominatimUnavailable = true;
      }
    }

    if (!this.placesApi)
      return nominatimUnavailable
        ? {
            status: 'unavailable',
            reason: 'NOMINATIM_UNAVAILABLE;NO_PLACES_PROVIDER',
          }
        : { status: 'no_match', reason: 'NO_PLACES_PROVIDER' };
    try {
      const result = await this.placesApi.searchText({
        textQuery: anchor.rawName,
        maxResultCount: 3,
      });
      const place = result.data[0];
      if (!place?.location)
        return nominatimUnavailable
          ? {
              status: 'unavailable',
              reason: 'NOMINATIM_UNAVAILABLE;NO_CONFIDENT_PLACE_MATCH',
            }
          : { status: 'no_match', reason: 'NO_CONFIDENT_PLACE_MATCH' };
      const canonicalName =
        place.displayName?.text || place.name || anchor.rawName;
      const provider = normalizePlacesProvider(this.placesApi.provider);
      const externalId = `${provider}:${place.id}`;
      return {
        status: 'match',
        candidate: {
          kind: 'venue',
          canonicalName,
          provider,
          externalId,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          geometry: {
            type: 'Point',
            coordinates: [place.location.longitude, place.location.latitude],
          },
        },
      };
    } catch {
      return {
        status: 'unavailable',
        reason: nominatimUnavailable
          ? 'NOMINATIM_UNAVAILABLE;PLACES_SEARCH_FAILED'
          : 'PLACES_SEARCH_FAILED',
      };
    }
  }

  private selectCandidate(
    outcomes: CandidateDiscovery[],
    usage: InterpretedAnchor['usage'],
  ): CandidateDiscovery | undefined {
    const matches = outcomes.filter(
      (outcome): outcome is Extract<CandidateDiscovery, { status: 'match' }> =>
        outcome.status === 'match',
    );
    if (matches.length === 0) return undefined;
    const preferredKind =
      usage === 'geographic_scope'
        ? 'area'
        : usage === 'specific_destination'
          ? 'venue'
          : usage === 'named_path'
            ? 'route'
            : undefined;
    const rank = (candidate: AnchorGeoCandidate) =>
      (candidate.kind === preferredKind ? 100 : 0) +
      (candidate.kind === 'area' ? 3 : candidate.kind === 'route' ? 2 : 1);
    return [...matches].sort(
      (a, b) => rank(b.candidate) - rank(a.candidate),
    )[0];
  }

  private async persistCandidate(
    anchor: InterpretedAnchor,
    candidate: AnchorGeoCandidate,
  ): Promise<ResolvedAnchor> {
    const geo = await this.catalog.upsertGeoEntity({
      name: candidate.canonicalName,
      kind:
        candidate.kind === 'area'
          ? GeoEntityKind.AREA
          : candidate.kind === 'route'
            ? GeoEntityKind.ROUTE
            : GeoEntityKind.PLACE,
      provider: candidate.provider,
      externalId: candidate.externalId,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      geometry: candidate.geometry,
      ...(candidate.metadata ? { metadata: { tags: candidate.metadata } } : {}),
    });
    return {
      status: 'resolved',
      rawName: anchor.rawName,
      usage: anchor.usage,
      priority: anchor.priority,
      canonicalName: candidate.canonicalName,
      kind: candidate.kind,
      geoEntityId: geo.id,
      provider: candidate.provider,
      externalId: candidate.externalId,
      geometry: candidate.geometry,
    };
  }

  /**
   * Nominatim search(anchor.rawName) -> bestNominatimMatch(...,
   * destinationPoint) -> if way/relation -> osmPlaces.lookupBoundaryById ->
   * upsertGeoEntity(kind: AREA). A node-only match (no real polygon) or any
   * missing step returns {resolved:false} -- a normal outcome, never a
   * fabricated boundary.
   */
  private async discoverArea(
    anchor: InterpretedAnchor,
    destinationCountryCode: string | undefined,
    destinationPoint: Coordinates | undefined,
  ): Promise<CandidateDiscovery> {
    if (!this.nominatim)
      return { status: 'no_match', reason: 'NO_NOMINATIM_PROVIDER' };

    try {
      const results = await this.nominatim.search(
        anchor.rawName,
        destinationCountryCode
          ? { countryCode: destinationCountryCode }
          : undefined,
      );
      const match = bestNominatimMatch(
        anchor.rawName,
        results,
        destinationPoint,
      );
      // Cutover M3.5 -- the same canonical scope-acceptance predicate
      // DestinationResolutionService uses (single source of policy truth,
      // no dual scope authority). A country/state-scale or non-urban/
      // admin match is equally nonsensical as a small area anchor.
      if (!match || !isAreaScaleEligible(match)) {
        return { status: 'no_match', reason: 'NO_CONFIDENT_AREA_MATCH' };
      }

      const boundary = await this.osmPlaces.lookupBoundaryById(
        match.osmType,
        match.osmId,
      );
      if (!boundary.value) {
        return boundary.status === 'failed'
          ? {
              status: 'unavailable',
              reason: boundary.failureReason ?? 'AREA_BOUNDARY_LOOKUP_FAILED',
            }
          : { status: 'no_match', reason: 'NO_AREA_BOUNDARY' };
      }

      const point = representativePoint(boundary.value.geometry);
      return {
        status: 'match',
        candidate: {
          kind: 'area',
          canonicalName: boundary.value.name,
          provider: 'openstreetmap',
          externalId: boundary.value.id,
          latitude: point?.latitude,
          longitude: point?.longitude,
          geometry: boundary.value.geometry,
          metadata: boundary.value.tags,
        },
      };
    } catch {
      return { status: 'unavailable', reason: 'AREA_PROVIDER_FAILED' };
    }
  }

  async resolveArea(
    anchor: InterpretedAnchor,
    destinationCountryCode: string | undefined,
    destinationPoint: Coordinates | undefined,
  ): Promise<AnchorGeometryResolution> {
    const outcome = await this.discoverArea(
      anchor,
      destinationCountryCode,
      destinationPoint,
    );
    if (outcome.status !== 'match') {
      return outcome.status === 'unavailable'
        ? { resolved: false, status: 'unavailable', reason: outcome.reason }
        : { resolved: false, status: 'no_match', reason: outcome.reason };
    }
    const persisted = await this.persistCandidate(anchor, outcome.candidate);
    if (persisted.status !== 'resolved') {
      throw new Error('Selected area candidate did not resolve');
    }
    return {
      resolved: true,
      status: 'match',
      kind: 'area',
      geoEntityId: persisted.geoEntityId,
      canonicalName: outcome.candidate.canonicalName,
      provider: outcome.candidate.provider,
      externalId: outcome.candidate.externalId,
      geometry: outcome.candidate.geometry,
    };
  }

  /**
   * Named OSM highway way/street ONLY (canonical ROUTE support, v1 — no
   * OSM route *relations*). Mirrors the resolver's own point-scale/area-
   * scale street-lookup split EXACTLY: POINT_RADIUS -> `lookupStreetsNear`;
   * AREA_BOUNDARY -> `lookupStreetsWithin`,
   * never on a fabricated boundary. Any missing step returns
   * {resolved:false} -- a NORMAL outcome (falls through to the tourism-
   * route-Experience identity path), never a failure.
   */
  private async discoverRoute(
    anchor: InterpretedAnchor,
    geographicScope: GeographicScope,
  ): Promise<CandidateDiscovery> {
    try {
      const streets =
        geographicScope.kind === 'POINT_RADIUS'
          ? (
              await this.osmPlaces.lookupStreetsNear(
                geographicScope.latitude,
                geographicScope.longitude,
                geographicScope.radiusMeters,
              )
            ).value
          : (await this.osmPlaces.lookupStreetsWithin(geographicScope.boundary))
              .value;
      if (streets.length === 0)
        return { status: 'no_match', reason: 'NO_STREET_MATCHES' };

      const matched = matchOsmCandidateByName(anchor.rawName, streets);
      if (!matched)
        return { status: 'no_match', reason: 'NO_CONFIDENT_ROUTE_MATCH' };

      const point = representativePoint(matched.geometry);
      return {
        status: 'match',
        candidate: {
          kind: 'route',
          canonicalName: matched.name,
          provider: 'openstreetmap',
          externalId: matched.id,
          latitude: point?.latitude,
          longitude: point?.longitude,
          geometry: matched.geometry,
          metadata: matched.tags,
        },
      };
    } catch {
      return { status: 'unavailable', reason: 'ROUTE_PROVIDER_FAILED' };
    }
  }

  async resolveRoute(
    anchor: InterpretedAnchor,
    geographicScope: GeographicScope,
  ): Promise<AnchorGeometryResolution> {
    const outcome = await this.discoverRoute(anchor, geographicScope);
    if (outcome.status !== 'match') {
      return outcome.status === 'unavailable'
        ? { resolved: false, status: 'unavailable', reason: outcome.reason }
        : { resolved: false, status: 'no_match', reason: outcome.reason };
    }
    const persisted = await this.persistCandidate(anchor, outcome.candidate);
    if (persisted.status !== 'resolved') {
      throw new Error('Selected route candidate did not resolve');
    }
    return {
      resolved: true,
      status: 'match',
      kind: 'route',
      geoEntityId: persisted.geoEntityId,
      canonicalName: outcome.candidate.canonicalName,
      provider: outcome.candidate.provider,
      externalId: outcome.candidate.externalId,
      geometry: outcome.candidate.geometry,
    };
  }
}
