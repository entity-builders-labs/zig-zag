import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ExperienceStatus, GeoEntityKind, Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import {
  IPlacesApiService,
  PlacesCrawlError,
} from '@integrations/google-places/interfaces/places-api.interface';
import { GooglePlacesAcquisitionProvider } from '../providers/google-places-acquisition.provider';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { AreaScopeMembershipPolicy } from '../interfaces/area-scope-membership.interface';
import { evaluateAreaScopeMembership } from '../utils/area-scope-membership-policy';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';

const GENERIC_REFILL_EVIDENCE_REQUIREMENTS = [
  'SINGLE_PLACE',
  'MULTI_COMPONENT_EXPERIENCE',
] as const satisfies readonly AcquisitionEvidenceRequirement[];
import { NormalizedOpeningHours } from '../interfaces/daily-planning.interface';
import {
  distanceMeters,
  normalizeRealWorldName,
  REAL_WORLD_RECONCILIATION_RADIUS_METERS,
  realWorldNamesMatch,
} from '../utils/real-world-entity-matching.util';
import {
  decideExperienceDedupe,
  DedupeExperienceFingerprint,
} from '../utils/experience-dedupe.util';
import { mergeExperienceMetadata } from '../utils/experience-metadata-merge.util';
import { normalizeGeoName } from '../utils/nominatim-match.util';
import { ClassificationResult } from './experience-classification.service';
import { ExperienceGroundingEvidence } from '../interfaces/experience-grounding.interface';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { ScopeSearchWindow } from '../interfaces/experience-geographic-scope.interface';

// Two different resolution paths (a Nominatim lookup done while resolving a
// composite's `venue` component hint, a Google Places lookup done while
// acquiring the *same* real place as its own standalone POI Experience on a
// different pass) commonly mint two different (provider, externalId) pairs
// for one physical place — GeoEntityIdentity's exact-match dedupe never
// catches that, since the identities genuinely differ. Verified live: a real
// Buenos Aires plaza (Plaza Dorrego) ended up as two independent GeoEntity
// rows ~3m apart, so the same physical place was offered to a traveler twice
// in one tour (once standalone, once as a composite's component) with no way
// for the daily-planning solver to know they were the same place. Tight
// enough to not conflate two distinct, unrelated things that happen to sit
// close together (e.g. a plaza and the café facing it); wide enough to
// absorb real cross-provider geocoding jitter for the same building/plaza —
// also verified live: a real, extended place (Caminito, a ~150-200m
// pedestrian street in La Boca, not a small point) resolved ~80m apart across
// two paths and slipped past an earlier 75m radius, so this needs to cover a
// street-scale feature's own real extent, not just point jitter.
const GEO_ENTITY_RECONCILIATION_RADIUS_METERS =
  REAL_WORLD_RECONCILIATION_RADIUS_METERS;

/**
 * Internal hydration page size for `findVerifiedWithinForMatching` (Task
 * A6.1). This is a batching/performance detail only, never a
 * correctness-visible cap: every in-scope id PostGIS returns is hydrated
 * across however many batches it takes, in its original distance/id order.
 */
const HYDRATION_BATCH_SIZE = 500;

/**
 * Union of two line geometries as a MultiLineString: every real segment line
 * of both, duplicate lines (same vertices at OSM's 1e-7 precision) dropped,
 * order preserved (persisted lines first).
 * Returns undefined when either side is not line-shaped -- a non-line
 * geometry is never overwritten by a route merge.
 */
function unionLineGeometry(
  persisted: unknown,
  incoming: unknown,
): MultiLineStringGeometry | undefined {
  const linesOf = (geometry: unknown): [number, number][][] | undefined => {
    const g = geometry as { type?: string; coordinates?: unknown } | null;
    if (g?.type === 'MultiLineString') {
      return g.coordinates as [number, number][][];
    }
    if (g?.type === 'LineString') return [g.coordinates as [number, number][]];
    return undefined;
  };
  const existingLines = linesOf(persisted);
  const incomingLines = linesOf(incoming);
  if (!existingLines || !incomingLines) return undefined;
  const seen = new Set<string>();
  const coordinates: [number, number][][] = [];
  for (const lineCoordinates of [...existingLines, ...incomingLines]) {
    // OSM stores coordinates at 1e-7 degrees; keying at that precision
    // absorbs the float drift of a jsonb (numeric) round-trip without ever
    // treating two genuinely different vertices as the same.
    const key = lineCoordinates
      .map(([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`)
      .join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    coordinates.push(lineCoordinates);
  }
  return { type: 'MultiLineString', coordinates };
}

export interface GeoEntityInput {
  name: string;
  kind: GeoEntityKind;
  provider: string;
  externalId: string;
  latitude?: number;
  longitude?: number;
  geometry?: unknown;
  address?: string;
  metadata?: unknown;
}

/**
 * One real-world entity observed through SEVERAL provider-native objects
 * (e.g. a street split by OSM into many ways). Every identity is a real
 * provider object; there is never a synthetic cluster identity.
 */
export interface GeoEntityWithIdentitiesInput {
  name: string;
  kind: GeoEntityKind;
  /** Non-empty; each becomes one `GeoEntityIdentity` row. */
  identities: Array<{ provider: string; externalId: string }>;
  /** Deterministic representative point; never an identity fact. */
  latitude?: number;
  longitude?: number;
  /**
   * A PLACE's Point, or for a multi-segment ROUTE a `MultiLineString` of
   * the real segments. On reuse, ROUTE lines are unioned with the persisted
   * ones (duplicate lines dropped at OSM coordinate precision; gaps never
   * bridged by a synthetic connector); a Point is left as persisted.
   */
  geometry?: GeoJsonGeometry;
  address?: string;
  metadata?: unknown;
}

export type MultiLineStringGeometry = Extract<
  GeoJsonGeometry,
  { type: 'MultiLineString' }
>;

export type GeoEntityWithIdentitiesResult =
  | {
      status: 'CREATED' | 'REUSED';
      geoEntity: { id: string };
      /** Identities newly attached by this call (sorted). */
      attachedExternalIds: string[];
    }
  | {
      /**
       * The input identities already belong to 2+ different GeoEntities.
       * Never merged silently and never decided by proximity; nothing is
       * written.
       */
      status: 'IDENTITY_CONFLICT';
      conflictingGeoEntityIds: string[];
    };

/**
 * Stage 3 — bounded, provider-neutral catalog read for one component hint.
 * Never a fuzzy identity engine: this is a plain (kind + geographic bound +
 * strict normalized-name equality) retrieval. The catalog service returns
 * candidates/facts only; it never declares identity truth (that stays
 * IdentityVerifier's job at the resolver seam).
 */
export interface FindGeoEntityCandidatesForHintRequest {
  hintName: string;
  expectedKind: GeoEntityKind;
  /** The resolver's scope-derived search window (spec 2026-10-02 Part II
   * §P2-10) — no second geographic authority is introduced here. */
  window: ScopeSearchWindow;
}

export interface CatalogGeoEntityCandidate {
  geoEntityId: string;
  name: string;
  kind: GeoEntityKind;
  latitude: number | null;
  longitude: number | null;
  geometry: unknown;
  address: string | null;
  /** Deterministically ordered (createdAt asc) so a caller that needs to
   * pick one persisted identity for provenance does so deterministically. */
  identities: Array<{ provider: string; externalId: string }>;
  /**
   * How the row matched the hint: its canonical `name`, or a key in its
   * verified hint memory (`verifiedHintNameKeys`). A row matching both is
   * reported once, as CANONICAL_NAME.
   */
  matchKind: 'CANONICAL_NAME' | 'VERIFIED_HINT';
}

export type RememberVerifiedHintNameResult =
  | 'REMEMBERED'
  | 'ALREADY_REMEMBERED'
  | 'EMPTY_KEY';

export interface FindGeoEntityCandidatesForHintResult {
  candidates: CatalogGeoEntityCandidate[];
}

export interface VerifiedExperienceInput {
  canonicalName: string;
  description?: string;
  durationMinutes?: number;
  price?: number;
  qualityScore?: number;
  latitude?: number;
  longitude?: number;
  openingHours?: NormalizedOpeningHours;
  metadata?: unknown;
  components: Array<{
    geoEntityId: string;
    /** `null` (not just absent) means no intrinsic sequence evidence exists. */
    order?: number | null;
    role?: string;
  }>;
  evidence?: Array<{
    source: string;
    url?: string;
    title?: string;
    snippet?: string;
  }>;
  traitDefinitionIds?: string[];
}

@Injectable()
export class ExperienceCatalogService {
  private readonly logger = new Logger(ExperienceCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('PlacesApiService') private readonly placesApi: IPlacesApiService,
    @Optional()
    private readonly googlePlacesProvider?: GooglePlacesAcquisitionProvider,
    @Optional()
    private readonly candidateSynthesizer?: StructuredExperienceCandidateSynthesizerService,
    @Optional()
    private readonly corroborationService?: StructuredCandidateCorroborationService,
  ) {}

  async acquireNearbyAsExperiences(input: {
    latitude: number;
    longitude: number;
    radius: number;
    interests?: string[];
    maxResultCount?: number;
  }) {
    const placesProvider =
      this.googlePlacesProvider ??
      new GooglePlacesAcquisitionProvider(this.placesApi);
    const synthesizer =
      this.candidateSynthesizer ??
      new StructuredExperienceCandidateSynthesizerService();
    const corroborator =
      this.corroborationService ??
      new StructuredCandidateCorroborationService();

    const providerResult = await placesProvider.acquire(
      {
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radius,
      },
      {
        radiusMeters: input.radius,
        maxResultCount: input.maxResultCount,
      },
    );

    // A provider *failure* is not an empty acquisition. Zero results
    // (`status: 'success', value: []`) is a normal empty pass; a failure
    // (`status: 'failed'`) must stay observably distinct — surface it as a
    // structured PlacesCrawlError carrying truthful provenance so the refill
    // seam in ExperienceGenerationService records "Places failed" rather than
    // "Places found nothing", and generation proceeds with whatever other
    // sources produced.
    if (providerResult.status === 'failed') {
      throw new PlacesCrawlError(
        `Google Places acquisition failed during catalog refill: ${
          providerResult.failureReason ?? 'unknown provider error'
        }`,
        {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: input.maxResultCount ?? 20,
          receivedCount: 0,
          acceptedCount: 0,
          rejectedCountByReason: {},
        },
        undefined,
        'request_failed',
      );
    }

    const observations = providerResult.value;
    if (observations.length === 0) {
      return {
        experienceIds: [] as string[],
        experiences: [] as any[],
        candidates: [] as any[],
        observations: [] as any[],
        provenance: {
          provider: 'google' as const,
          cacheStatus: 'miss-live' as const,
          requestedCount: input.maxResultCount ?? 20,
          receivedCount: 0,
        },
      };
    }

    // Pass observations through structured proposal synthesis
    const proposals = synthesizer.synthesizeProposals(observations);

    // Corroborate and merge proposals
    const corroborationResult = corroborator.corroborateAndMerge(
      proposals,
      GENERIC_REFILL_EVIDENCE_REQUIREMENTS,
    );

    // Non-persistent: Acquired candidates must flow through ExperienceProposalResolverService.resolve()
    // to preserve geographic validation, deduplication, trait resolution, and single-path persistence.
    return {
      experienceIds: [] as string[],
      experiences: [] as any[],
      candidates: corroborationResult.candidates,
      observations,
      provenance: {
        provider: 'google' as const,
        cacheStatus: 'miss-live' as const,
        requestedCount: input.maxResultCount ?? 20,
        receivedCount: observations.length,
      },
    };
  }

  async findVerifiedWithin(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit = 100,
  ) {
    // This method owns geography only. Do not pre-rank the catalog by quality
    // here: doing so can discard lower-rated but highly relevant Experiences
    // before semantic/preference ranking ever sees them. Scan a bounded,
    // deterministic pool, filter by radius, then keep the geographically
    // nearest rows with a stable id tie-break. Relevance is applied later.
    const scanLimit = Math.max(limit * 4, 1000);
    const experiences = await this.prisma.experience.findMany({
      where: { status: ExperienceStatus.VERIFIED },
      include: {
        components: { include: { geoEntity: true } },
        traits: { include: { traitDefinition: true } },
      },
      take: scanLimit,
      orderBy: { id: 'asc' },
    });
    const radiusSquared = radiusMeters * radiusMeters;
    return experiences
      .map((experience) => {
        const projected = this.projectVerifiedExperienceRow(experience, {
          latitude,
          longitude,
        });
        if (
          !Number.isFinite(projected.latitude) ||
          !Number.isFinite(projected.longitude)
        ) {
          return undefined;
        }
        const distanceSquared =
          ((projected.latitude! - latitude) * 111_000) ** 2 +
          ((projected.longitude! - longitude) *
            111_000 *
            Math.cos((latitude * Math.PI) / 180)) **
            2;
        if (distanceSquared > radiusSquared) return undefined;
        return { ...projected, distanceSquared };
      })
      .filter(
        (experience): experience is NonNullable<typeof experience> =>
          !!experience,
      )
      .sort(
        (left, right) =>
          left.distanceSquared - right.distanceSquared ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map(({ distanceSquared, ...experience }) => {
        void distanceSquared;
        return experience;
      });
  }

  /**
   * Canonical geospatial catalog boundary for preference-first per-facet
   * retrieval (Task A6.1 — `docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md`).
   *
   * Unlike `findVerifiedWithin` (a bounded JS/Prisma scan-then-filter that a
   * pre-semantic result cap can silently truncate before facet matching ever
   * runs), this method resolves geographic scope entirely in PostgreSQL via
   * PostGIS: it joins `experience` → `experience_component` → `geo_entity`,
   * keeps only VERIFIED Experiences with at least one resolved component
   * whose GeoEntity coordinates are finite and within real-world range
   * (matching the A5 validity contract — `BETWEEN -90 AND 90` /
   * `BETWEEN -180 AND 180` also structurally excludes NaN/Infinity, which
   * never satisfy a Postgres `BETWEEN`), and whose nearest component lies
   * within `radiusMeters` (`ST_DWithin`, using `geography` so the radius is
   * real meters, not degrees). Distance for ordering is the *minimum*
   * component distance to the query center (`MIN(...) ... GROUP BY e.id`),
   * so a multi-component Experience is in scope if *any* component is in
   * radius. There is no `LIMIT`/`take` of any kind on the in-scope result
   * set — the only bound left is an internal hydration batch size, which
   * does not drop or reorder any in-scope row.
   *
   * A bare Experience with no resolved component is never returned here —
   * the inner joins require a real `ExperienceComponent` row, so top-level
   * `Experience.latitude`/`longitude` never substitutes as a membership
   * predicate for this boundary (per the addendum's §3).
   *
   * Coordinates/radius are always passed as tagged-template parameters
   * (never string-concatenated) so Prisma binds them safely.
   */
  async findVerifiedWithinForMatching(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ) {
    const scoped = await this.prisma.$queryRaw<
      Array<{ id: string; distance_meters: number }>
    >`
      SELECT
        e.id AS id,
        MIN(
          ST_Distance(
            ST_SetSRID(ST_MakePoint(g.longitude, g.latitude), 4326)::geography,
            ST_SetSRID(ST_MakePoint(${longitude}::float8, ${latitude}::float8), 4326)::geography
          )
        ) AS distance_meters
      FROM "experience" e
      JOIN "experience_component" ec ON ec."experienceId" = e.id
      JOIN "geo_entity" g ON g.id = ec."geoEntityId"
      WHERE e.status = 'VERIFIED'
        AND g.latitude IS NOT NULL
        AND g.longitude IS NOT NULL
        AND g.latitude BETWEEN -90 AND 90
        AND g.longitude BETWEEN -180 AND 180
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(g.longitude, g.latitude), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${longitude}::float8, ${latitude}::float8), 4326)::geography,
          ${radiusMeters}::float8
        )
      GROUP BY e.id
      ORDER BY distance_meters ASC, e.id ASC
    `;

    if (scoped.length === 0) {
      return [];
    }

    const orderedIds = scoped.map((row) => row.id);

    // Hydrate in bounded internal batches (a performance/parameter-count
    // concern only) while preserving every in-scope id and PostGIS's own
    // distance-then-id order across the whole result set — this is not a
    // correctness-visible truncation, unlike the old `take:N` boundary.
    const hydratedById = new Map<
      string,
      ReturnType<ExperienceCatalogService['projectVerifiedExperienceRow']>
    >();
    for (
      let start = 0;
      start < orderedIds.length;
      start += HYDRATION_BATCH_SIZE
    ) {
      const batch = await this.findVerifiedByIds(
        orderedIds.slice(start, start + HYDRATION_BATCH_SIZE),
      );
      for (const row of batch) {
        hydratedById.set(row.id, row);
      }
    }

    return orderedIds
      .map((id) => hydratedById.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row);
  }

  /**
   * Retrieves verified Experiences by their exact ids, in the order given.
   * Unlike `findVerifiedWithin` this performs no geographic scan/filter — it
   * returns exactly the requested rows (subject only to a genuinely missing or
   * non-VERIFIED row), so an acquisition boundary can report precisely the
   * Experiences a resolver just materialized rather than a broader nearby pool.
   */
  async findVerifiedByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.experience.findMany({
      where: { id: { in: ids }, status: ExperienceStatus.VERIFIED },
      include: {
        components: { include: { geoEntity: true } },
        traits: { include: { traitDefinition: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row)
      .map((experience) => this.projectVerifiedExperienceRow(experience));
  }

  /**
   * Typed persisted classification context for warm classification refresh.
   *
   * Loads a VERIFIED Experience and its persisted ExperienceEvidence rows,
   * mapping the persistence shape to the canonical ExperienceGroundingEvidence
   * contract used by ExperienceClassificationService.classify().
   *
   * The persisted ExperienceEvidence.id is the stable canonical evidence key
   * for future persisted-evidence classification runs. The original transient
   * ResolverEvidenceItem.key is not persisted; once evidence becomes durable,
   * ExperienceEvidence.id becomes the canonical stable evidence key.
   */
  async findClassificationContextById(experienceId: string): Promise<{
    experienceId: string;
    canonicalName: string;
    metadata: unknown;
    evidence: ExperienceGroundingEvidence[];
  } | null> {
    const experience = await this.prisma.experience.findUnique({
      where: { id: experienceId, status: ExperienceStatus.VERIFIED },
      include: { evidence: true },
    });
    if (!experience) return null;
    const evidence: ExperienceGroundingEvidence[] = experience.evidence
      .filter(
        (item) => typeof item.snippet === 'string' && item.snippet.length > 0,
      )
      .map((item) => ({
        key: item.id,
        source: item.source,
        snippet: item.snippet,
        ...(item.title ? { title: item.title } : {}),
        ...(item.url ? { url: item.url } : {}),
      }));
    return {
      experienceId: experience.id,
      canonicalName: experience.canonicalName,
      metadata: experience.metadata,
      evidence,
    };
  }

  /**
   * Warm lookup using the same canonical area membership policy as cold
   * geographic validation. Filtering is intentionally performed over the
   * hydrated canonical facts so SQL cannot grow a second interpretation.
   *
   * Membership is decided from the components' own canonical geography: an
   * Experience never needs an area-role component to be retrieved through a
   * regional AREA — a source-defined composition (§P2-18) whose verified
   * components lie in the user-named AREA is found exactly like one whose
   * source named that AREA. The scan is bounded, never global: the pool is
   * the existing PostGIS catalog boundary over the AREA's own bounding-box
   * covering window (a physical derivation of the real polygon, no radius
   * constant), plus any Experience that has the AREA itself as a component.
   * A line component is pooled through its canonical representative point.
   */
  async findVerifiedMultiComponentInArea(
    areaGeoEntityId: string,
    policy: AreaScopeMembershipPolicy,
  ) {
    const area = await this.prisma.geoEntity.findUnique({
      where: { id: areaGeoEntityId },
      select: { kind: true, geometry: true },
    });
    if (!area || area.kind !== GeoEntityKind.AREA || !area.geometry) return [];
    const window = boundingBoxToCenterRadius(area.geometry as GeoJsonGeometry);
    if (
      !Number.isFinite(window.latitude) ||
      !Number.isFinite(window.longitude) ||
      !Number.isFinite(window.radiusMeters)
    ) {
      return [];
    }
    const [windowed, withAreaComponent] = await Promise.all([
      this.findVerifiedWithinForMatching(
        window.latitude,
        window.longitude,
        Math.ceil(window.radiusMeters),
      ),
      this.prisma.experience.findMany({
        where: {
          status: ExperienceStatus.VERIFIED,
          components: { some: { geoEntityId: areaGeoEntityId } },
        },
        select: { id: true },
      }),
    ]);
    const ids = [
      ...new Set([
        ...windowed.map((row) => row.id),
        ...withAreaComponent.map((row) => row.id),
      ]),
    ];
    if (ids.length === 0) return [];
    const rows = await this.prisma.experience.findMany({
      where: { id: { in: ids }, status: ExperienceStatus.VERIFIED },
      include: {
        components: { include: { geoEntity: true } },
        traits: { include: { traitDefinition: true } },
      },
      orderBy: { id: 'asc' },
    });
    return rows
      .filter(
        (experience) =>
          experience.components.length > 1 &&
          evaluateAreaScopeMembership(
            area.geometry as GeoJsonGeometry,
            experience.components.map((component) => ({
              role: component.role,
              kind: component.geoEntity.kind,
              latitude: component.geoEntity.latitude,
              longitude: component.geoEntity.longitude,
              geometry: component.geoEntity.geometry,
            })),
            policy,
          ).passes,
      )
      .map((experience) => this.projectVerifiedExperienceRow(experience));
  }

  /**
   * Task B5 (mode B) — real reuse-first check for a resolved canonical
   * ROUTE anchor: an EXACT identity match (this specific `geoEntityId` is
   * a persisted component of the Experience), never polygon/line-
   * containment math — the ROUTE's own geometry is its identity here.
   */
  async findVerifiedMultiComponentByExactComponent(geoEntityId: string) {
    if (!geoEntityId) return [];
    const rows = await this.prisma.experience.findMany({
      where: {
        status: ExperienceStatus.VERIFIED,
        components: { some: { geoEntityId } },
      },
      select: { id: true, _count: { select: { components: true } } },
    });
    const ids = rows
      .filter((row) => row._count.components > 1)
      .map((row) => row.id);
    if (ids.length === 0) return [];
    return this.findVerifiedByIds(ids);
  }

  /**
   * Task B5 (mode C) — reuse-first for a named tourism-route Experience
   * with NO resolved canonical ROUTE geometry (e.g. "Ruta del Vino de
   * Mendoza"). Strict normalized-name IDENTITY only — reuses the EXISTING
   * canonical catalog geospatial boundary (`findVerifiedWithinForMatching`,
   * Task A6.1, no new geometry/SQL). This is intentionally NOT a general
   * tourism-route alias resolver: an anchor whose real name the extractor
   * happened to title differently (e.g. "Mendoza Wine Route") will
   * correctly MISS here — a documented v1 limitation, not a bug. Do not
   * add fuzzy/embedding/alias matching to close this gap.
   */
  async findVerifiedTourismRouteByName(
    normalizedAnchorName: string,
    destinationLatitude: number,
    destinationLongitude: number,
    destinationRadiusMeters: number,
  ) {
    if (!normalizedAnchorName) return [];
    const pool = await this.findVerifiedWithinForMatching(
      destinationLatitude,
      destinationLongitude,
      destinationRadiusMeters,
    );
    return pool.filter(
      (row) =>
        normalizeGeoName(row.canonicalName ?? '') === normalizedAnchorName &&
        row.components.length > 1,
    );
  }

  /**
   * Task B5 — applies a real, evidence-only Stage-6 classification
   * (`ExperienceClassificationService.classify()`, Task B2) to an already-
   * persisted Experience. The classifier's `themes`/`intents` are
   * AUTHORITATIVE over whatever stale discovery-era values may already be
   * in `metadata` — `mergeExperienceMetadata`'s generic union (correct for
   * reconciling two independent candidate proposals) would otherwise let a
   * legacy `metadata.intents: ['walk']` survive alongside a fresh
   * classifier verdict of `['food']`, silently making a wrongly-classified
   * row pass a facet check the current classification explicitly does not
   * support. `mergeExperienceMetadata` is still reused to preserve
   * unrelated/richer non-classifier-owned metadata fields.
   */
  async applyEvidenceClassification(
    experienceId: string,
    classification: ClassificationResult,
  ): Promise<void> {
    const existing = await this.prisma.experience.findUnique({
      where: { id: experienceId },
      select: { metadata: true, qualityScore: true },
    });
    if (!existing) return;

    const traitDefinitionIds = await this.resolveOrCreateTraitDefinitions(
      classification.traits,
    );

    const merged = mergeExperienceMetadata(
      { qualityScore: existing.qualityScore, metadata: existing.metadata },
      {
        qualityScore: existing.qualityScore,
        metadata: {
          themes: classification.themes,
          intents: classification.intents,
          traits: classification.traits,
          classification: {
            state: classification.state,
            promptVersion: classification.promptVersion,
            modelId: classification.modelId,
            themes: classification.themes,
            intents: classification.intents,
            traits: classification.traits,
            reasoningEvidence: classification.reasoningEvidence,
          },
        },
      },
    );

    // The current classifier's verdict is authoritative for its own
    // fields -- never a union with whatever a prior (possibly stale,
    // possibly discovery-era) value claimed.
    const metadata = {
      ...(merged.metadata as Record<string, unknown>),
      themes: classification.themes,
      intents: classification.intents,
    };

    if (traitDefinitionIds.length) {
      await this.prisma.experienceTrait.createMany({
        data: traitDefinitionIds.map((traitDefinitionId) => ({
          experienceId,
          traitDefinitionId,
        })),
        skipDuplicates: true,
      });
    }

    await this.prisma.experience.update({
      where: { id: experienceId },
      data: {
        qualityScore: merged.qualityScore,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Shared hydration for a verified Experience row into the shape the ranking
   * pipeline consumes. `center` is optional: when supplied, a `distance` (km)
   * is attached; callers that only need the row (`findVerifiedByIds`) omit it.
   */
  private projectVerifiedExperienceRow(
    experience: {
      id: string;
      canonicalName: string;
      description: string | null;
      price: number | null;
      qualityScore: number | null;
      latitude: number | null;
      longitude: number | null;
      durationMinutes: number | null;
      openingHours: unknown;
      metadata: unknown;
      components: Array<{
        geoEntity: {
          kind: GeoEntityKind;
          latitude: number | null;
          longitude: number | null;
        };
        [key: string]: any;
      }>;
      traits: Array<{
        traitDefinition: {
          dimension: string;
          key: string;
          label: string | null;
        };
      }>;
    },
    center?: { latitude: number; longitude: number },
  ) {
    const component = experience.components.find(
      (item) =>
        Number.isFinite(item.geoEntity.latitude) &&
        Number.isFinite(item.geoEntity.longitude),
    )?.geoEntity;
    const lat = experience.latitude ?? component?.latitude ?? null;
    const lon = experience.longitude ?? component?.longitude ?? null;
    const metadata = this.objectMetadata(experience.metadata);
    const relationalTraits = experience.traits.flatMap((trait) =>
      [trait.traitDefinition.label, trait.traitDefinition.key].filter(
        (value): value is string => !!value,
      ),
    );
    const metadataDimensioned = Array.isArray(metadata.dimensionedTraits)
      ? (metadata.dimensionedTraits as Array<{
          dimension: string;
          key: string;
          label?: string;
        }>)
      : [];
    const dimensionedTraits = [
      ...metadataDimensioned,
      ...experience.traits.map((trait) => ({
        dimension: trait.traitDefinition.dimension,
        key: trait.traitDefinition.key,
        label: trait.traitDefinition.label ?? undefined,
      })),
    ];
    const distanceKm =
      center && Number.isFinite(lat) && Number.isFinite(lon)
        ? Math.sqrt(
            ((lat! - center.latitude) * 111_000) ** 2 +
              ((lon! - center.longitude) *
                111_000 *
                Math.cos((center.latitude * Math.PI) / 180)) **
                2,
          ) / 1000
        : undefined;
    return {
      id: experience.id,
      name: experience.canonicalName,
      canonicalName: experience.canonicalName,
      description: experience.description,
      price: experience.price,
      qualityScore: experience.qualityScore,
      latitude: lat,
      longitude: lon,
      distance: distanceKm,
      duration: (experience.durationMinutes ?? 120) / 60,
      durationMinutes: experience.durationMinutes,
      openingHours: experience.openingHours,
      themes: this.stringList(metadata.themes),
      intents: this.stringList(metadata.intents ?? metadata.archetypes),
      traits: Array.from(
        new Set([...this.stringList(metadata.traits), ...relationalTraits]),
      ),
      dimensionedTraits,
      metadata: {
        ...metadata,
        dimensionedTraits,
        source: 'experience_catalog',
        experienceId: experience.id,
      },
      components: experience.components,
    };
  }

  /**
   * A single verified Experience with everything a detail screen needs:
   * resolved address (from its first geolocatable component's GeoEntity),
   * real persisted media (matches the `DocumentaryPhoto[]` shape 1:1, so the
   * frontend's existing `getPhotoGallery` needs no adaptation), and its raw
   * components for the multi-component ("composite") detail branch.
   */
  async findById(id: string) {
    const experience = await this.prisma.experience.findUnique({
      where: { id },
      include: {
        components: { include: { geoEntity: true } },
        traits: { include: { traitDefinition: true } },
        media: { orderBy: { position: 'asc' } },
      },
    });
    if (!experience || experience.status !== ExperienceStatus.VERIFIED) {
      return null;
    }
    const metadata = this.objectMetadata(experience.metadata);
    const relationalTraits = experience.traits.flatMap((trait) =>
      [trait.traitDefinition.label, trait.traitDefinition.key].filter(
        (value): value is string => !!value,
      ),
    );
    const metadataDimensioned = Array.isArray(metadata.dimensionedTraits)
      ? (metadata.dimensionedTraits as Array<{
          dimension: string;
          key: string;
          label?: string;
        }>)
      : [];
    const dimensionedTraits = [
      ...metadataDimensioned,
      ...experience.traits.map((trait) => ({
        dimension: trait.traitDefinition.dimension,
        key: trait.traitDefinition.key,
        label: trait.traitDefinition.label ?? undefined,
      })),
    ];
    const primaryGeoEntity = experience.components.find(
      (item) =>
        Number.isFinite(item.geoEntity.latitude) &&
        Number.isFinite(item.geoEntity.longitude),
    )?.geoEntity;
    return {
      id: experience.id,
      name: experience.canonicalName,
      canonicalName: experience.canonicalName,
      description: experience.description,
      price: experience.price,
      qualityScore: experience.qualityScore,
      latitude: experience.latitude ?? primaryGeoEntity?.latitude,
      longitude: experience.longitude ?? primaryGeoEntity?.longitude,
      address: primaryGeoEntity?.address,
      duration: (experience.durationMinutes ?? 120) / 60,
      durationMinutes: experience.durationMinutes,
      openingHours: experience.openingHours,
      themes: this.stringList(metadata.themes),
      intents: this.stringList(metadata.intents ?? metadata.archetypes),
      traits: Array.from(
        new Set([...this.stringList(metadata.traits), ...relationalTraits]),
      ),
      dimensionedTraits,
      metadata: {
        ...metadata,
        dimensionedTraits,
        source: 'experience_catalog',
        experienceId: experience.id,
      },
      type: this.stringList(metadata.themes)[0],
      photos: experience.media,
      mediaUpdatedAt: experience.mediaUpdatedAt,
      components: experience.components,
    };
  }

  /**
   * Resolves freeform trait strings (as emitted by discovery/extraction —
   * `ExperienceCandidate.traits: string[]`, no taxonomy) against
   * `TraitDefinition` via find-or-create, returning ids ready for
   * `persistVerifiedExperience`'s `traitDefinitionIds`. Without this, that
   * field is always empty in practice — no real caller ever populated it.
   *
   * There is no real `dimension` taxonomy for freeform trait strings today,
   * so everything buckets under `'general'`, normalizing the string into
   * `key` and keeping the original as `label`. Revisit if/when a closed
   * taxonomy is defined for the discovery prompt to emit instead.
   */
  async resolveOrCreateTraitDefinitions(traits: string[]): Promise<string[]> {
    // Deduplicate by the *persistence identity* (`dimension='general'`,
    // `key=lowercased trimmed string`), not by the raw string — otherwise
    // "Historia" / " historia " / "HISTORIA" each survive the Set and then
    // upsert the same `(general, historia)` row three times, returning a
    // non-unique id list. The label keeps the first non-empty trimmed value
    // for a stable, deterministic result.
    const byIdentity = new Map<
      string,
      { dimension: string; key: string; label: string }
    >();
    for (const raw of traits ?? []) {
      const label = typeof raw === 'string' ? raw.trim() : '';
      if (!label) continue;
      const dimension = 'general';
      const key = label.toLowerCase();
      const compound = `${dimension}:${key}`;
      if (!byIdentity.has(compound)) {
        byIdentity.set(compound, { dimension, key, label });
      }
    }
    if (byIdentity.size === 0) return [];

    const ids: string[] = [];
    for (const { dimension, key, label } of byIdentity.values()) {
      ids.push(await this.resolveOneTraitDefinition(dimension, key, label));
    }
    // One upsert per unique `(dimension, key)` -> ids are already unique;
    // this only makes the invariant explicit.
    return Array.from(new Set(ids));
  }

  /**
   * Find-or-create one `TraitDefinition`, concurrency-safe. Two accepted
   * candidates resolved in parallel by `ExperienceProposalResolverService`
   * (`Promise.all`) can both see "row absent" and race to create the same
   * `(dimension, key)` — verified in production as a Prisma `P2002` /
   * PostgreSQL `23505` on `@@unique([dimension, key])` that crashed
   * generation. Recover the winning row the same way `upsertGeoEntity` does
   * for its own identity race; every other error rethrows, and a recovered
   * race is `debug`-only noise, never a visible generation failure.
   */
  private async resolveOneTraitDefinition(
    dimension: string,
    key: string,
    label: string,
  ): Promise<string> {
    try {
      const definition = await this.prisma.traitDefinition.upsert({
        where: { dimension_key: { dimension, key } },
        update: {},
        create: { dimension, key, label },
      });
      return definition.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.traitDefinition.findUnique({
          where: { dimension_key: { dimension, key } },
          select: { id: true },
        });
        if (!winner) {
          // A P2002 with no readable winner is a real inconsistency, not a
          // recoverable race — do not silence it.
          throw error;
        }
        this.logger.debug(
          `TraitDefinition ${dimension}:${key} lost a concurrent create race; recovered the winning row ${winner.id}`,
        );
        return winner.id;
      }
      throw error;
    }
  }

  async upsertGeoEntity(input: GeoEntityInput) {
    const identity = await this.prisma.geoEntityIdentity.findUnique({
      where: {
        provider_externalId: {
          provider: input.provider,
          externalId: input.externalId,
        },
      },
      select: { geoEntityId: true },
    });

    const data = {
      name: input.name,
      kind: input.kind,
      latitude: input.latitude,
      longitude: input.longitude,
      geometry: input.geometry as Prisma.InputJsonValue | undefined,
      address: input.address,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    };

    if (identity) {
      return this.prisma.geoEntity.update({
        where: { id: identity.geoEntityId },
        data,
      });
    }

    // No exact (provider, externalId) match — before minting a brand-new
    // GeoEntity, check whether the *same real place* already exists under a
    // different provider's identity (verified live: a Nominatim-resolved
    // composite component and a later Google-Places-resolved standalone POI
    // both named "Plaza Dorrego" ended up ~3m apart as two unrelated
    // GeoEntity rows, so the tour offered the same real plaza twice). This
    // whole "identity doesn't exist yet" section runs under one advisory
    // lock per kind so two concurrent resolutions (Promise.all in
    // ExperienceProposalResolverService) can't both race past this check —
    // matching the pattern persistVerifiedExperience already uses for its
    // own identity locks.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'geo-entity-reconcile:' + input.kind}))`;

      // Re-check now that we hold the lock: a concurrent call may have just
      // created this exact identity while we were waiting.
      const identityAfterLock = await tx.geoEntityIdentity.findUnique({
        where: {
          provider_externalId: {
            provider: input.provider,
            externalId: input.externalId,
          },
        },
        select: { geoEntityId: true },
      });
      if (identityAfterLock) {
        return tx.geoEntity.update({
          where: { id: identityAfterLock.geoEntityId },
          data,
        });
      }

      const nearbyMatch = await this.findNearbyMatchingGeoEntity(tx, input);
      if (nearbyMatch) {
        this.logger.log(
          `Reconciled "${input.name}" (${input.provider}:${input.externalId}) onto existing GeoEntity ${nearbyMatch.id} instead of creating a duplicate for the same real place`,
        );
        await tx.geoEntityIdentity.create({
          data: {
            geoEntityId: nearbyMatch.id,
            provider: input.provider,
            externalId: input.externalId,
          },
        });
        return tx.geoEntity.update({
          where: { id: nearbyMatch.id },
          data,
        });
      }

      try {
        return await tx.geoEntity.create({
          data: {
            ...data,
            identities: {
              create: {
                provider: input.provider,
                externalId: input.externalId,
              },
            },
          },
        });
      } catch (error) {
        // Defense in depth: the advisory lock above should make this
        // unreachable in normal operation, but a P2002 here still means
        // "someone else just created this identity" rather than a real
        // failure — recover the same way the pre-lock code path used to,
        // instead of crashing generation on it.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const winner = await tx.geoEntityIdentity.findUniqueOrThrow({
            where: {
              provider_externalId: {
                provider: input.provider,
                externalId: input.externalId,
              },
            },
            select: { geoEntityId: true },
          });
          return tx.geoEntity.update({
            where: { id: winner.geoEntityId },
            data,
          });
        }
        throw error;
      }
    });
  }

  /**
   * Strong-identity candidate correlation: the distinct GeoEntities that
   * already own ANY of these provider-native identities (sorted). An exact
   * `(provider, externalId)` lookup over the unique index -- never a name
   * or proximity match.
   */
  async findGeoEntityIdsByIdentities(
    provider: string,
    externalIds: string[],
  ): Promise<string[]> {
    if (externalIds.length === 0) return [];
    const rows = await this.prisma.geoEntityIdentity.findMany({
      where: { provider, externalId: { in: externalIds } },
      select: { geoEntityId: true },
    });
    return [...new Set(rows.map((row) => row.geoEntityId))].sort();
  }

  /**
   * Persist one real-world entity with MANY provider-native identities --
   * the single multi-identity persistence authority for every kind: a
   * multi-way ROUTE (one identity per OSM way) and a PLACE whose provider
   * declared cross-identities (Geoapify handle + OSM object + Wikidata
   * QID). Identity-only reconciliation:
   *  - no known identity -> create one GeoEntity with every identity;
   *  - all known identities point at ONE GeoEntity -> reuse it and attach
   *    the missing identities (name/representative point are kept stable);
   *  - known identities point at 2+ GeoEntities -> IDENTITY_CONFLICT, no
   *    write at all.
   * Runs under the same per-kind advisory lock as `upsertGeoEntity`, so it
   * serializes with every other GeoEntity write of the same kind.
   */
  async upsertGeoEntityWithIdentities(
    input: GeoEntityWithIdentitiesInput,
  ): Promise<GeoEntityWithIdentitiesResult> {
    const identities = [
      ...new Map(
        input.identities.map((identity) => [
          `${identity.provider}\u0000${identity.externalId}`,
          identity,
        ]),
      ).values(),
    ];
    if (identities.length === 0) {
      throw new Error('upsertGeoEntityWithIdentities requires an identity');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'geo-entity-reconcile:' + input.kind}))`;

      const known = await tx.geoEntityIdentity.findMany({
        where: {
          OR: identities.map(({ provider, externalId }) => ({
            provider,
            externalId,
          })),
        },
        select: { geoEntityId: true, provider: true, externalId: true },
      });
      const owners = [...new Set(known.map((row) => row.geoEntityId))].sort();
      if (owners.length > 1) {
        return {
          status: 'IDENTITY_CONFLICT' as const,
          conflictingGeoEntityIds: owners,
        };
      }

      const knownKeys = new Set(
        known.map((row) => `${row.provider}\u0000${row.externalId}`),
      );
      const missing = identities.filter(
        (identity) =>
          !knownKeys.has(`${identity.provider}\u0000${identity.externalId}`),
      );
      const attachedExternalIds = missing
        .map((identity) => identity.externalId)
        .sort();

      if (owners.length === 0) {
        const created = await tx.geoEntity.create({
          data: {
            name: input.name,
            kind: input.kind,
            latitude: input.latitude,
            longitude: input.longitude,
            geometry: input.geometry as Prisma.InputJsonValue | undefined,
            address: input.address,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
            identities: {
              create: identities.map(({ provider, externalId }) => ({
                provider,
                externalId,
              })),
            },
          },
          select: { id: true },
        });
        return {
          status: 'CREATED' as const,
          geoEntity: created,
          attachedExternalIds,
        };
      }

      const [geoEntityId] = owners;
      if (missing.length > 0) {
        await tx.geoEntityIdentity.createMany({
          data: missing.map(({ provider, externalId }) => ({
            geoEntityId,
            provider,
            externalId,
          })),
        });
        const existing = await tx.geoEntity.findUniqueOrThrow({
          where: { id: geoEntityId },
          select: { geometry: true },
        });
        const merged = unionLineGeometry(existing.geometry, input.geometry);
        if (merged) {
          await tx.geoEntity.update({
            where: { id: geoEntityId },
            data: { geometry: merged as unknown as Prisma.InputJsonValue },
          });
        }
      }
      return {
        status: 'REUSED' as const,
        geoEntity: { id: geoEntityId },
        attachedExternalIds,
      };
    });
  }

  /**
   * Finds an existing GeoEntity of the same kind, within
   * GEO_ENTITY_RECONCILIATION_RADIUS_METERS, whose name matches — the
   * cross-provider reconciliation `upsertGeoEntity` needs so the same real
   * place never ends up as two unrelated GeoEntity rows. A plain bounding-box
   * prefilter (reusing the existing `[latitude, longitude]` index) narrows
   * the candidate set before the precise Haversine + name check.
   */
  private async findNearbyMatchingGeoEntity(
    tx: Prisma.TransactionClient,
    input: GeoEntityInput,
  ) {
    if (input.latitude == null || input.longitude == null) return undefined;

    const radiusMeters = GEO_ENTITY_RECONCILIATION_RADIUS_METERS;
    const { latDeltaDegrees, lonDeltaDegrees } =
      ExperienceCatalogService.boundingBoxDegreeDeltas(
        input.latitude,
        radiusMeters,
      );

    const candidates = await tx.geoEntity.findMany({
      where: {
        kind: input.kind,
        latitude: {
          gte: input.latitude - latDeltaDegrees,
          lte: input.latitude + latDeltaDegrees,
        },
        longitude: {
          gte: input.longitude - lonDeltaDegrees,
          lte: input.longitude + lonDeltaDegrees,
        },
      },
    });

    let best: { id: string; distanceKm: number } | undefined;
    for (const candidate of candidates) {
      if (candidate.latitude == null || candidate.longitude == null) continue;
      if (!realWorldNamesMatch(input.name, candidate.name)) continue;

      const distMeters = distanceMeters(
        { latitude: input.latitude, longitude: input.longitude },
        { latitude: candidate.latitude, longitude: candidate.longitude },
      );
      if (distMeters > radiusMeters) continue;
      const distanceKm = distMeters / 1000;
      if (!best || distanceKm < best.distanceKm) {
        best = { id: candidate.id, distanceKm };
      }
    }

    return best ? { id: best.id } : undefined;
  }

  /**
   * Degree-scale lat/lon deltas covering `radiusMeters` around `latitude`,
   * reusing the existing `[latitude, longitude]` index for a bounding-box
   * prefilter — the same formula `findNearbyMatchingGeoEntity` already used
   * inline, extracted so `findGeoEntityCandidatesForHint` (Stage 3) shares
   * it instead of re-deriving a second geographic-bounding formula.
   */
  private static boundingBoxDegreeDeltas(
    latitude: number,
    radiusMeters: number,
  ): { latDeltaDegrees: number; lonDeltaDegrees: number } {
    return {
      latDeltaDegrees: radiusMeters / 111_320,
      lonDeltaDegrees:
        radiusMeters /
        (111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01)),
    };
  }

  /**
   * Stage 3 catalog-first identity resolution — bounded, provider-neutral
   * read of already-canonical GeoEntity knowledge for one component hint.
   * Ownership: this method returns candidates/facts only; it never chooses
   * a winner or declares identity truth (that decision belongs to
   * IdentityVerifier at the resolver seam — see
   * ExperienceProposalResolverService.resolveViaCatalog).
   *
   * Bounded by construction:
   *  - kind filter at the SQL/Prisma `where` (reuses the `[kind]` index);
   *  - a lat/lon bounding box derived from the scope-derived search
   *    `window` (reuses the
   *    `[latitude, longitude]` index) — never an unbounded table scan;
   *  - a GeoEntity with no usable coordinates is fail-closed excluded
   *    (Prisma's `gte`/`lte` range filters never match a NULL column).
   *
   * Matching policy (deliberately conservative): a row of the bounded,
   * same-kind pool is a candidate when EITHER
   *  - its canonical `name` equals the hint under strict normalized-name
   *    equality (`normalizeGeoName`, the same definition the resolver uses
   *    for its local OSM pool), OR
   *  - its verified hint memory (`verifiedHintNameKeys`) contains the
   *    hint's `normalizeGeoName` key -- i.e. this exact hint text already
   *    resolved VERIFIED to that row once (see `rememberVerifiedHintName`).
   *    Verified hint memory is not alias inference: a key only exists
   *    after a verified resolution, never because two strings look alike.
   *    The lookup is a separate `@>` query so the GIN index on
   *    `verifiedHintNameKeys` serves it, still bounded by kind + bbox.
   * No fuzzy score, no substring matching, no geographic-nearest-wins, no
   * provider voting. Matches from both paths are unioned by GeoEntity id
   * (multiplicity preserved): 0 candidates is a catalog miss; 1 is handed
   * to IdentityVerifier by the caller; 2+ is ambiguous catalog knowledge --
   * the caller must not arbitrarily pick a winner.
   */
  async findGeoEntityCandidatesForHint(
    request: FindGeoEntityCandidatesForHintRequest,
  ): Promise<FindGeoEntityCandidatesForHintResult> {
    const needle = normalizeGeoName(request.hintName);
    if (!needle) return { candidates: [] };
    const {
      center: { latitude, longitude },
      radiusMeters,
    } = request.window;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(radiusMeters)
    ) {
      return { candidates: [] };
    }
    const { latDeltaDegrees, lonDeltaDegrees } =
      ExperienceCatalogService.boundingBoxDegreeDeltas(latitude, radiusMeters);
    const bounds = {
      minLatitude: latitude - latDeltaDegrees,
      maxLatitude: latitude + latDeltaDegrees,
      minLongitude: longitude - lonDeltaDegrees,
      maxLongitude: longitude + lonDeltaDegrees,
    };
    const identities = {
      select: { provider: true, externalId: true },
      orderBy: { createdAt: 'asc' as const },
    };

    const rows = await this.prisma.geoEntity.findMany({
      where: {
        kind: request.expectedKind,
        latitude: { gte: bounds.minLatitude, lte: bounds.maxLatitude },
        longitude: { gte: bounds.minLongitude, lte: bounds.maxLongitude },
      },
      include: { identities },
    });
    const canonical = rows.filter(
      (row) => normalizeGeoName(row.name) === needle,
    );

    const verifiedHintIds = (
      await this.findGeoEntityIdsByVerifiedHintKey(
        needle,
        request.expectedKind,
        bounds,
      )
    ).filter((id) => !canonical.some((row) => row.id === id));
    const verifiedHint =
      verifiedHintIds.length === 0
        ? []
        : await this.prisma.geoEntity.findMany({
            where: { id: { in: verifiedHintIds } },
            include: { identities },
            orderBy: { id: 'asc' },
          });

    const toCandidate = (
      row: (typeof rows)[number],
      matchKind: CatalogGeoEntityCandidate['matchKind'],
    ): CatalogGeoEntityCandidate => ({
      geoEntityId: row.id,
      name: row.name,
      kind: row.kind,
      latitude: row.latitude,
      longitude: row.longitude,
      geometry: row.geometry,
      address: row.address,
      identities: row.identities,
      matchKind,
    });
    return {
      candidates: [
        ...canonical.map((row) => toCandidate(row, 'CANONICAL_NAME')),
        ...verifiedHint.map((row) => toCandidate(row, 'VERIFIED_HINT')),
      ],
    };
  }

  /**
   * The verified-hint half of `findGeoEntityCandidatesForHint`: ids of the
   * same-kind GeoEntities inside the bounding box whose verified hint
   * memory contains `key`. `"verifiedHintNameKeys" @> ARRAY[key]` (not
   * `key = ANY(...)`, which GIN cannot serve) so the
   * `geo_entity_verifiedHintNameKeys_idx` GIN index drives the lookup;
   * kind + bbox stay in the same WHERE, so it never widens the bounded
   * catalog read. Sorted for deterministic multiplicity handling.
   */
  private async findGeoEntityIdsByVerifiedHintKey(
    key: string,
    kind: GeoEntityKind,
    bounds: {
      minLatitude: number;
      maxLatitude: number;
      minLongitude: number;
      maxLongitude: number;
    },
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "geo_entity"
      WHERE "verifiedHintNameKeys" @> ARRAY[${key}]::text[]
        AND "kind" = ${kind}::"GeoEntityKind"
        AND "latitude" BETWEEN ${bounds.minLatitude} AND ${bounds.maxLatitude}
        AND "longitude" BETWEEN ${bounds.minLongitude} AND ${bounds.maxLongitude}
      ORDER BY "id"`;
    return rows.map((row) => row.id);
  }

  /**
   * Verified hint memory write: remembers that `hintName` (verbatim) just
   * resolved VERIFIED to GeoEntity `geoEntityId`. Callers invoke it ONLY
   * after IdentityVerifier accepted an external resolution and the
   * canonical GeoEntity exists -- never during acquisition, never for a
   * rejected/ambiguous/unconfirmed/failed hint, never from string
   * similarity. This is recorded resolution history, not an alias engine.
   *
   * One atomic, idempotent UPDATE appends the verbatim text and its
   * `normalizeGeoName` key together (the two arrays stay positionally
   * aligned; a DB CHECK enforces equal cardinality) only when the key is
   * not already present. Under concurrent writers of the same key the
   * row lock serializes the UPDATEs and PostgreSQL re-evaluates the
   * `NOT @>` predicate against the committed row (READ COMMITTED
   * EvalPlanQual), so the loser matches 0 rows: no lost update, no
   * duplicate key. No read-modify-write in application code.
   */
  async rememberVerifiedHintName(
    geoEntityId: string,
    hintName: string,
  ): Promise<RememberVerifiedHintNameResult> {
    const key = normalizeGeoName(hintName);
    if (!key) return 'EMPTY_KEY';
    const updated = await this.prisma.$executeRaw`
      UPDATE "geo_entity"
      SET "verifiedHintNames" = array_append("verifiedHintNames", ${hintName}),
          "verifiedHintNameKeys" = array_append("verifiedHintNameKeys", ${key}),
          "updatedAt" = NOW()
      WHERE "id" = ${geoEntityId}
        AND NOT ("verifiedHintNameKeys" @> ARRAY[${key}]::text[])`;
    return updated > 0 ? 'REMEMBERED' : 'ALREADY_REMEMBERED';
  }

  private normalizeGeoEntityName(value: string): string {
    return normalizeRealWorldName(value);
  }

  async persistVerifiedExperience(input: VerifiedExperienceInput) {
    if (input.components.length === 0) {
      throw new Error('A verified Experience requires at least one component');
    }

    // `ExperienceTrait` has a composite PK `@@id([experienceId, traitDefinitionId])`.
    // The NEW-experience path below writes traits via a nested `create` with
    // no `skipDuplicates`, so a repeated id in the input would hit the PK.
    // Deduplicate once here and use this collection on every path (defense in
    // depth — never rely on `skipDuplicates` alone).
    const traitDefinitionIds = Array.from(
      new Set(input.traitDefinitionIds ?? []),
    );

    return this.prisma.$transaction(async (tx) => {
      const normalizedName = input.canonicalName.trim().toLocaleLowerCase();
      const componentIds = [
        ...new Set(input.components.map((component) => component.geoEntityId)),
      ].sort();

      // Serialize all identity domains that can make two writes compete. Keys
      // are sorted to keep acquisition workers from deadlocking each other.
      const identityLocks = [
        `experience:name:${normalizedName}`,
        ...componentIds.map((id) => `experience:component:${id}`),
      ].sort();
      for (const identityLock of identityLocks) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityLock}))`;
      }

      const existing = await tx.experience.findMany({
        where: {
          status: ExperienceStatus.VERIFIED,
          OR: [
            {
              canonicalName: {
                equals: input.canonicalName,
                mode: 'insensitive',
              },
            },
            { components: { some: { geoEntityId: { in: componentIds } } } },
          ],
        },
        include: {
          components: true,
          evidence: true,
          traits: { include: { traitDefinition: true } },
        },
        take: 50,
      });

      const incomingFingerprint: DedupeExperienceFingerprint = {
        canonicalName: input.canonicalName,
        semanticTerms: this.semanticTerms(
          input.description,
          input.metadata,
          [],
        ),
        conceptTerms: this.conceptTerms(input.metadata),
        latitude: input.latitude,
        longitude: input.longitude,
        components: input.components,
        provenance: (input.evidence ?? []).map((item) => item.source),
      };
      const decision = decideExperienceDedupe(
        incomingFingerprint,
        existing.map((candidate) => ({
          id: candidate.id,
          canonicalName: candidate.canonicalName,
          semanticTerms: this.semanticTerms(
            candidate.description,
            candidate.metadata,
            candidate.traits.flatMap(({ traitDefinition }) => [
              traitDefinition.label,
              traitDefinition.key,
              `${traitDefinition.dimension}:${traitDefinition.key}`,
            ]),
          ),
          conceptTerms: this.conceptTerms(candidate.metadata),
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          components: candidate.components,
          provenance: candidate.evidence.map((item) => item.source),
        })),
      );

      if (decision.decision === 'AMBIGUOUS') {
        return {
          id: decision.candidates[0],
          dedupeDecision: 'AMBIGUOUS' as const,
          dedupeEvidence: decision.evidence,
          dedupeCandidates: decision.candidates,
        };
      }

      if (decision.decision === 'SAME') {
        const same = existing.find(
          (candidate) => candidate.id === decision.canonicalExperienceId,
        );
        if (!same) {
          throw new Error(
            'Dedupe SAME referenced an Experience outside the candidate set',
          );
        }

        const knownEvidence = new Set(
          same.evidence.map(
            (item) => `${item.source}|${item.url ?? ''}|${item.title ?? ''}`,
          ),
        );
        const missingEvidence = (input.evidence ?? []).filter(
          (item) =>
            !knownEvidence.has(
              `${item.source}|${item.url ?? ''}|${item.title ?? ''}`,
            ),
        );
        if (missingEvidence.length) {
          await tx.experienceEvidence.createMany({
            data: missingEvidence.map((item) => ({
              ...item,
              experienceId: same.id,
            })),
          });
        }

        if (traitDefinitionIds.length) {
          await tx.experienceTrait.createMany({
            data: traitDefinitionIds.map((traitDefinitionId) => ({
              experienceId: same.id,
              traitDefinitionId,
            })),
            skipDuplicates: true,
          });
        }

        // Order-independent merge (plan Task B4, spec §8): canonical
        // per-field policies (union semantic arrays, strongest valid
        // quality, version-aware classification replacement), not a
        // generic object spread / arbitrary provider-order last-write-wins.
        const merged = mergeExperienceMetadata(
          { qualityScore: same.qualityScore, metadata: same.metadata },
          { qualityScore: input.qualityScore, metadata: input.metadata },
        );

        const updated = await tx.experience.update({
          where: { id: same.id },
          data: {
            description: this.preferRicherText(
              same.description,
              input.description,
            ),
            durationMinutes: input.durationMinutes ?? same.durationMinutes,
            price: input.price ?? same.price,
            qualityScore: merged.qualityScore,
            latitude: input.latitude ?? same.latitude,
            longitude: input.longitude ?? same.longitude,
            openingHours: input.openingHours as unknown as
              | Prisma.InputJsonValue
              | undefined,
            // Always write the canonical merge result explicitly, even
            // when it is `{}` -- in a Prisma update, `undefined` means
            // "leave this column untouched", which would silently keep
            // stale/malformed metadata (e.g. a superseded classification)
            // in the database even though mergeExperienceMetadata itself
            // correctly decided it should not survive.
            metadata: merged.metadata as Prisma.InputJsonValue,
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            embeddingDocumentVersion: null,
            embeddedAt: null,
          },
          include: { components: true, evidence: true, traits: true },
        });
        await tx.$executeRaw`UPDATE "experience" SET "embedding" = NULL WHERE "id" = ${same.id}`;

        return {
          ...updated,
          dedupeDecision: 'SAME' as const,
          dedupeEvidence: decision.evidence,
          semanticDocumentChanged: true,
        };
      }

      const experience = await tx.experience.create({
        data: {
          canonicalName: input.canonicalName,
          description: input.description,
          durationMinutes: input.durationMinutes,
          price: input.price,
          qualityScore: input.qualityScore,
          latitude: input.latitude,
          longitude: input.longitude,
          openingHours: input.openingHours as unknown as
            | Prisma.InputJsonValue
            | undefined,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          status: ExperienceStatus.VERIFIED,
          components: {
            create: input.components.map((component) => ({
              geoEntityId: component.geoEntityId,
              order: component.order,
              role: component.role,
              // `ExperienceComponent.required` is left to its schema
              // default (true): a persisted Experience is always its FULL
              // admitted source composition, so every row is a member.
              // The column carries no geographic/planner authority.
            })),
          },
          evidence: input.evidence?.length
            ? { create: input.evidence }
            : undefined,
          traits: traitDefinitionIds.length
            ? {
                create: traitDefinitionIds.map((traitDefinitionId) => ({
                  traitDefinitionId,
                })),
              }
            : undefined,
        },
        include: { components: true, evidence: true, traits: true },
      });

      return {
        ...experience,
        dedupeDecision: 'NEW' as const,
        dedupeEvidence: decision.evidence,
        semanticDocumentChanged: true,
      };
    });
  }

  private semanticTerms(
    description: string | null | undefined,
    metadataValue: unknown,
    relationalTraits: Array<string | null | undefined>,
  ): string[] {
    const metadata = this.objectMetadata(metadataValue);
    return [
      description,
      ...this.stringList(metadata.themes),
      ...this.stringList(metadata.traits),
      ...this.stringList(metadata.intents ?? metadata.archetypes),
      ...relationalTraits,
    ].filter(
      (value): value is string => typeof value === 'string' && !!value.trim(),
    );
  }

  /**
   * The curated tourism concept (`metadata.themes` + `metadata.intents`)
   * ONLY -- deliberately excludes free-text `description`/`canonicalName`,
   * which naturally share generic location/format words across
   * genuinely different real Experiences over the same real stops. Feeds
   * `DedupeExperienceFingerprint.conceptTerms`, the identity-dedupe gate's
   * dedicated compatible-concept-evidence signal (never a substitute for
   * `semanticTerms`, which still legitimately blends in description/
   * traits for the broader `strongConsistentIdentity` path).
   */
  private conceptTerms(metadataValue: unknown): string[] {
    const metadata = this.objectMetadata(metadataValue);
    return [
      ...this.stringList(metadata.themes),
      ...this.stringList(metadata.intents ?? metadata.archetypes),
    ];
  }

  private preferRicherText(
    current?: string | null,
    incoming?: string,
  ): string | null | undefined {
    if (!incoming?.trim()) return current;
    if (!current?.trim()) return incoming;
    return incoming.trim().length > current.trim().length ? incoming : current;
  }

  private objectMetadata(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}

/**
 * The real hydrated shape `findVerifiedWithinForMatching`/`findVerifiedByIds`
 * return -- exported so callers (e.g. `ExperienceGenerationService`'s
 * global-eligibility count) can type their own loop variables against the
 * actual catalog contract instead of `Array<Record<string, any>>`.
 */
export type VerifiedExperienceRow = ReturnType<
  ExperienceCatalogService['projectVerifiedExperienceRow']
>;
