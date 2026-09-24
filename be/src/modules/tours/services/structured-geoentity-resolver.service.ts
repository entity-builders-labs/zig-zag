import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';
import { Coordinates, calculateDistance } from '@shared/utils/distance.utils';
import { isAreaScaleEligible } from '../utils/nominatim-match.util';
import {
  canonicalPlacesExternalId,
  placesAcquisitionLabel,
} from '../utils/places-external-identity.util';
import { PLACES_FALLBACK_BIAS_RADIUS_METERS } from './experience-proposal-resolver.service';
import {
  DestinationAdminBoundary,
  DestinationAdminCompatibilityService,
  DestinationCompatibilityResult,
} from './destination-admin-compatibility.service';

export type StructuredExpectedKind = 'PLACE' | 'AREA' | 'ROUTE';

export interface StructuredGeoEntityResolutionRequest {
  name: string;
  expectedKind: StructuredExpectedKind;
  destinationName: string;
  destinationCountryCode?: string;
  destinationPoint?: Coordinates;
  /**
   * The already-resolved destination's own OSM admin boundary. Required for
   * an AREA to ever be RESOLVED: destination compatibility is decided from
   * admin facts, and is UNKNOWN (never assumed) without it.
   */
  destinationBoundary?: DestinationAdminBoundary;
}

export interface StructuredCandidateFacts {
  externalId: string;
  canonicalName: string;
  provider: string;
  kind: GeoEntityKind;
  structuralType: string;
  latitude?: number;
  longitude?: number;
  adminContext?: string;
  ranking?: number;
  destinationCompatibility?: DestinationCompatibilityResult;
}

export type StructuredGeoEntityResolutionResult =
  | {
      status: 'RESOLVED';
      candidate: StructuredCandidateFacts;
      providerFacts: unknown;
    }
  | {
      status: 'AMBIGUOUS';
      candidates: StructuredCandidateFacts[];
      reason?: 'DESTINATION_COMPATIBILITY_UNKNOWN';
    }
  | { status: 'NOT_FOUND' }
  | {
      status: 'INCOMPATIBLE';
      reason: string;
      rejected?: StructuredCandidateFacts[];
    };

/**
 * Geoapify's own dotted category taxonomy for lodging -- the same product
 * exclusion Overpass's NON_EXPERIENCE_TOURISM_VALUES already applies for
 * OSM tourism=*, expressed against the provider-native category this
 * Places backend actually returns (see geoapify-places-api.service.ts's
 * `category` -> `primaryType` mapping fix). An accommodation is never
 * itself a tourist-experience component.
 */
const NON_EXPERIENCE_PLACE_CATEGORY_PREFIX = 'accommodation.';

function isNonExperiencePlaceCategory(place: PlaceData): boolean {
  return Boolean(
    place.primaryType?.startsWith(NON_EXPERIENCE_PLACE_CATEGORY_PREFIX),
  );
}

function isRouteScaleEligible(result: { class?: string }): boolean {
  return result.class === 'highway';
}

/**
 * The real-world address locality Nominatim's own address hierarchy
 * assigns a highway segment to. Two segments of the SAME real street share
 * this; two different real streets that happen to share a name (a
 * countrywide collision) normally do not.
 */
function routeLocalityKey(result: {
  address?: {
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
}): string {
  const a = result.address;
  return a?.suburb ?? a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? '';
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

@Injectable()
export class StructuredGeoEntityResolverService {
  private readonly logger = new Logger(StructuredGeoEntityResolverService.name);

  constructor(
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
    @Optional()
    @Inject('PlacesApiService')
    private readonly placesApi?: IPlacesApiService,
    @Optional()
    private readonly compatibility?: DestinationAdminCompatibilityService,
  ) {}

  async resolve(
    request: StructuredGeoEntityResolutionRequest,
  ): Promise<StructuredGeoEntityResolutionResult> {
    switch (request.expectedKind) {
      case 'AREA':
        return this.resolveArea(request);
      case 'ROUTE':
        return this.resolveRoute(request);
      case 'PLACE':
        return this.resolvePlace(request);
      default:
        return {
          status: 'INCOMPATIBLE',
          reason: `Unknown expectedKind: ${request.expectedKind}`,
        };
    }
  }

  private async resolveArea(
    request: StructuredGeoEntityResolutionRequest,
  ): Promise<StructuredGeoEntityResolutionResult> {
    if (!this.nominatim) {
      return { status: 'INCOMPATIBLE', reason: 'Nominatim not configured' };
    }
    const results = await this.nominatim.search(request.name, {
      countryCode: request.destinationCountryCode,
      bias: request.destinationPoint,
    });
    const eligible = results.filter(isAreaScaleEligible);
    if (eligible.length === 0) return { status: 'NOT_FOUND' };

    const candidates: StructuredCandidateFacts[] = [];
    for (const r of eligible) {
      candidates.push({
        externalId: `osm:${r.osmType}:${r.osmId}`,
        canonicalName: r.displayName,
        provider: 'nominatim',
        kind: GeoEntityKind.AREA,
        structuralType: `${r.class ?? 'unknown'}/${r.type ?? 'unknown'}`,
        latitude: r.latitude,
        longitude: r.longitude,
        adminContext: r.displayName,
        ranking: r.importance,
        destinationCompatibility: await this.areaCompatibility(request, r),
      });
    }

    // Destination compatibility is decided from admin facts, never from
    // distance: a single structurally-eligible survivor is NOT enough to
    // resolve when it lies outside the destination's admin unit (the
    // "San Martín" -> Partido de General San Martín false positive).
    const verdictOf = (c: StructuredCandidateFacts) =>
      c.destinationCompatibility?.verdict ?? 'UNKNOWN';
    const compatible = candidates.filter((c) => verdictOf(c) === 'COMPATIBLE');
    const unknown = candidates.filter((c) => verdictOf(c) === 'UNKNOWN');

    if (unknown.length > 0) {
      return {
        status: 'AMBIGUOUS',
        candidates: [...compatible, ...unknown],
        reason: 'DESTINATION_COMPATIBILITY_UNKNOWN',
      };
    }
    if (compatible.length === 1) {
      return {
        status: 'RESOLVED',
        candidate: compatible[0],
        providerFacts: eligible[candidates.indexOf(compatible[0])],
      };
    }
    if (compatible.length > 1) {
      return { status: 'AMBIGUOUS', candidates: compatible };
    }
    const reasons = [
      ...new Set(candidates.map((c) => c.destinationCompatibility!.reason)),
    ];
    return {
      status: 'INCOMPATIBLE',
      reason: `No AREA candidate is compatible with destination ${request.destinationName}: ${reasons.join(', ')}`,
      rejected: candidates,
    };
  }

  private async areaCompatibility(
    request: StructuredGeoEntityResolutionRequest,
    result: {
      osmType: 'node' | 'way' | 'relation';
      osmId: number;
      latitude?: number;
      longitude?: number;
    },
  ): Promise<DestinationCompatibilityResult | undefined> {
    if (
      !this.compatibility ||
      !Number.isFinite(result.latitude) ||
      !Number.isFinite(result.longitude)
    ) {
      return undefined;
    }
    return this.compatibility.evaluate(
      { latitude: result.latitude!, longitude: result.longitude! },
      {
        name: request.destinationName,
        countryCode: request.destinationCountryCode,
        boundary: request.destinationBoundary,
      },
      { osmType: result.osmType, osmId: result.osmId },
    );
  }

  private async resolveRoute(
    request: StructuredGeoEntityResolutionRequest,
  ): Promise<StructuredGeoEntityResolutionResult> {
    if (!this.nominatim) {
      return { status: 'INCOMPATIBLE', reason: 'Nominatim not configured' };
    }
    // Deliberately NOT the resolveViaNominatim early return for ROUTE --
    // the whole point of this spike is testing what happens when Nominatim
    // IS queried for a ROUTE hint. Superseded as a candidate acquisition
    // strategy by TargetedRouteResolverService (2026-09-24 targeted-route
    // spike); kept unchanged only as the "old bare-name + soft bias"
    // comparison control.
    const results = await this.nominatim.search(request.name, {
      countryCode: request.destinationCountryCode,
      bias: request.destinationPoint,
    });
    const eligible = results.filter(isRouteScaleEligible);
    if (eligible.length === 0) return { status: 'NOT_FOUND' };

    // A real street is rarely a single OSM way -- group by (normalized
    // name, real address locality) so multiple segments of the SAME real
    // street collapse into one identity, while two genuinely different
    // real streets sharing a name in different localities do not.
    const groups = new Map<string, typeof eligible>();
    for (const r of eligible) {
      const key = `${normalize(r.displayName.split(',')[0] ?? r.displayName)}|${normalize(routeLocalityKey(r))}`;
      const group = groups.get(key) ?? [];
      group.push(r);
      groups.set(key, group);
    }

    const groupEntries = [...groups.values()];
    if (groupEntries.length > 1) {
      const candidates = groupEntries.map((group) => {
        const representative = this.closestOrFirst(
          group,
          request.destinationPoint,
        );
        return {
          externalId: `osm:${representative.osmType}:${representative.osmId}`,
          canonicalName: representative.displayName,
          provider: 'nominatim',
          kind: GeoEntityKind.ROUTE,
          structuralType: `${representative.class}/${representative.type ?? 'unknown'}`,
          latitude: representative.latitude,
          longitude: representative.longitude,
          adminContext: representative.displayName,
          ranking: representative.importance,
        };
      });
      return { status: 'AMBIGUOUS', candidates };
    }

    const segments = groupEntries[0];
    const representative = this.closestOrFirst(
      segments,
      request.destinationPoint,
    );
    return {
      status: 'RESOLVED',
      candidate: {
        externalId: `osm:${representative.osmType}:${representative.osmId}`,
        canonicalName: representative.displayName,
        provider: 'nominatim',
        kind: GeoEntityKind.ROUTE,
        structuralType: `${representative.class}/${representative.type ?? 'unknown'}`,
        latitude: representative.latitude,
        longitude: representative.longitude,
        adminContext: representative.displayName,
        ranking: representative.importance,
      },
      providerFacts: {
        segmentCount: segments.length,
        segments,
      },
    };
  }

  private closestOrFirst<T extends { latitude?: number; longitude?: number }>(
    items: T[],
    destinationPoint?: Coordinates,
  ): T {
    if (!destinationPoint) return items[0];
    const withCoords = items.filter(
      (i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude),
    );
    if (withCoords.length === 0) return items[0];
    return withCoords.reduce((closest, candidate) =>
      calculateDistance(destinationPoint, {
        latitude: candidate.latitude!,
        longitude: candidate.longitude!,
      }) <
      calculateDistance(destinationPoint, {
        latitude: closest.latitude!,
        longitude: closest.longitude!,
      })
        ? candidate
        : closest,
    );
  }

  private async resolvePlace(
    request: StructuredGeoEntityResolutionRequest,
  ): Promise<StructuredGeoEntityResolutionResult> {
    if (!this.placesApi) {
      return { status: 'INCOMPATIBLE', reason: 'Places API not configured' };
    }
    const result = await this.placesApi.searchText({
      textQuery: request.name,
      maxResultCount: 5,
      locationBias: request.destinationPoint
        ? {
            center: request.destinationPoint,
            radius: PLACES_FALLBACK_BIAS_RADIUS_METERS,
          }
        : undefined,
    });

    const withCoords = result.data.filter(
      (p) =>
        Number.isFinite(p.location?.latitude) &&
        Number.isFinite(p.location?.longitude),
    );
    const structurallyCompatible = withCoords.filter(
      (p) => !isNonExperiencePlaceCategory(p),
    );
    const geoCompatible = request.destinationPoint
      ? structurallyCompatible.filter(
          (p) =>
            calculateDistance(request.destinationPoint!, {
              latitude: p.location!.latitude,
              longitude: p.location!.longitude,
            }) *
              1000 <=
            PLACES_FALLBACK_BIAS_RADIUS_METERS,
        )
      : structurallyCompatible;

    if (geoCompatible.length === 0) return { status: 'NOT_FOUND' };

    const toCandidate = (p: PlaceData): StructuredCandidateFacts => ({
      externalId: canonicalPlacesExternalId(this.placesApi!.provider, p.id),
      canonicalName: p.displayName?.text || p.name || request.name,
      provider: placesAcquisitionLabel(this.placesApi!.provider),
      kind: GeoEntityKind.PLACE,
      structuralType: p.primaryType ?? 'unknown',
      latitude: p.location?.latitude,
      longitude: p.location?.longitude,
      adminContext: p.formattedAddress,
    });

    if (geoCompatible.length === 1) {
      return {
        status: 'RESOLVED',
        candidate: toCandidate(geoCompatible[0]),
        providerFacts: geoCompatible[0],
      };
    }
    return { status: 'AMBIGUOUS', candidates: geoCompatible.map(toCandidate) };
  }
}
