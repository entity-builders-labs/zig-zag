import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmCandidate,
  OsmLookupResult,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import { calculateDistance, Coordinates } from '@shared/utils/distance.utils';
import {
  ExperienceEntityResolutionResponse,
  EntityCandidate,
  ExperienceProposalResolver,
  ExperienceResolutionRequest,
  FinalExperienceResolutionResponse,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
  ResolutionAttempt,
  ResolutionStrategy,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';
import {
  bestNominatimMatch,
  countExactNormalizedMatches,
  countNominatimExactMatches,
  exactMatchCountToMultiplicity,
  isAreaScaleEligible,
  isPlaceScaleEligible,
  matchesAddressHint,
  matchOsmCandidateByName,
  normalizeGeoName,
} from '../utils/nominatim-match.util';
import { GeoEntityHint } from '../interfaces/experience-discovery.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { computeQualityScore } from '../utils/quality-score.util';
import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { findReusableObservationCandidate } from '../utils/observation-hint-correlation.util';
import {
  acquisitionLabelToPlacesProvider,
  canonicalPlacesExternalId,
  placesAcquisitionLabel,
} from '../utils/places-external-identity.util';
import { buildLocalIdentityEvidence } from '../utils/identity-evidence-builder.util';
import { IdentityVerifier } from './identity-verifier.service';
import { IdentityEvidenceCollector } from './identity-evidence-collector.service';

// OSM's `wikidata` tag is normally a single QID, but real-world tagging data
// is community-edited and occasionally holds a `;`-separated list (multiple
// disputed/merged QIDs) or other stray text -- only trust it when it's
// unambiguously exactly one well-formed QID; anything else degrades to "no
// tag", same as a candidate with no wikidata tag at all.
const OSM_WIKIDATA_QID_PATTERN = /^Q[1-9][0-9]*$/;

function extractWikidataQid(
  tags: Record<string, string> | undefined,
): string | undefined {
  const raw = tags?.wikidata?.trim();
  return raw && OSM_WIKIDATA_QID_PATTERN.test(raw) ? raw : undefined;
}

const NAME_ALIAS_TAG_KEYS = new Set([
  'official_name',
  'alt_name',
  'short_name',
  'loc_name',
]);

/**
 * Every other name the OSM candidate ITSELF already declares -- `name:xx`
 * (any language, not just en/es), `official_name`/`alt_name`/`short_name`/
 * `loc_name`, and the human-readable title inside a `wikipedia=xx:Title`
 * tag. All free: this is data the candidate already carries, comparing it
 * against the hint costs no network call and needs no independent
 * cross-reference lookup -- it is a direct declaration by the same real
 * OSM record the hint is being matched against, same trust tier as its own
 * `name` tag. `alt_name` (and occasionally others) can hold a `;`-separated
 * list -- split defensively even though most tags never do.
 */
function extractNameAliasCandidates(
  tags: Record<string, string> | undefined,
): string[] | undefined {
  if (!tags) return undefined;
  const candidates: string[] = [];
  for (const [key, value] of Object.entries(tags)) {
    if (!value) continue;
    if (key.startsWith('name:') || NAME_ALIAS_TAG_KEYS.has(key)) {
      for (const part of value.split(';')) {
        const trimmed = part.trim();
        if (trimmed) candidates.push(trimmed);
      }
    }
  }
  const wikipediaTag = tags.wikipedia?.trim();
  if (wikipediaTag) {
    const separatorIndex = wikipediaTag.indexOf(':');
    const title =
      separatorIndex > 0
        ? wikipediaTag.slice(separatorIndex + 1).trim()
        : wikipediaTag;
    if (title) candidates.push(title);
  }
  return candidates.length > 0 ? candidates : undefined;
}

/**
 * Picks a real candidate out of the Places top-N instead of trusting
 * provider rank as identity -- rank-0 is often a same-category business
 * that merely searches well for the query, not the specific place the hint
 * names. Among results with a usable coordinate: an exact (normalized)
 * name match wins over rank; with more than one exact match (a real
 * chain/franchise with multiple branches, all genuinely sharing that exact
 * name), the one closest to the destination wins -- never a guess, this is
 * the same distance-first tie-break `bestNominatimMatch` already uses
 * elsewhere in this module. Falls back to rank-0 only when no result's
 * name matches the hint at all, preserving prior behavior for the fuzzy
 * case (still independently verified afterward by `IdentityVerifier`).
 */
function selectBestPlaceCandidate(
  hintName: string,
  results: PlaceData[],
  destinationPoint?: Coordinates,
): PlaceData | undefined {
  const withCoordinates = results.filter(
    (place) =>
      Number.isFinite(place.location?.latitude) &&
      Number.isFinite(place.location?.longitude),
  );
  if (withCoordinates.length === 0) return undefined;

  const needle = normalizeGeoName(hintName);
  const exactMatches = withCoordinates.filter(
    (place) =>
      normalizeGeoName(place.displayName?.text || place.name || '') === needle,
  );
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    if (!destinationPoint) return exactMatches[0];
    return exactMatches.reduce((closest, candidate) =>
      calculateDistance(destinationPoint, {
        latitude: candidate.location!.latitude,
        longitude: candidate.location!.longitude,
      }) <
      calculateDistance(destinationPoint, {
        latitude: closest.location!.latitude,
        longitude: closest.location!.longitude,
      })
        ? candidate
        : closest,
    );
  }
  return withCoordinates[0];
}

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
  private readonly identityVerifier: IdentityVerifier;
  private readonly identityEvidenceCollector: IdentityEvidenceCollector;

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
  ) {
    this.identityVerifier = new IdentityVerifier();
    this.identityEvidenceCollector = new IdentityEvidenceCollector(wikidata);
  }

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

    // Task A6: entityResolutionScope narrows ONLY the local OSM pool
    // fetch below (and, via resolveCandidate's `poolBoundary` param, the
    // AREA-hint pool selection + trusted-global-hint fallback point) --
    // `scope`/`boundary` above are UNCHANGED and keep flowing into
    // geographic validation as the destination-wide boundary, further
    // down in this method.
    const poolScope = input.entityResolutionScope ?? scope;
    const poolBoundary =
      poolScope.kind === 'AREA_BOUNDARY' ? poolScope.boundary : undefined;

    // A point-scale destination has no OSM area/relation. Use radius-based
    // lookups directly; AREA_BOUNDARY alone authorizes within-area queries.
    const [streetLookup, poiLookup] = await Promise.all([
      poolScope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupStreetsNear(
            poolScope.latitude,
            poolScope.longitude,
            poolScope.radiusMeters,
          )
        : this.osmPlaces.lookupStreetsWithin(poolScope.boundary),
      poolScope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupPoisNear(
            poolScope.latitude,
            poolScope.longitude,
            poolScope.radiusMeters,
          )
        : this.osmPlaces.lookupPoisWithin(poolScope.boundary),
    ]);

    // Candidates remain transient through acquisition and identity verification.
    const resolvedCandidates = await mapWithBoundedConcurrency(
      candidates,
      RESOLVER_CANDIDATE_CONCURRENCY,
      (candidate: any) =>
        this.resolveCandidate(
          candidate,
          poolBoundary,
          streetLookup.value,
          poiLookup.value,
          { streets: streetLookup, pois: poiLookup },
          input.destinationName,
          evidence,
          input.destinationCountryCode,
          input.observations ?? [],
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
    observations: SourceObservation[] = [],
  ) {
    const entities: ResolvedGeoEntity[] = [];
    const destinationAssociationVerified =
      this.hasDestinationAssociationEvidence(
        candidate,
        destinationName,
        evidence,
      );

    for (const hint of candidate?.componentHints ?? []) {
      // P2-B, Phase 1: an optional, non-terminal FIRST attempt -- if this
      // run's structured acquisition already gathered an unambiguous,
      // in-scope, still-live identity for this exact hint, reuse it
      // instead of re-discovering it from scratch. Never a special
      // verification path: `IdentityVerifier` here is the SAME authority every
      // other candidate goes through below. A `false`/`undefined` result
      // is never terminal -- falls straight into the unchanged pipeline.
      const reuseCandidate = await this.resolveViaTrustedObservation(
        hint,
        observations,
        boundary,
      );
      if (reuseCandidate) {
        const decision = await this.isVerified(
          'TRUSTED_OBSERVATION_REUSE',
          reuseCandidate,
          hint,
          observations,
        );
        if (decision.status === 'VERIFIED') {
          entities.push(await this.persistVerifiedCandidate(reuseCandidate));
          continue;
        }
      }

      const isAreaHint = hint.expectedKind === 'AREA' || hint.role === 'area';
      const pool =
        hint.expectedKind === 'ROUTE' || hint.role === 'route'
          ? streets
          : isAreaHint
            ? boundary
              ? [boundary]
              : []
            : pois;
      const matched = matchOsmCandidateByName(
        hint.name,
        pool,
        hint.addressHint,
      );

      let unconfirmedLocalMatch: ResolvedGeoEntity | undefined;
      let unconfirmedGlobalMatch: ResolvedGeoEntity | undefined;
      if (matched) {
        let identityMultiplicity: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
        if (hint.expectedKind === 'ROUTE' || hint.role === 'route') {
          // Raw OSM way multiplicity does NOT establish route identity multiplicity
          identityMultiplicity = 'UNKNOWN';
        } else if (isAreaHint) {
          // Single boundary candidate
          identityMultiplicity = 'SINGLE';
        } else {
          // POI pool - legitimate identity candidates
          const exactNameCount = countExactNormalizedMatches(
            hint.name,
            pool,
            (c) => c.name,
          );
          identityMultiplicity = exactMatchCountToMultiplicity(exactNameCount);
        }
        const resolvedEntity = this.buildOsmCandidate(
          hint,
          matched,
          identityMultiplicity,
        );
        if (
          (
            await this.isVerified(
              'LOCAL_OSM_POOL',
              resolvedEntity,
              hint,
              observations,
            )
          ).status === 'VERIFIED'
        ) {
          entities.push(await this.persistVerifiedCandidate(resolvedEntity));
          continue;
        }
        // Real, live-verified regression: a local match that fails
        // confirmation must not be the final word on its own. A genuinely
        // different real entity -- one that can structurally never appear
        // in the local pool at all (e.g. "Puerto Madero", an administrative
        // boundary, can never show up in the venue-only local POI pool) --
        // may still be found through the independent global (Nominatim)
        // path below. This never loosens identity verification: the global
        // candidate goes through the exact same strict gate; it only gives
        // the hint a second, independent source to be found in. Kept
        // (rather than discarded) so a rejected local match is still the
        // reported outcome if the global path ALSO fails.
        unconfirmedLocalMatch = this.unconfirmedEntity(
          hint,
          resolvedEntity.provider,
        );
      }

      if (destinationAssociationVerified) {
        const nominatimResolved = await this.resolveViaNominatim(
          hint,
          destinationCountryCode,
          this.representativePoint(boundary),
        );
        if (nominatimResolved) {
          if (
            (
              await this.isVerified(
                'NOMINATIM',
                nominatimResolved,
                hint,
                observations,
              )
            ).status === 'VERIFIED'
          ) {
            entities.push(
              await this.persistVerifiedCandidate(nominatimResolved),
            );
            continue;
          }
          // A rejected global candidate is evidence that THIS attempt was
          // insufficient, not that the hint has no resolvable entity. In
          // particular, an AREA proposal can still be a real PLACE found by
          // the bounded local kind-correction below. Preserve the failed
          // result only as the final diagnostic if every later strategy also
          // fails; never make it terminal.
          unconfirmedGlobalMatch = this.unconfirmedEntity(
            hint,
            nominatimResolved.provider,
          );
        }

        // A Nominatim result that failed identity verification is a failed
        // attempt, not evidence that the independently allowed PLACE lookup
        // cannot succeed. Keep this ordering explicit: acquire, verify, then
        // continue to the next strategy on any non-verified decision.
        const placesResolved = await this.resolveViaPlaces(
          hint,
          this.representativePoint(boundary),
        );
        if (placesResolved) {
          if (
            (
              await this.isVerified(
                'PLACES',
                placesResolved,
                hint,
                observations,
              )
            ).status === 'VERIFIED'
          ) {
            entities.push(await this.persistVerifiedCandidate(placesResolved));
            continue;
          }
          unconfirmedGlobalMatch = this.unconfirmedEntity(
            hint,
            placesResolved.provider,
          );
        }
      }

      // Real, live-measured pattern: a discovery hint tagged role="area"
      // (a district/neighborhood) that is actually a point-like place (a
      // plaza, monument, square) -- neither the destination-wide boundary
      // nor a Nominatim administrative-area search can ever match it, even
      // though the real entity sits right there in the local POI pool.
      // Retry once against that pool, as a venue, before giving up. Never
      // widens what counts as a match or loosens confirmation -- the
      // corrected entity still goes through the exact same
      // matchOsmCandidateByName + IdentityVerifier gate a genuine venue hint
      // does; this only gives the hint a second, correctly-scoped pool to
      // be found in.
      if (isAreaHint) {
        const venueFallbackMatch = matchOsmCandidateByName(
          hint.name,
          pois,
          hint.addressHint,
        );
        if (venueFallbackMatch) {
          const correctedHint = {
            ...hint,
            role: 'venue' as const,
            expectedKind: 'PLACE' as const,
          };
          const exactNameCount = countExactNormalizedMatches(
            correctedHint.name,
            pois,
            (candidate) => candidate.name,
          );
          const resolvedEntity = this.buildOsmCandidate(
            correctedHint,
            venueFallbackMatch,
            exactMatchCountToMultiplicity(exactNameCount),
          );
          entities.push(
            (
              await this.isVerified(
                'AREA_TO_PLACE_CORRECTION',
                resolvedEntity,
                correctedHint,
                observations,
              )
            ).status === 'VERIFIED'
              ? await this.persistVerifiedCandidate(resolvedEntity)
              : this.unconfirmedEntity(correctedHint, resolvedEntity.provider),
          );
          continue;
        }
      }

      if (unconfirmedLocalMatch) {
        entities.push(unconfirmedLocalMatch);
        continue;
      }
      if (unconfirmedGlobalMatch) {
        entities.push(unconfirmedGlobalMatch);
        continue;
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
        identityMultiplicity: 'UNKNOWN',
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

  /** Builds/acquires normalized identity facts; only IdentityVerifier judges them. */
  private async isVerified(
    strategy: ResolutionStrategy,
    entity: EntityCandidate,
    hint: any,
    observations: SourceObservation[] = [],
  ): Promise<VerificationDecision> {
    const evidence = buildLocalIdentityEvidence(hint, entity);
    const attempt: ResolutionAttempt = {
      strategy,
      candidate: entity,
      evidence,
    };
    const directDecision = this.identityVerifier.verify(hint, attempt);
    if (directDecision.status === 'VERIFIED') return directDecision;
    attempt.evidence.push(
      ...(await this.identityEvidenceCollector.collect(
        hint,
        entity,
        observations,
      )),
    );
    return this.identityVerifier.verify(hint, attempt);
  }

  private async persistVerifiedCandidate(
    candidate: EntityCandidate,
  ): Promise<ResolvedGeoEntity> {
    const geo = await this.catalog.upsertGeoEntity({
      name: candidate.canonicalName,
      kind: candidate.kind,
      provider: candidate.provider,
      externalId: candidate.externalId,
      latitude: candidate.latitude ?? undefined,
      longitude: candidate.longitude ?? undefined,
      geometry: candidate.geometry,
      metadata: candidate.persistenceMetadata,
    });
    return {
      hintKey: candidate.hintKey,
      hintName: candidate.hintName,
      provider: candidate.provider,
      externalId: candidate.externalId,
      canonicalName: candidate.canonicalName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      geometry: candidate.geometry,
      role: candidate.role,
      wikidataQid: candidate.wikidataQid,
      nameAliasCandidates: candidate.nameAliasCandidates,
      addressConfirmed: candidate.addressConfirmed,
      identityMultiplicity: candidate.identityMultiplicity,
      adminContext: candidate.adminContext,
      status: 'resolved',
      geoEntityId: geo.id,
    };
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
      identityMultiplicity: 'UNKNOWN',
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
    };
  }

  private buildOsmCandidate(
    hint: any,
    matched: OsmCandidate,
    identityMultiplicity: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN',
  ): EntityCandidate {
    const kind =
      hint.expectedKind === 'ROUTE'
        ? GeoEntityKind.ROUTE
        : hint.expectedKind === 'AREA'
          ? GeoEntityKind.AREA
          : GeoEntityKind.PLACE;
    const point = this.representativePoint(matched);
    return {
      hintKey: hint.key,
      hintName: hint.name,
      provider: 'openstreetmap',
      externalId: matched.id,
      canonicalName: matched.name,
      kind,
      latitude: point?.latitude,
      longitude: point?.longitude,
      geometry: matched.geometry,
      role: hint.role,
      wikidataQid: extractWikidataQid(matched.tags),
      nameAliasCandidates: extractNameAliasCandidates(matched.tags),
      addressConfirmed: matchesAddressHint(hint.addressHint, matched.tags),
      identityMultiplicity,
      persistenceMetadata: { tags: matched.tags },
    };
  }

  private async resolveViaNominatim(
    hint: any,
    destinationCountryCode?: string,
    destinationPoint?: Coordinates,
  ): Promise<EntityCandidate | undefined> {
    if (!this.nominatim || hint.expectedKind === 'ROUTE') return undefined;

    try {
      const results = await this.nominatim.search(
        hint.name,
        destinationCountryCode
          ? { countryCode: destinationCountryCode }
          : undefined,
      );
      const match = bestNominatimMatch(hint.name, results, destinationPoint);
      const exactNameCount = countNominatimExactMatches(hint.name, results);
      const identityMultiplicity =
        exactMatchCountToMultiplicity(exactNameCount);
      if (
        !match ||
        !Number.isFinite(match.latitude) ||
        !Number.isFinite(match.longitude)
      ) {
        return undefined;
      }

      // Generalized (was: gated behind `hint.expectedKind === 'AREA'`) --
      // the discovery LLM's expectedKind/role is only a proposal, never
      // ground truth. Nominatim's own structural evidence
      // (`isAreaScaleEligible`/`isPlaceScaleEligible` -- the same canonical
      // scope-acceptance predicates DestinationResolutionService/
      // AreaRouteAnchorResolverService use) decides whether a match is
      // area-scale or point-scale; `hint.expectedKind` only gated whether
      // Nominatim runs at all (ROUTE hints skip it, above). Real
      // regression this fixes: "Puerto Madero" tagged role="venue"/
      // expectedKind="PLACE" by discovery is a genuine neighborhood --
      // before this generalization it could only ever be persisted as a
      // point, never recognized as the area it structurally is.
      if (isAreaScaleEligible(match)) {
        const boundary = await this.osmPlaces.lookupBoundaryById(
          match.osmType,
          match.osmId,
        );
        if (!boundary.value) return undefined;
        const correctedHint =
          hint.expectedKind === 'AREA'
            ? hint
            : { ...hint, role: 'area' as const, expectedKind: 'AREA' as const };
        // Pass through the identity multiplicity established from the
        // Nominatim exact-match count; hydrating the boundary does not
        // change the identity multiplicity of the original candidate set.
        return this.buildOsmCandidate(
          correctedHint,
          boundary.value,
          identityMultiplicity,
        );
      }

      if (!isPlaceScaleEligible(match)) return undefined;

      const correctedHint =
        hint.expectedKind === 'PLACE'
          ? hint
          : { ...hint, role: 'venue' as const, expectedKind: 'PLACE' as const };

      const externalId = `osm:${match.osmType}:${match.osmId}`;
      const canonicalName =
        match.displayName.split(',')[0]?.trim() || correctedHint.name;
      const geometry = {
        type: 'Point' as const,
        coordinates: [match.longitude as number, match.latitude as number],
      };
      return {
        hintKey: correctedHint.key,
        hintName: correctedHint.name,
        provider: 'nominatim',
        externalId,
        canonicalName,
        kind: GeoEntityKind.PLACE,
        latitude: match.latitude,
        longitude: match.longitude,
        geometry,
        role: correctedHint.role,
        identityMultiplicity,
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
        persistenceMetadata: {
          displayName: match.displayName,
          addresstype: match.addresstype,
          address: match.address,
        },
      };
    } catch (error: any) {
      this.logger.warn(
        `Global trusted resolution failed for "${hint.name}": ${error?.message ?? error}`,
      );
      return undefined;
    }
  }

  /**
   * P2-B, Phase 1: candidate ACQUISITION, not a new confirmation rule.
   * When a web-discovered hint's name unambiguously names the same
   * real-world thing as a structured `SourceObservation` this same
   * acquisition run already gathered (`google_places`/`geoapify`, always
   * `evidenceType: 'place'`), fetch that observation's own identity
   * deterministically instead of re-discovering it from scratch via a
   * fresh text search. Never uses `hint.evidenceKeys` -- see
   * `findReusableObservationCandidate`'s own doc comment for why that
   * correlation is structurally impossible for web hints.
   *
   * Deliberately narrow in this phase, to respect two invariants at once:
   *   - P0.1/P0.2: a single compatible observation proves nothing about
   *     real-world uniqueness -- ambiguity (2+ distinct compatible
   *     observations) or an out-of-scope/unverifiable match refuses to
   *     reuse rather than guessing. The returned candidate is NOT trusted
   *     outright -- the caller still runs it through the exact same
   *     `IdentityVerifier` gate every other candidate goes through. There is
   *     no reuse-specific fast path into confirmation.
   *   - P1: Places can only ever supply a POINT, never an AREA/ROUTE
   *     polygon -- an AREA/ROUTE-tagged hint skips this attempt entirely
   *     (never converted to PLACE just because a same-named Places
   *     observation exists) and still gets P1's own kind-correction
   *     treatment normally afterward, since a skip here is never terminal.
   *
   * A `null`/`undefined` result here is ALWAYS non-terminal: the caller
   * falls straight through to the unchanged local-pool/global pipeline, as
   * if this attempt had never run.
   */
  private async resolveViaTrustedObservation(
    hint: any,
    observations: SourceObservation[],
    poolBoundary: OsmCandidate | undefined,
  ): Promise<EntityCandidate | undefined> {
    if (
      hint.role === 'area' ||
      hint.role === 'route' ||
      hint.expectedKind === 'AREA' ||
      hint.expectedKind === 'ROUTE'
    ) {
      return undefined;
    }
    if (!this.placesApi) return undefined;

    const eligibleObservations = observations.filter(
      (observation) =>
        observation.evidenceType === 'place' &&
        Boolean(observation.externalId) &&
        acquisitionLabelToPlacesProvider(observation.provider) !== undefined,
    );
    const correlation = findReusableObservationCandidate(
      hint,
      eligibleObservations,
    );
    if (correlation.status !== 'unique') {
      this.logger.debug(
        `[P2-B] reuse ${correlation.status} for hint "${hint.name}"`,
      );
      return undefined;
    }
    const observation = correlation.observation;

    // Geographic scope is a PLAUSIBILITY filter, not identity proof -- two
    // genuinely distinct real places can share an identical name and both
    // sit inside the same destination boundary, so this check alone never
    // establishes that the correlated observation IS the entity the hint
    // meant (that is `IdentityVerifier`'s job, below, unchanged). What this
    // check actually rules out is name correlation alone concluding
    // applicability with zero geographic evidence at all -- an observation
    // whose own geo sits outside the destination isn't even a plausible
    // candidate for it, regardless of how well its name correlated. Phase
    // 1 only supports an AREA_BOUNDARY polygon scope; anything else (no
    // boundary geometry, or the observation carries no geo) fails closed
    // rather than guessing via an un-implemented radius check.
    if (
      !poolBoundary?.geometry ||
      !Number.isFinite(observation.geo?.latitude) ||
      !Number.isFinite(observation.geo?.longitude) ||
      !geometryContainsPoint(
        poolBoundary.geometry,
        observation.geo!.longitude as number,
        observation.geo!.latitude as number,
      )
    ) {
      this.logger.debug(
        `[P2-B] reuse candidate outside destination scope for hint "${hint.name}"`,
      );
      return undefined;
    }

    // Provider guard -- an externalId is only ever meaningful to the SAME
    // Places backend that emitted it.
    const requiredPlacesProvider = acquisitionLabelToPlacesProvider(
      observation.provider,
    );
    if (requiredPlacesProvider !== this.placesApi.provider) {
      this.logger.debug(
        `[P2-B] reuse provider mismatch (observation=${observation.provider}, active=${this.placesApi.provider}) for hint "${hint.name}"`,
      );
      return undefined;
    }

    // Deterministic provider fetch establishes what this observation
    // actually identifies RIGHT NOW -- the observation's own title/geo are
    // never trusted as final. Phase 1's only additional fact requested
    // beyond the pre-existing minimal field mask is `businessStatus`
    // (same billing tier `searchText` already uses) -- see
    // `GooglePlacesApiService.getPlaceDetails`. Coordinates still come
    // from the observation itself (already real, from the original
    // acquisition search); Phase 1 deliberately does not request
    // `location` here to avoid an unnecessary field-mask change.
    let details: Partial<PlaceData> | undefined;
    try {
      const result = await this.placesApi.getPlaceDetails(
        observation.externalId as string,
      );
      details = result.data;
    } catch (error: any) {
      this.logger.debug(
        `[P2-B] reuse getPlaceDetails failed for hint "${hint.name}": ${error?.message ?? error}`,
      );
      return undefined;
    }
    if (!details) return undefined;
    if (details.businessStatus === 'CLOSED_PERMANENTLY') {
      this.logger.debug(
        `[P2-B] reuse candidate closed permanently for hint "${hint.name}"`,
      );
      return undefined;
    }

    const canonicalName =
      details.displayName?.text || details.name || observation.title;
    const latitude = observation.geo!.latitude as number;
    const longitude = observation.geo!.longitude as number;
    const providerLabel = placesAcquisitionLabel(this.placesApi.provider);
    const externalId = canonicalPlacesExternalId(
      this.placesApi.provider,
      observation.externalId as string,
    );
    const geometry = {
      type: 'Point' as const,
      coordinates: [longitude, latitude],
    };
    this.logger.debug(
      `[P2-B] reuse candidate acquired for hint "${hint.name}" via ${externalId}`,
    );

    return {
      hintKey: hint.key,
      hintName: hint.name,
      provider: providerLabel,
      externalId,
      canonicalName,
      kind: GeoEntityKind.PLACE,
      latitude,
      longitude,
      geometry,
      role: hint.role,
      // One acquisition-run observation identifies the fetched provider
      // record, but never proves real-world uniqueness. Use UNKNOWN so
      // IdentityVerifier requires independent corroboration.
      identityMultiplicity: 'UNKNOWN',
      persistenceMetadata: { formattedAddress: details.formattedAddress },
    };
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
  ): Promise<EntityCandidate | undefined> {
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
      const place = selectBestPlaceCandidate(
        hint.name,
        result.data,
        destinationPoint,
      );
      const exactNameCount = countExactNormalizedMatches(
        hint.name,
        result.data,
        (candidate) => candidate.displayName?.text || candidate.name,
      );
      const identityMultiplicity =
        exactMatchCountToMultiplicity(exactNameCount);
      if (
        !place?.location ||
        !Number.isFinite(place.location.latitude) ||
        !Number.isFinite(place.location.longitude)
      ) {
        return undefined;
      }

      const providerLabel = placesAcquisitionLabel(this.placesApi.provider);
      const canonicalName = place.displayName?.text || place.name || hint.name;
      const externalId = canonicalPlacesExternalId(
        this.placesApi.provider,
        place.id,
      );
      const geometry = {
        type: 'Point' as const,
        coordinates: [place.location.longitude, place.location.latitude],
      };
      return {
        hintKey: hint.key,
        hintName: hint.name,
        provider: providerLabel,
        externalId,
        canonicalName,
        kind: GeoEntityKind.PLACE,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        geometry,
        role: hint.role,
        identityMultiplicity,
        persistenceMetadata: {
          formattedAddress: place.formattedAddress,
          types: place.types,
        },
      };
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
