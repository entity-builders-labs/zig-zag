import { Inject, Injectable, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { Coordinates } from '@shared/utils/distance.utils';
import {
  AnchoredPlace,
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
      geoEntityId: string;
      canonicalName?: string;
      provider?: string;
      externalId?: string;
      // The raw geometry already in hand at upsert time -- feeds
      // ExperienceValidationScope.geometry directly, no extra DB
      // round-trip.
      geometry: GeoJsonGeometry;
    }
  | { resolved: false };

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
    anchors: AnchoredPlace[],
    options: {
      destinationCountryCode?: string;
      destinationPoint?: Coordinates;
      geographicScope: GeographicScope;
    },
  ): Promise<ResolvedAnchor[]> {
    return Promise.all(
      anchors.map(async (anchor): Promise<ResolvedAnchor> => {
        const area =
          anchor.usage === 'specific_destination'
            ? ({ resolved: false } as const)
            : await this.resolveArea(
                anchor,
                options.destinationCountryCode,
                options.destinationPoint,
              );
        if (area.resolved) {
          return {
            ...anchor,
            kind: 'area',
            status: 'resolved',
            canonicalName: area.canonicalName ?? anchor.rawName,
            geoEntityId: area.geoEntityId,
            provider: area.provider ?? 'openstreetmap',
          };
        }

        if (anchor.usage === 'named_path' || anchor.usage === 'unknown') {
          const route = await this.resolveRoute(
            anchor,
            options.geographicScope,
          );
          if (route.resolved) {
            return {
              ...anchor,
              kind: 'route',
              status: 'resolved',
              canonicalName: route.canonicalName ?? anchor.rawName,
              geoEntityId: route.geoEntityId,
              provider: route.provider ?? 'openstreetmap',
            };
          }
        }

        if (anchor.usage === 'named_path') {
          return {
            ...anchor,
            kind: 'unknown',
            status: 'unresolved',
            unresolvedReason: 'NO_CONFIDENT_ROUTE_MATCH',
          };
        }

        const place = await this.resolvePlace(
          anchor,
          options.destinationCountryCode,
        );
        if (place) return place;

        return {
          ...anchor,
          kind: 'unknown',
          status: 'unresolved',
          unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
        };
      }),
    );
  }

  private async resolvePlace(
    anchor: AnchoredPlace,
    destinationCountryCode?: string,
  ): Promise<ResolvedAnchor | undefined> {
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
          !match ||
          !Number.isFinite(match.latitude) ||
          !Number.isFinite(match.longitude) ||
          isAreaScaleEligible(match)
        ) {
          return undefined;
        }
        const canonicalName =
          match.displayName.split(',')[0]?.trim() || anchor.rawName;
        const externalId = `osm:${match.osmType}:${match.osmId}`;
        const geo = await this.catalog.upsertGeoEntity({
          name: canonicalName,
          kind: GeoEntityKind.PLACE,
          provider: 'nominatim',
          externalId,
          latitude: match.latitude,
          longitude: match.longitude,
          geometry: {
            type: 'Point',
            coordinates: [match.longitude, match.latitude],
          },
        });
        return {
          ...anchor,
          kind: 'venue',
          status: 'resolved',
          canonicalName,
          geoEntityId: geo.id,
          provider: 'nominatim',
          externalId,
        };
      } catch {
        // Continue to the provider-neutral Places identity boundary below.
      }
    }

    if (!this.placesApi) return undefined;
    try {
      const result = await this.placesApi.searchText({
        textQuery: anchor.rawName,
        maxResultCount: 3,
      });
      const place = result.data[0];
      if (!place?.location) return undefined;
      const canonicalName =
        place.displayName?.text || place.name || anchor.rawName;
      const provider =
        this.placesApi.provider === 'google' ? 'google_places' : 'geoapify';
      const externalId = `${provider}:${place.id}`;
      const geo = await this.catalog.upsertGeoEntity({
        name: canonicalName,
        kind: GeoEntityKind.PLACE,
        provider,
        externalId,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        geometry: {
          type: 'Point',
          coordinates: [place.location.longitude, place.location.latitude],
        },
      });
      return {
        ...anchor,
        kind: 'venue',
        status: 'resolved',
        canonicalName,
        geoEntityId: geo.id,
        provider,
        externalId,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Nominatim search(anchor.rawName) -> bestNominatimMatch(...,
   * destinationPoint) -> if way/relation -> osmPlaces.lookupBoundaryById ->
   * upsertGeoEntity(kind: AREA). A node-only match (no real polygon) or any
   * missing step returns {resolved:false} -- a normal outcome, never a
   * fabricated boundary.
   */
  async resolveArea(
    anchor: AnchoredPlace,
    destinationCountryCode: string | undefined,
    destinationPoint: Coordinates | undefined,
  ): Promise<AnchorGeometryResolution> {
    if (!this.nominatim) return { resolved: false };

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
        return { resolved: false };
      }

      const boundary = await this.osmPlaces.lookupBoundaryById(
        match.osmType,
        match.osmId,
      );
      if (!boundary.value) return { resolved: false };

      const point = representativePoint(boundary.value.geometry);
      const geo = await this.catalog.upsertGeoEntity({
        name: boundary.value.name,
        kind: GeoEntityKind.AREA,
        provider: 'osm',
        externalId: boundary.value.id,
        latitude: point?.latitude,
        longitude: point?.longitude,
        geometry: boundary.value.geometry,
        metadata: { tags: boundary.value.tags },
      });
      return {
        resolved: true,
        geoEntityId: geo.id,
        canonicalName: boundary.value.name,
        provider: 'openstreetmap',
        externalId: boundary.value.id,
        geometry: boundary.value.geometry,
      };
    } catch {
      return { resolved: false };
    }
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
  async resolveRoute(
    anchor: AnchoredPlace,
    geographicScope: GeographicScope,
  ): Promise<AnchorGeometryResolution> {
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
      if (streets.length === 0) return { resolved: false };

      const matched = matchOsmCandidateByName(anchor.rawName, streets);
      if (!matched) return { resolved: false };

      const point = representativePoint(matched.geometry);
      const geo = await this.catalog.upsertGeoEntity({
        name: matched.name,
        kind: GeoEntityKind.ROUTE,
        provider: 'osm',
        externalId: matched.id,
        latitude: point?.latitude,
        longitude: point?.longitude,
        geometry: matched.geometry,
        metadata: { tags: matched.tags },
      });
      return {
        resolved: true,
        geoEntityId: geo.id,
        canonicalName: matched.name,
        provider: 'openstreetmap',
        externalId: matched.id,
        geometry: matched.geometry,
      };
    } catch {
      return { resolved: false };
    }
  }
}
