import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmCandidate,
  OsmLookupResult,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import { Coordinates } from '@shared/utils/distance.utils';
import {
  ExperienceEntityResolutionResponse,
  ExperienceProposalResolver,
  ExperienceResolutionRequest,
  FinalExperienceResolutionResponse,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import {
  bestNominatimMatch,
  hasSpecificNameOverlap,
  isAreaScaleEligible,
  matchOsmCandidateByName,
  normalizeGeoName,
} from '../utils/nominatim-match.util';
import { GeoEntityHint } from '../interfaces/experience-discovery.interface';
import { computeQualityScore } from '../utils/quality-score.util';
import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';

/**
 * Real margin above the live-validated MALBA distance (~50-80m between the
 * OSM-derived point and Wikidata's own point for the same real place),
 * small enough that two genuinely different nearby venues won't spuriously
 * confirm each other. Not tuned to any specific fixture. See
 * docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md
 * Task A3.
 */
const CONFIRMATION_RADIUS_METERS = 200;

// Loose radius for biasing a Places text search toward the destination when
// Nominatim/OSM had no usable match — wide enough to cover a metro area's
// outskirts (matches the same order of magnitude as
// destination-resolution.service.ts's own MAX_DESTINATION_DISTANCE_METERS)
// without being so wide it stops disambiguating same-named places in
// different cities.
const PLACES_FALLBACK_BIAS_RADIUS_METERS = 50_000;

/**
 * Upper bound on how many candidates `resolve()` resolves / persists at the
 * same time. Each accepted candidate opens its own interactive
 * `prisma.$transaction` (GeoEntity upsert + verified-Experience persist, both
 * taking `pg_advisory_xact_lock`s), and an interactive transaction holds one
 * pooled DB connection for its whole lifetime. A cold-start city (empty
 * catalog → many acquisition deficits → dozens of structured + web candidates
 * in one `resolve()` call) would otherwise fan those out unbounded and exhaust
 * the connection pool, so the surplus transactions fail with "Unable to start
 * a transaction in the given time." Keep this comfortably below the DB pool
 * size; correctness does not depend on the exact value, only throughput does.
 */
export const RESOLVER_CANDIDATE_CONCURRENCY = 4;

/**
 * Run `worker` over `items` with at most `limit` in flight at once, returning
 * results in input order regardless of completion order. Failure semantics
 * match `Promise.all(items.map(worker))`: the first rejection rejects the whole
 * call (in-flight workers are not awaited, their results are discarded).
 */
async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  const runLane = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: lanes }, () => runLane()));
  return results;
}

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
    @Optional()
    @Inject('WikidataApiService')
    private readonly wikidata?: IWikidataApiService,
  ) {}

  async resolve(
    input: ExperienceResolutionRequest,
  ): Promise<FinalExperienceResolutionResponse> {
    const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
    const evidence = input.evidence ?? [];
    const scope = input.geographicScope;
    if (!scope)
      throw new Error('Experience resolution requires a geographic scope');
    const boundary =
      scope.kind === 'AREA_BOUNDARY' ? scope.boundary : undefined;

    // A point-scale destination has no OSM area/relation. Use radius-based
    // lookups directly; AREA_BOUNDARY alone authorizes within-area queries.
    const [streetLookup, poiLookup] = await Promise.all([
      scope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupStreetsNear(
            scope.latitude,
            scope.longitude,
            scope.radiusMeters,
          )
        : this.osmPlaces.lookupStreetsWithin(scope.boundary),
      scope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupPoisNear(
            scope.latitude,
            scope.longitude,
            scope.radiusMeters,
          )
        : this.osmPlaces.lookupPoisWithin(scope.boundary),
    ]);

    // Bounded: each candidate can upsert a GeoEntity (its own interactive
    // transaction) while resolving — see RESOLVER_CANDIDATE_CONCURRENCY.
    const resolvedCandidates = await mapWithBoundedConcurrency(
      candidates,
      RESOLVER_CANDIDATE_CONCURRENCY,
      (candidate: any) =>
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
    );

    const acceptedForValidation = resolvedCandidates.filter(
      (item) => item.status === 'accepted',
    ) as ResolvedExperienceCandidate[];
    // Keyed by the candidate OBJECT itself, not `candidate.candidate.name`
    // (proposalName) -- display names are not guaranteed unique (two
    // structured/web candidates can legitimately share a name with
    // different components/geography), and a name-keyed Map would let one
    // candidate's validation result silently leak onto another, either
    // rejecting a valid candidate or persisting an invalid one under a
    // sibling's accepted result. Built inline with the map so a candidate
    // is always paired with the exact result computed for IT, regardless
    // of what any later filtering does to the result array.
    const validationByCandidate = new Map<
      ResolvedExperienceCandidate,
      ReturnType<CompositeGeographicValidationService['validate']>
    >();
    const validationResults = acceptedForValidation
      .map((item) => {
        const result = this.geographicValidator.validate(
          item,
          boundary,
          input.validationScope,
          input.validationIntent,
          scope,
        );
        validationByCandidate.set(item, result);
        return result;
      })
      .filter(
        (
          result,
        ): result is NonNullable<
          ReturnType<CompositeGeographicValidationService['validate']>
        > => result != null,
      );

    // Bounded: each accepted candidate persists inside its own interactive
    // `prisma.$transaction`, holding a pooled DB connection for its lifetime —
    // an unbounded fan-out here exhausted the pool on cold-start cities.
    const resolved = await mapWithBoundedConcurrency(
      resolvedCandidates,
      RESOLVER_CANDIDATE_CONCURRENCY,
      async (candidate) => {
        if (candidate.status !== 'accepted') return candidate;

        const geographicResult = validationByCandidate.get(candidate);
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
        // B3 live wiring (cutover M2): the one deterministic, provider-
        // neutral quality signal available at persistence time --
        // `qualityEvidence` is only ever populated (at the adapter
        // boundary) from real grounded signals, never invented, never
        // LLM-authored. This is a plain 1:1 field-name adaptation from the
        // normalized `QualityEvidence` contract onto `computeQualityScore`'s
        // pre-existing `QualityScoreInput` shape (Task B3/B3-amendment,
        // deliberately left unrenamed here -- see
        // docs/architecture/engineering-principles.md) -- never a provider
        // check. `computeQualityScore` returns `null` when no usable signal
        // exists; `persistVerifiedExperience` treats `undefined` the same
        // as omitting the field.
        const qualityEvidence = candidate.candidate.qualityEvidence;
        const qualityScore =
          computeQualityScore({
            placesRating: qualityEvidence?.consumerRating?.value,
            placesReviewCount: qualityEvidence?.consumerRating?.reviewCount,
            wikivoyageListed: qualityEvidence?.editorialListing?.listed,
            wikidataSitelinkCount: qualityEvidence?.notability?.count,
          }) ?? undefined;
        const experience = await this.catalog.persistVerifiedExperience({
          canonicalName: candidate.candidate.name,
          description: candidate.candidate.description,
          durationMinutes: candidate.candidate.suggestedDurationMinutes,
          qualityScore,
          metadata: {
            themes: candidate.candidate.themes,
            traits: candidate.candidate.traits,
            intents: candidate.candidate.intents ?? [],
            source: 'grounded_experience_discovery',
          },
          traitDefinitionIds,
          components: this.dedupeResolvedEntitiesByGeoEntity(
            candidate.resolvedEntities.filter(
              (entity: any) =>
                entity.status === 'resolved' && entity.geoEntityId,
            ),
            candidate.candidate.componentHints,
          ).map((entity: any, index: number) => ({
            geoEntityId: entity.geoEntityId,
            // Only a real, evidence-backed visiting sequence earns a
            // concrete order — otherwise this is resolution/array order,
            // not intrinsic sequence, and must persist as null.
            order: candidate.candidate.orderedByEvidence ? index + 1 : null,
            role: entity.role,
            required: entity.required,
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
      },
    );

    this.logger.log(
      `Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against trusted geography`,
    );

    const entityResolution: ExperienceEntityResolutionResponse = {
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
      validationScope: input.validationScope,
    };
  }

  private async resolveCandidate(
    candidate: any,
    boundary: OsmCandidate | undefined,
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
            ? boundary
              ? [boundary]
              : []
            : pois;
      const matched = matchOsmCandidateByName(hint.name, pool);

      if (matched) {
        const resolvedEntity = await this.persistOsmEntity(hint, matched);
        entities.push(
          (await this.confirmMatch(resolvedEntity, hint))
            ? resolvedEntity
            : this.unconfirmedEntity(hint, resolvedEntity.provider),
        );
        continue;
      }

      if (destinationAssociationVerified) {
        const globallyResolved = await this.resolveTrustedGlobalHint(
          hint,
          destinationCountryCode,
          this.representativePoint(boundary),
        );
        if (globallyResolved) {
          entities.push(
            (await this.confirmMatch(globallyResolved, hint))
              ? globallyResolved
              : this.unconfirmedEntity(hint, globallyResolved.provider),
          );
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

  /**
   * Task A3 (2026-09-17 cross-source confirmation plan): a match is only
   * as trustworthy as its identity evidence. Exact name equality in the
   * correct pool is strong enough on its own — never a false positive.
   * Anything short of that (the fuzzy token-overlap path Task 2 already
   * requires for ANY match at all) must be independently corroborated by
   * a genuinely separate database before it counts as resolved. A
   * provider outage is "cannot confirm", never "confirmed absent" — the
   * caller must treat both identically (fail closed).
   */
  private async confirmMatch(
    entity: ResolvedGeoEntity,
    hint: any,
  ): Promise<boolean> {
    const isExact =
      normalizeGeoName(entity.canonicalName || '') ===
      normalizeGeoName(hint.name);
    if (isExact) return true;
    if (!this.wikidata) return false;
    if (
      !Number.isFinite(entity.latitude) ||
      !Number.isFinite(entity.longitude)
    ) {
      return false;
    }
    let nearby: Array<{ label: string }>;
    try {
      nearby = await this.wikidata.findNearbyPlaces(
        entity.latitude as number,
        entity.longitude as number,
        CONFIRMATION_RADIUS_METERS,
      );
    } catch {
      return false;
    }
    const needle = normalizeGeoName(hint.name);
    // Task A5: confirmation requires ALL of the hint's significant tokens
    // to be present, not just >=50% -- matching stays permissive
    // (unchanged, see nominatim-match.util.ts), but a same-generic-token
    // collision (two different real places sharing one neighborhood/
    // historical-figure word) must not count as independent confirmation.
    return nearby.some((place) =>
      hasSpecificNameOverlap(needle, normalizeGeoName(place.label), {
        requireAllTokens: true,
      }),
    );
  }

  /**
   * A match that failed confirmation must never carry a `geoEntityId`
   * forward — every call site downstream (dedupeResolvedEntitiesByGeoEntity,
   * persistVerifiedExperience's `components` mapping) already filters on
   * `status === 'resolved'`, so degrading straight to `unresolved` here is
   * sufficient on its own; no other call site needs to change.
   */
  private unconfirmedEntity(hint: any, provider: string): ResolvedGeoEntity {
    return {
      hintKey: hint.key,
      hintName: hint.name,
      provider,
      externalId: '',
      role: hint.role,
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
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
      const match = bestNominatimMatch(hint.name, results, destinationPoint);
      if (
        !match ||
        !Number.isFinite(match.latitude) ||
        !Number.isFinite(match.longitude)
      ) {
        return undefined;
      }

      // Cutover M3.5 -- the same canonical scope-acceptance predicate
      // DestinationResolutionService/AreaRouteAnchorResolverService use
      // (single source of policy truth): "is this Nominatim match a
      // usable AREA" is the same question here, not a different domain
      // concern -- `hint.expectedKind === 'AREA'` alone already covers
      // "should this hint even be treated as an area."
      if (hint.expectedKind === 'AREA' && isAreaScaleEligible(match)) {
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
    const destinationTokens = normalizeGeoName(destinationName)
      .split(' ')
      .filter((token) => token.length >= 4);
    if (destinationTokens.length === 0) return false;

    const candidateEvidence = (evidence ?? []).filter((item) =>
      candidate.evidenceKeys.includes(item.key ?? ''),
    );
    return candidateEvidence.some((item) => {
      const text = normalizeGeoName(
        `${item.title ?? ''} ${item.snippet ?? ''}`,
      );
      return destinationTokens.some((token) => text.includes(token));
    });
  }

  /**
   * Two different componentHints of the *same* candidate can resolve onto
   * the *same* real GeoEntity — verified live: ExperienceCatalogService's own
   * cross-provider reconciliation (added earlier this recovery, so the same
   * real place stops minting duplicate GeoEntity rows across *different*
   * candidates/generations) makes this more likely, not less, since two
   * hints in one candidate that name near-identical/overlapping real places
   * now correctly land on one entity instead of two separate ones. Without
   * this, `persistVerifiedExperience`'s nested `components: { create: [...] }`
   * would insert the same (experienceId, geoEntityId) pair twice, crashing
   * on ExperienceComponent's own unique constraint — reproduced live: a
   * Recoleta candidate's "area" and "venue" hints reconciled onto one
   * GeoEntity, aborting the whole generation. Keeps the first occurrence
   * (preserves array order for `orderedByEvidence`'s sequential numbering).
   */
  private dedupeResolvedEntitiesByGeoEntity<
    T extends { geoEntityId?: string; hintKey?: string },
  >(
    entities: T[],
    componentHints: GeoEntityHint[] = [],
  ): (T & { required: boolean })[] {
    // `required` must be computed as the OR across EVERY resolved entity
    // that maps to that real place, BEFORE dedup collapses several hints'
    // entities onto one survivor -- an optional hint's entity surviving
    // dedup must never silently downgrade a place another (required) hint
    // also pointed at.
    const requiredByGeoEntityId = new Map<string, boolean>();
    for (const entity of entities) {
      if (!entity.geoEntityId) continue;
      const hint = componentHints.find((item) => item.key === entity.hintKey);
      const required = hint?.required ?? true;
      requiredByGeoEntityId.set(
        entity.geoEntityId,
        (requiredByGeoEntityId.get(entity.geoEntityId) ?? false) || required,
      );
    }

    const seen = new Set<string>();
    return entities
      .filter((entity) => {
        if (!entity.geoEntityId || seen.has(entity.geoEntityId)) return false;
        seen.add(entity.geoEntityId);
        return true;
      })
      .map((entity) => ({
        ...entity,
        required:
          requiredByGeoEntityId.get(entity.geoEntityId as string) ?? true,
      }));
  }

  private representativePoint(
    candidate: OsmCandidate | undefined,
  ): { latitude: number; longitude: number } | undefined {
    // Missing boundary/geometry is an unresolved geographic fact. Do not
    // fabricate a point or let a provider coverage gap crash the whole
    // acquisition pass; callers already treat an absent point as an
    // unanchored global-resolution attempt.
    if (!candidate?.geometry) return undefined;

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
