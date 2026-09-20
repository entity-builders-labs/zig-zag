import { Inject, Injectable, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmPlacesService,
  OsmCandidate,
} from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { Coordinates } from '@shared/utils/distance.utils';
import {
  InterpretedAnchor,
  ResolvedAnchor,
} from '../interfaces/preference-spec.interface';
import {
  EntityCandidate,
  GeographicScope,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  bestNominatimMatch,
  isAreaScaleEligible,
  matchOsmCandidateByName,
  normalizeGeoName,
  countNominatimExactMatches,
  countExactNormalizedMatches,
  exactMatchCountToMultiplicity,
} from '../utils/nominatim-match.util';
import {
  placesAcquisitionLabel,
  canonicalPlacesExternalId,
} from '../utils/places-external-identity.util';
import { buildLocalIdentityEvidence } from '../utils/identity-evidence-builder.util';
import { IdentityVerifier } from './identity-verifier.service';
import { IdentityEvidenceCollector } from './identity-evidence-collector.service';
import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';

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

interface AnchorGeoCandidate {
  kind: 'area' | 'route' | 'venue';
  canonicalName: string;
  provider: string;
  externalId: string;
  geometry: GeoJsonGeometry;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, string>;
  placeTypes?: string[];
  identityMultiplicity: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
  // Task A6 -- only set by discoverArea, for the real OSM way/relation
  // boundary lookupBoundaryById already returned.
  osmBoundary?: OsmCandidate;
}

type CandidateDiscovery =
  | { status: 'match'; candidate: AnchorGeoCandidate }
  | { status: 'no_match' | 'unavailable'; reason: string };

const NON_VENUE_PLACE_TYPES = new Set([
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'country',
  'locality',
  'neighborhood',
  'political',
  'postal_code',
  'premise',
  'route',
  'street_address',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'sublocality_level_4',
  'sublocality_level_5',
]);

function hasCrediblePlaceType(place: {
  primaryType?: string;
  types?: string[];
}): boolean {
  const types = [place.primaryType, ...(place.types ?? [])]
    .filter((type): type is string => typeof type === 'string')
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean);
  return (
    types.length > 0 && types.some((type) => !NON_VENUE_PLACE_TYPES.has(type))
  );
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
  private readonly identityVerifier: IdentityVerifier;
  private readonly identityEvidenceCollector: IdentityEvidenceCollector;

  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly catalog: ExperienceCatalogService,
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
    @Optional()
    @Inject('PlacesApiService')
    private readonly placesApi?: IPlacesApiService,
    @Optional()
    @Inject('WikidataApiService')
    private readonly wikidata?: IWikidataApiService,
  ) {
    this.identityVerifier = new IdentityVerifier();
    this.identityEvidenceCollector = new IdentityEvidenceCollector(wikidata);
  }

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
        const match = this.selectCandidate(outcomes);
        let verificationFailed = false;
        if (match?.status === 'match') {
          const persisted = await this.persistCandidate(
            anchor,
            match.candidate,
          );
          if (persisted) return persisted;
          // Verification failed — candidate was selected but could not be
          // confirmed. This is a distinct failure from provider unavailable.
          verificationFailed = true;
        }
        const unavailable = outcomes.find(
          (outcome) => outcome.status === 'unavailable',
        );
        return {
          status: 'unresolved',
          rawName: anchor.rawName,
          usage: anchor.usage,
          priority: anchor.priority,
          unresolvedReason: verificationFailed
            ? 'IDENTITY_NOT_VERIFIED'
            : unavailable?.status === 'unavailable'
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
          // When multiple Nominatim results share the same normalized name,
          // the exact-name match alone cannot confirm a unique identity.
          const exactNameCount = countNominatimExactMatches(
            anchor.rawName,
            results,
          );
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
              identityMultiplicity:
                exactMatchCountToMultiplicity(exactNameCount),
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
      if (!place?.location || !hasCrediblePlaceType(place))
        return nominatimUnavailable
          ? {
              status: 'unavailable',
              reason: 'NOMINATIM_UNAVAILABLE;NO_CONFIDENT_PLACE_MATCH',
            }
          : { status: 'no_match', reason: 'NO_CONFIDENT_PLACE_MATCH' };
      const canonicalName =
        place.displayName?.text || place.name || anchor.rawName;
      const provider = placesAcquisitionLabel(this.placesApi.provider);
      const externalId = canonicalPlacesExternalId(
        this.placesApi.provider,
        place.id,
      );
      // When multiple Places results share the same normalized name,
      // the exact-name match alone cannot confirm a unique identity.
      const exactNameCount = countExactNormalizedMatches(
        anchor.rawName,
        result.data,
        (p) => p.displayName?.text || p.name,
      );
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
          placeTypes: [
            ...(place.primaryType ? [place.primaryType] : []),
            ...(place.types ?? []),
          ],
          identityMultiplicity: exactMatchCountToMultiplicity(exactNameCount),
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
  ): CandidateDiscovery | undefined {
    const matches = outcomes.filter(
      (outcome): outcome is Extract<CandidateDiscovery, { status: 'match' }> =>
        outcome.status === 'match',
    );
    if (matches.length === 0) return undefined;
    const identities = new Set(
      matches.map(
        ({ candidate }) =>
          `${candidate.kind}:${normalizeGeoName(candidate.canonicalName)}`,
      ),
    );
    if (identities.size !== 1) return undefined;
    return matches[0];
  }

  /**
   * Converts an internal AnchorGeoCandidate into a transient EntityCandidate
   * suitable for the shared IdentityVerifier. The EntityCandidate carries
   * every fact needed to verify AND persist — single source of truth.
   */
  private toEntityCandidate(
    anchor: InterpretedAnchor,
    candidate: AnchorGeoCandidate,
  ): EntityCandidate {
    const kind =
      candidate.kind === 'area'
        ? GeoEntityKind.AREA
        : candidate.kind === 'route'
          ? GeoEntityKind.ROUTE
          : GeoEntityKind.PLACE;
    return {
      hintKey: anchor.rawName,
      hintName: anchor.rawName,
      provider: candidate.provider,
      externalId: candidate.externalId,
      canonicalName: candidate.canonicalName,
      kind,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      geometry: candidate.geometry,
      role: candidate.kind,
      identityMultiplicity: candidate.identityMultiplicity,
      persistenceMetadata: candidate.metadata
        ? { tags: candidate.metadata }
        : undefined,
    };
  }

  /**
   * Runs the shared identity verification gate on an anchor candidate
   * before it may be persisted. Same IdentityVerifier, same evidence
   * construction as ExperienceProposalResolverService — single identity
   * authority.
   */
  private async verifyAnchorCandidate(
    entity: EntityCandidate,
  ): Promise<VerificationDecision> {
    const evidence = buildLocalIdentityEvidence(
      { name: entity.hintName },
      entity,
    );
    const attempt = {
      strategy: 'ANCHOR_RESOLUTION' as const,
      candidate: entity,
      evidence,
    };
    const directDecision = this.identityVerifier.verify(
      { name: entity.hintName },
      attempt,
    );
    if (directDecision.status === 'VERIFIED') return directDecision;
    attempt.evidence.push(
      ...(await this.identityEvidenceCollector.collect(
        { name: entity.hintName },
        entity,
      )),
    );
    return this.identityVerifier.verify({ name: entity.hintName }, attempt);
  }

  /**
   * Verifies an anchor candidate's identity before persisting. Returns
   * null when verification fails — callers must not persist unverified
   * anchor candidates.
   */
  private async persistCandidate(
    anchor: InterpretedAnchor,
    candidate: AnchorGeoCandidate,
  ): Promise<ResolvedAnchor | null> {
    const entity = this.toEntityCandidate(anchor, candidate);
    const decision = await this.verifyAnchorCandidate(entity);
    if (decision.status !== 'VERIFIED') return null;

    const geo = await this.catalog.upsertGeoEntity({
      name: entity.canonicalName,
      kind: entity.kind,
      provider: entity.provider,
      externalId: entity.externalId,
      latitude: entity.latitude,
      longitude: entity.longitude,
      geometry: entity.geometry,
      metadata: entity.persistenceMetadata,
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
      osmBoundary: candidate.osmBoundary,
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

      // When multiple Nominatim results share the same normalized name,
      // the exact-name match alone cannot confirm a unique identity.
      const exactNameCount = countNominatimExactMatches(
        anchor.rawName,
        results,
      );

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
          osmBoundary: boundary.value,
          identityMultiplicity: exactMatchCountToMultiplicity(exactNameCount),
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
    if (!persisted || persisted.status !== 'resolved') {
      return {
        resolved: false,
        status: 'no_match',
        reason: 'IDENTITY_NOT_VERIFIED',
      };
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
          identityMultiplicity: 'UNKNOWN',
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
    if (!persisted || persisted.status !== 'resolved') {
      return {
        resolved: false,
        status: 'no_match',
        reason: 'IDENTITY_NOT_VERIFIED',
      };
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
