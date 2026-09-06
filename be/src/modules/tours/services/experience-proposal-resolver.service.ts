import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmCandidate,
  OsmLookupResult,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import {
  INominatimApiService,
  NominatimResult,
} from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import { calculateDistance, Coordinates } from '@shared/utils/distance.utils';
import {
  ExperienceProposalResolver,
  ExperienceResolutionRequest,
  ExperienceResolutionResponse,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';

// Loose radius for biasing a Places text search toward the destination when
// Nominatim/OSM had no usable match — wide enough to cover a metro area's
// outskirts (matches the same order of magnitude as
// destination-resolution.service.ts's own MAX_DESTINATION_DISTANCE_METERS)
// without being so wide it stops disambiguating same-named places in
// different cities.
const PLACES_FALLBACK_BIAS_RADIUS_METERS = 50_000;

@Injectable()
export class ExperienceProposalResolverService
  implements ExperienceProposalResolver
{
  private readonly logger = new Logger(ExperienceProposalResolverService.name);

  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly catalog: ExperienceCatalogService,
    private readonly geographicValidator: CompositeGeographicValidationService,
    @Optional()
    private readonly embeddingIndexer?: ExperienceEmbeddingIndexerService,
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
    @Optional()
    @Inject('PlacesApiService')
    private readonly placesApi?: IPlacesApiService,
  ) {}

  async resolve(
    input: ExperienceResolutionRequest,
  ): Promise<ExperienceResolutionResponse> {
    const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
    const evidence = input.evidence ?? [];
    const boundary = input?.destinationBoundary as OsmCandidate | undefined;
    if (!boundary) {
      throw new Error('Experience resolution requires destinationBoundary');
    }

    // A point-scale destination has no real OSM area/relation — boundary
    // here is a synthetic point-radius placeholder (osmId: 0) that a real
    // "within area" Overpass query rejects outright (verified live:
    // relation(0) returns a hard HTTP 400, not a slow query or an empty
    // result). Use the radius-based lookups instead whenever the caller
    // tells us this destination degraded to point-scale.
    const pointRadius = input.destinationPointRadius;
    const [streetLookup, poiLookup] = await Promise.all([
      pointRadius
        ? this.osmPlaces.lookupStreetsNear(
            pointRadius.latitude,
            pointRadius.longitude,
            pointRadius.radiusMeters,
          )
        : this.osmPlaces.lookupStreetsWithin(boundary),
      pointRadius
        ? this.osmPlaces.lookupPoisNear(
            pointRadius.latitude,
            pointRadius.longitude,
            pointRadius.radiusMeters,
          )
        : this.osmPlaces.lookupPoisWithin(boundary),
    ]);

    const resolvedCandidates = await Promise.all(
      candidates.map((candidate: any) =>
        this.resolveCandidate(
          candidate,
          boundary,
          streetLookup.value,
          poiLookup.value,
          { streets: streetLookup, pois: poiLookup },
          input.destinationName,
          evidence,
          input.destinationCountryCode,
        ),
      ),
    );

    const acceptedForValidation = resolvedCandidates.filter(
      (item) => item.status === 'accepted',
    ) as ResolvedExperienceCandidate[];
    const validationResults = acceptedForValidation
      .map((item) =>
        this.geographicValidator.validate(
          item,
          this.validationBoundaryFor(item, boundary),
        ),
      )
      .filter(
        (
          result,
        ): result is NonNullable<
          ReturnType<CompositeGeographicValidationService['validate']>
        > => result != null,
      );
    const validationByName = new Map(
      validationResults.map((result) => [result.proposalName, result]),
    );

    const resolved = await Promise.all(
      resolvedCandidates.map(async (candidate) => {
        if (candidate.status !== 'accepted') return candidate;

        const geographicResult = validationByName.get(candidate.candidate.name);
        if (!geographicResult?.accepted) {
          return {
            ...candidate,
            status: 'rejected' as const,
            rejectionReasons: geographicResult?.rejectionReasons ?? [
              'GEOGRAPHIC_VALIDATION_FAILED',
            ],
          };
        }

        const traitDefinitionIds =
          await this.catalog.resolveOrCreateTraitDefinitions(
            candidate.candidate.traits,
          );
        const experience = await this.catalog.persistVerifiedExperience({
          canonicalName: candidate.candidate.name,
          description: candidate.candidate.description,
          durationMinutes: candidate.candidate.suggestedDurationMinutes,
          metadata: {
            themes: candidate.candidate.themes,
            traits: candidate.candidate.traits,
            intents: candidate.candidate.intents ?? [],
            source: 'grounded_experience_discovery',
          },
          traitDefinitionIds,
          components: candidate.resolvedEntities
            .filter(
              (entity: any) =>
                entity.status === 'resolved' && entity.geoEntityId,
            )
            .map((entity: any, index: number) => ({
              geoEntityId: entity.geoEntityId,
              // Only a real, evidence-backed visiting sequence earns a
              // concrete order — otherwise this is resolution/array order,
              // not intrinsic sequence, and must persist as null.
              order: candidate.candidate.orderedByEvidence ? index + 1 : null,
              role: entity.role,
              required: true,
            })),
          evidence: evidence
            .filter((item: { key?: string }) =>
              candidate.candidate.evidenceKeys?.includes(item.key ?? ''),
            )
            .map(
              (item: {
                source: string;
                url?: string;
                title?: string;
                snippet?: string;
              }) => ({
                source: item.source,
                url: item.url,
                title: item.title,
                snippet: item.snippet,
              }),
            ),
        });

        if ((experience as any).dedupeDecision === 'AMBIGUOUS') {
          return {
            ...candidate,
            status: 'rejected' as const,
            rejectionReasons: ['AMBIGUOUS_DEDUPE'],
            dedupeEvidence: (experience as any).dedupeEvidence,
            dedupeCandidates: (experience as any).dedupeCandidates,
          };
        }

        if (
          this.embeddingIndexer &&
          ((experience as any).dedupeDecision === 'NEW' ||
            (experience as any).semanticDocumentChanged)
        ) {
          const embeddingResult = await this.embeddingIndexer.index([
            experience.id,
          ]);
          if (embeddingResult.status === 'unavailable') {
            this.logger.warn(
              `Experience embedding deferred for ${experience.id}: ${embeddingResult.reason ?? 'provider unavailable'}`,
            );
          }
        }

        return {
          ...candidate,
          experienceId: experience.id,
          dedupeDecision: (experience as any).dedupeDecision,
          dedupeEvidence: (experience as any).dedupeEvidence,
        };
      }),
    );

    this.logger.log(
      `Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against trusted geography`,
    );

    const entityResolution: ExperienceResolutionResponse = {
      totalCandidates: resolvedCandidates.length,
      acceptedCount: acceptedForValidation.length,
      rejectedCount: resolvedCandidates.length - acceptedForValidation.length,
      resolved: resolvedCandidates,
    };
    const geographicValidation = {
      results: validationResults,
      acceptedCount: validationResults.filter((item) => item.accepted).length,
      rejectedCount: validationResults.filter((item) => !item.accepted).length,
      resolved: acceptedForValidation,
    };

    return {
      totalCandidates: resolved.length,
      acceptedCount: resolved.filter((item) => item.status === 'accepted')
        .length,
      rejectedCount: resolved.filter((item) => item.status === 'rejected')
        .length,
      resolved,
      entityResolution,
      geographicValidation,
      materialization: { resolved },
    };
  }

  private async resolveCandidate(
    candidate: any,
    boundary: OsmCandidate,
    streets: OsmCandidate[],
    pois: OsmCandidate[],
    osmLookups: {
      streets: OsmLookupResult<OsmCandidate[]>;
      pois: OsmLookupResult<OsmCandidate[]>;
    },
    destinationName?: string,
    evidence: ExperienceResolutionRequest['evidence'] = [],
    destinationCountryCode?: string,
  ) {
    const entities: ResolvedGeoEntity[] = [];
    const destinationAssociationVerified =
      this.hasDestinationAssociationEvidence(
        candidate,
        destinationName,
        evidence,
      );

    for (const hint of candidate?.componentHints ?? []) {
      const pool =
        hint.expectedKind === 'ROUTE' || hint.role === 'route'
          ? streets
          : hint.expectedKind === 'AREA' || hint.role === 'area'
            ? [boundary]
            : pois;
      const matched = this.matchCandidate(hint.name, pool);

      if (matched) {
        entities.push(await this.persistOsmEntity(hint, matched));
        continue;
      }

      if (destinationAssociationVerified) {
        const globallyResolved = await this.resolveTrustedGlobalHint(
          hint,
          destinationCountryCode,
          this.representativePoint(boundary),
        );
        if (globallyResolved) {
          entities.push(globallyResolved);
          continue;
        }
      }

      const lookup =
        hint.expectedKind === 'ROUTE' || hint.role === 'route'
          ? osmLookups.streets
          : osmLookups.pois;
      const reason =
        lookup.status === 'failed'
          ? 'OSM_PROVIDER_FAILED'
          : lookup.value.length === 0
            ? 'OSM_QUERY_EMPTY'
            : 'NO_OSM_MATCH';
      entities.push({
        hintKey: hint.key,
        hintName: hint.name,
        provider: 'openstreetmap',
        externalId: '',
        role: hint.role,
        status: 'unresolved',
        reason,
      });
    }

    const required = (candidate?.componentHints ?? []).filter(
      (hint: any) => hint.required,
    );
    const unresolvedRequired = required.some(
      (hint: any) =>
        !entities.find(
          (entity) =>
            entity.hintKey === hint.key && entity.status === 'resolved',
        ),
    );
    const resolvedEntities = entities.filter(
      (entity) => entity.status === 'resolved',
    );

    if (resolvedEntities.length === 0 || unresolvedRequired) {
      return {
        candidate,
        status: 'rejected' as const,
        resolvedEntities: entities,
        destinationAssociationVerified,
        rejectionReasons: [
          resolvedEntities.length === 0
            ? entities.some((entity) => entity.reason === 'OSM_PROVIDER_FAILED')
              ? 'OSM_PROVIDER_FAILED'
              : entities.some((entity) => entity.reason === 'OSM_QUERY_EMPTY')
                ? 'OSM_QUERY_EMPTY'
                : 'NO_OSM_MATCH'
            : 'UNRESOLVED_REQUIRED_COMPONENT',
        ],
      };
    }

    return {
      candidate,
      status: 'accepted' as const,
      resolvedEntities: entities,
      destinationAssociationVerified,
      rejectionReasons: [] as string[],
    };
  }

  private async persistOsmEntity(
    hint: any,
    matched: OsmCandidate,
  ): Promise<ResolvedGeoEntity> {
    const kind =
      hint.expectedKind === 'ROUTE'
        ? GeoEntityKind.ROUTE
        : hint.expectedKind === 'AREA'
          ? GeoEntityKind.AREA
          : GeoEntityKind.PLACE;
    const point = this.representativePoint(matched);
    const geo = await this.catalog.upsertGeoEntity({
      name: matched.name,
      kind,
      provider: 'openstreetmap',
      externalId: matched.id,
      latitude: point?.latitude,
      longitude: point?.longitude,
      geometry: matched.geometry,
      metadata: { tags: matched.tags },
    });
    return Object.assign(
      {
        hintKey: hint.key,
        hintName: hint.name,
        provider: 'openstreetmap',
        externalId: matched.id,
        canonicalName: matched.name,
        latitude: point?.latitude,
        longitude: point?.longitude,
        geometry: matched.geometry,
        role: hint.role,
        status: 'resolved' as const,
      },
      { geoEntityId: geo.id },
    );
  }

  private async resolveTrustedGlobalHint(
    hint: any,
    destinationCountryCode?: string,
    destinationPoint?: Coordinates,
  ): Promise<ResolvedGeoEntity | undefined> {
    const resolved = await this.resolveViaNominatim(
      hint,
      destinationCountryCode,
      destinationPoint,
    );
    if (resolved) return resolved;

    // Nominatim/OSM has real coverage gaps for small, well-known urban
    // landmarks — verified live: a real cathedral in San Juan capital
    // (confirmed on Google Maps) has no name tag at all in OpenStreetMap at
    // its real coordinates, just an anonymous "house" node. Google Places
    // (or whichever provider PLACES_PROVIDER selects — Geoapify's own
    // searchText is a documented no-op stub, so this only ever helps when
    // Google is the active provider, never regresses when it isn't) covers
    // exactly this class of real, commercially/institutionally documented
    // place that OSM's community tagging often misses. Only PLACE hints —
    // AREA/ROUTE stay OSM-only, same restriction the Nominatim path itself
    // already applies.
    return this.resolveViaPlaces(hint, destinationPoint);
  }

  private async resolveViaNominatim(
    hint: any,
    destinationCountryCode?: string,
    destinationPoint?: Coordinates,
  ): Promise<ResolvedGeoEntity | undefined> {
    if (!this.nominatim || hint.expectedKind === 'ROUTE') return undefined;

    try {
      const results = await this.nominatim.search(
        hint.name,
        destinationCountryCode
          ? { countryCode: destinationCountryCode }
          : undefined,
      );
      const match = this.bestNominatimMatch(
        hint.name,
        results,
        destinationPoint,
      );
      if (
        !match ||
        !Number.isFinite(match.latitude) ||
        !Number.isFinite(match.longitude)
      ) {
        return undefined;
      }

      if (
        hint.expectedKind === 'AREA' &&
        (match.osmType === 'way' || match.osmType === 'relation')
      ) {
        const boundary = await this.osmPlaces.lookupBoundaryById(
          match.osmType,
          match.osmId,
        );
        if (boundary.value) {
          return this.persistOsmEntity(hint, boundary.value);
        }
        return undefined;
      }

      if (hint.expectedKind !== 'PLACE') return undefined;

      const externalId = `osm:${match.osmType}:${match.osmId}`;
      const canonicalName =
        match.displayName.split(',')[0]?.trim() || hint.name;
      const geometry = {
        type: 'Point' as const,
        coordinates: [match.longitude as number, match.latitude as number],
      };
      const geo = await this.catalog.upsertGeoEntity({
        name: canonicalName,
        kind: GeoEntityKind.PLACE,
        provider: 'nominatim',
        externalId,
        latitude: match.latitude,
        longitude: match.longitude,
        geometry,
        metadata: {
          displayName: match.displayName,
          addresstype: match.addresstype,
          address: match.address,
        },
      });
      return Object.assign(
        {
          hintKey: hint.key,
          hintName: hint.name,
          provider: 'nominatim',
          externalId,
          canonicalName,
          latitude: match.latitude,
          longitude: match.longitude,
          geometry,
          role: hint.role,
          status: 'resolved' as const,
          adminContext: {
            country: match.address?.country,
            region: match.address?.state,
            locality:
              match.address?.city ??
              match.address?.town ??
              match.address?.village ??
              match.address?.municipality,
            municipality: match.address?.municipality,
          },
        },
        { geoEntityId: geo.id },
      );
    } catch (error: any) {
      this.logger.warn(
        `Global trusted resolution failed for "${hint.name}": ${error?.message ?? error}`,
      );
      return undefined;
    }
  }

  /**
   * Fallback for a PLACE hint Nominatim/OSM couldn't resolve. Uses whichever
   * IPlacesApiService the PLACES_PROVIDER env var selects (Google or
   * Geoapify — see integrations.module.ts's createRealPlacesApiService), the
   * same caching-wrapped instance the catalog-refill path already uses, so
   * this consumes the exact same quota/cache as the rest of the app rather
   * than a second, separately-configured client.
   */
  private async resolveViaPlaces(
    hint: any,
    destinationPoint?: Coordinates,
  ): Promise<ResolvedGeoEntity | undefined> {
    if (!this.placesApi || hint.expectedKind !== 'PLACE') return undefined;

    try {
      const result = await this.placesApi.searchText({
        textQuery: hint.name,
        maxResultCount: 3,
        locationBias: destinationPoint
          ? {
              center: destinationPoint,
              radius: PLACES_FALLBACK_BIAS_RADIUS_METERS,
            }
          : undefined,
      });
      const place = result.data[0];
      if (
        !place?.location ||
        !Number.isFinite(place.location.latitude) ||
        !Number.isFinite(place.location.longitude)
      ) {
        return undefined;
      }

      const providerLabel =
        this.placesApi.provider === 'google' ? 'google_places' : 'geoapify';
      const canonicalName = place.displayName?.text || place.name || hint.name;
      const externalId = `${providerLabel}:${place.id}`;
      const geometry = {
        type: 'Point' as const,
        coordinates: [place.location.longitude, place.location.latitude],
      };
      const geo = await this.catalog.upsertGeoEntity({
        name: canonicalName,
        kind: GeoEntityKind.PLACE,
        provider: providerLabel,
        externalId,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        geometry,
        metadata: {
          formattedAddress: place.formattedAddress,
          types: place.types,
        },
      });
      return Object.assign(
        {
          hintKey: hint.key,
          hintName: hint.name,
          provider: providerLabel,
          externalId,
          canonicalName,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          geometry,
          role: hint.role,
          status: 'resolved' as const,
        },
        { geoEntityId: geo.id },
      );
    } catch (error: any) {
      this.logger.warn(
        `Places fallback resolution failed for "${hint.name}": ${error?.message ?? error}`,
      );
      return undefined;
    }
  }

  private hasDestinationAssociationEvidence(
    candidate: any,
    destinationName: string | undefined,
    evidence: ExperienceResolutionRequest['evidence'],
  ): boolean {
    if (!destinationName || !candidate?.evidenceKeys?.length) return false;
    const destinationTokens = this.normalize(destinationName)
      .split(' ')
      .filter((token) => token.length >= 4);
    if (destinationTokens.length === 0) return false;

    const candidateEvidence = (evidence ?? []).filter((item) =>
      candidate.evidenceKeys.includes(item.key ?? ''),
    );
    return candidateEvidence.some((item) => {
      const text = this.normalize(`${item.title ?? ''} ${item.snippet ?? ''}`);
      return destinationTokens.some((token) => text.includes(token));
    });
  }

  private validationBoundaryFor(
    candidate: ResolvedExperienceCandidate,
    destinationBoundary: OsmCandidate,
  ): OsmCandidate {
    if (!candidate.destinationAssociationVerified) return destinationBoundary;
    const anchors = candidate.resolvedEntities.filter(
      (entity) =>
        entity.status === 'resolved' &&
        Number.isFinite(entity.latitude) &&
        Number.isFinite(entity.longitude),
    );
    if (anchors.length === 0) return destinationBoundary;

    const allOutside = anchors.every(
      (entity) => !this.isInsideBoundary(entity, destinationBoundary),
    );
    if (!allOutside) return destinationBoundary;

    const latitudes = anchors.map((entity) => entity.latitude as number);
    const longitudes = anchors.map((entity) => entity.longitude as number);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const margin = 0.002;
    return {
      id: 'synthetic:grounded-association-scope',
      name: `Grounded association scope for ${candidate.candidate.name}`,
      osmType: 'relation',
      osmId: 0,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [minLon - margin, minLat - margin],
            [maxLon + margin, minLat - margin],
            [maxLon + margin, maxLat + margin],
            [minLon - margin, maxLat + margin],
            [minLon - margin, minLat - margin],
          ],
        ],
      },
      tags: {
        synthetic: 'true',
        validation_scope: 'grounded_destination_association',
      },
    };
  }

  private isInsideBoundary(
    entity: ResolvedGeoEntity,
    boundary: OsmCandidate,
  ): boolean {
    if (
      !Number.isFinite(entity.latitude) ||
      !Number.isFinite(entity.longitude)
    ) {
      return false;
    }
    return geometryContainsPoint(
      boundary.geometry,
      entity.longitude as number,
      entity.latitude as number,
    );
  }

  private bestNominatimMatch(
    name: string,
    results: NominatimResult[],
    destinationPoint?: Coordinates,
  ): NominatimResult | undefined {
    const needle = this.normalize(name);
    const exact = results.filter((result) => {
      const display = this.normalize(result.displayName);
      return display === needle || display.startsWith(`${needle} `);
    });
    if (exact.length > 0) {
      return this.rankNominatimCandidates(exact, destinationPoint);
    }

    // A real landmark's grounded-evidence name and Nominatim's own canonical
    // name can differ by more than word order or punctuation. Argentina's
    // OSM data names places in Spanish ("Parque Provincial Ischigualasto")
    // while English-language grounded search evidence — and the LLM
    // extracting from it — surfaces the English form ("Ischigualasto
    // Provincial Park"). Requiring an exact literal prefix silently
    // discarded a real, unambiguous, single-result Nominatim match just
    // because "Park" never literally becomes "Parque". Fall back to
    // significant-token overlap against only the place-name segment of
    // displayName (never the address hierarchy after it, which would let
    // country/region tokens produce false positives on their own), guarded
    // by requiring at least one long/specific shared token so a merely
    // translated generic word can never match by itself.
    const needleTokens = needle.split(' ').filter((token) => token.length >= 4);
    if (needleTokens.length === 0) return undefined;

    const fuzzyMatches = results
      .map((result) => {
        const headSegment = this.normalize(
          result.displayName.split(',')[0] ?? '',
        );
        const headTokens = new Set(headSegment.split(' ').filter(Boolean));
        const matchedTokens = needleTokens.filter((token) =>
          headTokens.has(token),
        );
        return { result, matchedTokens };
      })
      .filter(
        (candidate) =>
          candidate.matchedTokens.length / needleTokens.length >= 0.5 &&
          candidate.matchedTokens.some((token) => token.length >= 5),
      )
      .map((candidate) => candidate.result);
    return this.rankNominatimCandidates(fuzzyMatches, destinationPoint);
  }

  /**
   * Nominatim's own `importance` is a global, name-driven popularity signal
   * with no awareness of the requested destination — verified live against
   * the real API: two real places sharing an identical name (e.g. a
   * "Catedral San Juan Bautista" in Buenos Aires and another in San Juan
   * province) can both survive the text-match filters above, and the wrong
   * one (Buenos Aires, importance 0.208) outranks the right one (San Juan,
   * importance 0.199) on importance alone. When we know where the request's
   * destination actually is, proximity to it is a far stronger signal than
   * global importance for choosing between same-named real places — so it
   * takes priority whenever it can be measured. A candidate missing
   * coordinates simply can't participate in that comparison and falls back
   * to importance, same as before this fix existed.
   */
  private rankNominatimCandidates(
    candidates: NominatimResult[],
    destinationPoint?: Coordinates,
  ): NominatimResult | undefined {
    if (candidates.length === 0) return undefined;

    if (destinationPoint) {
      const measured = candidates
        .filter(
          (result) =>
            Number.isFinite(result.latitude) &&
            Number.isFinite(result.longitude),
        )
        .map((result) => ({
          result,
          distanceKm: calculateDistance(destinationPoint, {
            latitude: result.latitude as number,
            longitude: result.longitude as number,
          }),
        }));
      if (measured.length > 0) {
        return measured.sort((a, b) => a.distanceKm - b.distanceKm)[0].result;
      }
    }

    return candidates.sort((a, b) => b.importance - a.importance)[0];
  }

  private matchCandidate(
    name: string,
    pool: OsmCandidate[],
  ): OsmCandidate | undefined {
    const needle = this.normalize(name);
    return pool.find((candidate) => {
      const haystack = this.normalize(candidate.name);
      return (
        haystack === needle ||
        haystack.includes(needle) ||
        needle.includes(haystack)
      );
    });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private representativePoint(
    candidate: OsmCandidate,
  ): { latitude: number; longitude: number } | undefined {
    const geometry = candidate.geometry;
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
}
