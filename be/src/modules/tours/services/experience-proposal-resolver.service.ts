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
  matchesAddressHint,
  matchOsmCandidateByName,
  normalizeGeoName,
} from '../utils/nominatim-match.util';
import { GeoEntityHint } from '../interfaces/experience-discovery.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
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
 * case (still independently confirmed afterward by `confirmMatch`).
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

    // Bounded: each candidate can upsert a GeoEntity (its own interactive
    // transaction) while resolving — see RESOLVER_CANDIDATE_CONCURRENCY.
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

      if (matched) {
        const resolvedEntity = await this.persistOsmEntity(hint, matched);
        entities.push(
          (await this.confirmMatch(resolvedEntity, hint, observations))
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
            (await this.confirmMatch(globallyResolved, hint, observations))
              ? globallyResolved
              : this.unconfirmedEntity(hint, globallyResolved.provider),
          );
          continue;
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
      // matchOsmCandidateByName + confirmMatch gate a genuine venue hint
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
          const resolvedEntity = await this.persistOsmEntity(
            correctedHint,
            venueFallbackMatch,
          );
          entities.push(
            (await this.confirmMatch(
              resolvedEntity,
              correctedHint,
              observations,
            ))
              ? resolvedEntity
              : this.unconfirmedEntity(correctedHint, resolvedEntity.provider),
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
  /**
   * Direct structural confirmation using the OSM candidate's OWN declared
   * `wikidata=Qxxxx` tag -- a real provider cross-reference, not a
   * name/proximity heuristic. The geo-proximity path below has to guess
   * WHICH nearby Wikidata place corresponds to the matched entity, which
   * lets a wrong-but-nearby match get confirmed by an unrelated real place
   * that happens to sit close by. When the matched entity's own OSM tags
   * already name that place unambiguously, there is nothing to guess.
   * This also recovers a genuinely correct match that the geo-proximity
   * path would reject purely because the hint's language differs from
   * Wikidata's single label there -- this checks every alias Wikidata
   * records for the entity, not just one.
   *
   * Returns `undefined` (not `false`) when Wikidata has no record of the
   * QID at all, so the caller can fall back to the geo-proximity check --
   * the same evidence situation as a candidate with no wikidata tag.
   */
  /**
   * A hint's underlying structured SourceObservation(s) may already carry
   * a provider-resolved QID (`canonicalIdentity.wikidataQid`) -- e.g. a
   * Wikivoyage entry that cites its own Wikidata item. Correlated by
   * `evidenceKeys`, the same correlation `hasDestinationAssociationEvidence`
   * already uses elsewhere in this file. Never reads anything off `hint`
   * itself beyond `evidenceKeys` -- the discovery LLM's own JSON output has
   * no `observations` to consult, so this can never surface an
   * LLM-invented identity.
   */
  private findObservationQid(
    hint: any,
    observations: SourceObservation[],
  ): string | undefined {
    for (const key of hint?.evidenceKeys ?? []) {
      const qid = observations.find((item) => item.evidenceKey === key)
        ?.canonicalIdentity?.wikidataQid;
      if (qid) return qid;
    }
    return undefined;
  }

  private async confirmViaOwnWikidataTag(
    qid: string,
    hint: any,
  ): Promise<boolean | undefined> {
    let summaries: Map<string, { label?: string; aliases?: string[] }>;
    try {
      summaries = await this.wikidata!.getEntitySummaries([qid]);
    } catch {
      return false;
    }
    const summary = summaries.get(qid);
    if (!summary) return undefined;

    const needle = normalizeGeoName(hint.name);
    const candidateLabels = [summary.label, ...(summary.aliases ?? [])].filter(
      (label): label is string => Boolean(label),
    );
    return candidateLabels.some((label) =>
      hasSpecificNameOverlap(needle, normalizeGeoName(label), {
        requireAllTokens: true,
      }),
    );
  }

  /**
   * A QID carried on the SOURCE OBSERVATION proves
   * `hint == QID` (the source independently resolved the hint's own
   * identity) -- it proves NOTHING about whether the OSM candidate the
   * local fuzzy matcher happened to pick is also that QID. Those are two
   * different relationships. Real, live-verified collision this closes:
   * hint "Recoleta Cemetery" (observation QID Q831322, correctly labeled
   * "Recoleta Cemetery" in Wikidata) fuzzy-matched to the real but
   * unrelated "Hotel Urban Suites Recoleta" -- which has no wikidata tag
   * of its own, so nothing about the hotel itself was ever checked
   * before this fix; the hint-only check trivially passed regardless of
   * which local entity got matched.
   *
   * `confirmViaOwnWikidataTag` above needs no such extra check: there,
   * the QID is read directly off the SAME entity's own OSM tags, a
   * structural self-declaration ("I am this QID"), not an independent
   * claim about the hint text. This method requires the SAME candidate
   * Wikidata record to ALSO plausibly correspond to the MATCHED entity's
   * own name -- the identical dual-check discipline the final-review fix
   * already applies to the geo-proximity path below (hint check strict,
   * matched-entity check default) -- before trusting the observation's
   * claim about identity.
   */
  private async confirmViaObservationWikidataTag(
    qid: string,
    hint: any,
    entity: ResolvedGeoEntity,
  ): Promise<boolean | undefined> {
    let summaries: Map<string, { label?: string; aliases?: string[] }>;
    try {
      summaries = await this.wikidata!.getEntitySummaries([qid]);
    } catch {
      return false;
    }
    const summary = summaries.get(qid);
    if (!summary) return undefined;

    const needle = normalizeGeoName(hint.name);
    const matchedName = normalizeGeoName(entity.canonicalName || '');
    const candidateLabels = [summary.label, ...(summary.aliases ?? [])].filter(
      (label): label is string => Boolean(label),
    );
    return candidateLabels.some((label) => {
      const normalizedLabel = normalizeGeoName(label);
      return (
        hasSpecificNameOverlap(needle, normalizedLabel, {
          requireAllTokens: true,
        }) && hasSpecificNameOverlap(matchedName, normalizedLabel)
      );
    });
  }

  private hasMatchingOwnNameTag(entity: ResolvedGeoEntity, hint: any): boolean {
    const needle = normalizeGeoName(hint.name);
    return (entity.nameAliasCandidates ?? []).some((alias) =>
      hasSpecificNameOverlap(needle, normalizeGeoName(alias), {
        requireAllTokens: true,
      }),
    );
  }

  private async confirmMatch(
    entity: ResolvedGeoEntity,
    hint: any,
    observations: SourceObservation[] = [],
  ): Promise<boolean> {
    const isExact =
      normalizeGeoName(entity.canonicalName || '') ===
      normalizeGeoName(hint.name);
    if (isExact) return true;

    // A real address either matches or it doesn't -- computed once at
    // persistOsmEntity time from the hint's own addressHint (when the
    // discovery evidence gave one) against this exact candidate's own
    // addr:housenumber/addr:street tags. Stronger and more specific than
    // any name comparison, so trusted outright, same tier as isExact.
    if (entity.addressConfirmed) return true;

    // Cheapest, most direct check: does the SAME OSM candidate already
    // declare this name itself (a translation, an official/short/local
    // name, or its own Wikipedia article title)? No network call, no
    // independent cross-reference, no risk of matching an unrelated
    // nearby place -- it is the identical real record `entity` already is,
    // just checked against every name it carries, not only its primary one.
    if (this.hasMatchingOwnNameTag(entity, hint)) return true;

    if (!this.wikidata) return false;

    // The OSM candidate's OWN `wikidata` tag is a structural
    // self-declaration by the exact entity being confirmed -- trusted
    // outright once its Wikidata record agrees with the hint (no need to
    // also re-check the matched entity's name: the entity->QID link is
    // already a direct, human-verified fact from the same OSM record).
    if (entity.wikidataQid) {
      const viaOwnTag = await this.confirmViaOwnWikidataTag(
        entity.wikidataQid,
        hint,
      );
      // `undefined` means Wikidata has no record of this QID at all (a
      // stale/miskeyed OSM tag) -- fall through to the geo-proximity check
      // below, the same evidence situation as having no tag. `true`/`false`
      // is a direct, unambiguous answer from the entity's OWN declared
      // Wikidata record and is trusted as-is -- it must NOT fall through to
      // the proximity fallback on `false`, or a wrongly-matched local
      // candidate that happens to carry its own (internally correct)
      // wikidata tag could still get confirmed by an unrelated nearby
      // place, exactly the ambiguity this direct check exists to remove.
      if (viaOwnTag !== undefined) return viaOwnTag;
    } else {
      // A QID on the source OBSERVATION is an independent claim
      // about the HINT's identity, not a declaration by the matched
      // entity itself -- the matcher could have picked the wrong local
      // candidate entirely. Requires the SAME dual-check the geo-proximity
      // path below already uses: the candidate Wikidata record must
      // satisfy the hint (strict) AND the matched entity's own name
      // (default), never the hint alone. See confirmViaObservationWikidataTag.
      const observationQid = this.findObservationQid(hint, observations);
      if (observationQid) {
        const viaObservationQid = await this.confirmViaObservationWikidataTag(
          observationQid,
          hint,
          entity,
        );
        if (viaObservationQid !== undefined) return viaObservationQid;
      }
    }

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
    const matchedName = normalizeGeoName(entity.canonicalName || '');
    // Final-review fix (round 1, 2026-09-17): Task A5's hint-only check
    // alone is not sufficient. It only asks "does some real place near
    // these coordinates plausibly correspond to what the HINT asked for" --
    // it never checks that the SAME real place has anything to do with the
    // entity that was actually matched. That gap lets a wrong-but-nearby
    // local match get confirmed purely because the coordinates it
    // contributed happen to sit near the REAL place the hint meant: e.g.
    // hint "Recoleta Cemetery" wrongly matched locally to a real OSM node
    // "Hotel Urban Suites Recoleta" -- if that hotel is within
    // CONFIRMATION_RADIUS_METERS of the real Recoleta Cemetery (a genuinely
    // plausible geography in a real, small neighborhood -- and Task A6's
    // own area-anchor narrowing makes this MORE likely, not less, since a
    // smaller local pool raises the odds that a wrong nearby match and the
    // right place are both inside it), Wikidata's real "La Recoleta
    // Cemetery" entry satisfies the hint check (both "recoleta" and
    // "cemetery" tokens present) regardless of what the matched entity is
    // actually named, wrongly confirming the hotel as the cemetery.
    //
    // The fix: BOTH checks must be satisfied by the SAME candidate Wikidata
    // place. The hint check keeps Task A5's strict `requireAllTokens: true`
    // bar (independent confirmation of the target's identity has to be
    // solid). The entity check intentionally uses the DEFAULT (non-strict)
    // bar -- it only needs to establish that the corroborating place
    // plausibly corresponds to what was actually matched, not to re-litigate
    // the strict hint bar a second time; a legitimately-confirming fuzzy
    // match (matched entity's real name genuinely matching the hint, just
    // phrased differently) still passes this easily, including trivially
    // via the exact-equality shortcut in `hasSpecificNameOverlap` when the
    // entity's canonical name literally equals the Wikidata label.
    return nearby.some(
      (place) =>
        hasSpecificNameOverlap(needle, normalizeGeoName(place.label), {
          requireAllTokens: true,
        }) &&
        hasSpecificNameOverlap(matchedName, normalizeGeoName(place.label)),
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
        wikidataQid: extractWikidataQid(matched.tags),
        nameAliasCandidates: extractNameAliasCandidates(matched.tags),
        addressConfirmed: matchesAddressHint(hint.addressHint, matched.tags),
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
      const place = selectBestPlaceCandidate(
        hint.name,
        result.data,
        destinationPoint,
      );
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
