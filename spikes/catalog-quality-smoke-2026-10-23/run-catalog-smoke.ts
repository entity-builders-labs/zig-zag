/*
 * Reproducible Buenos Aires structured catalog smoke (OpenSpec task 39.7).
 *
 * Drives the production structured path only:
 *   acquisition planner -> router -> STRUCTURED_POI executor (OSM + enabled
 *   structured entity facts) -> identity reconciliation -> visit-unit policy
 *   -> structured admission -> GeoEntity knowledge persistence ->
 *   single-place Experience composition -> production request-specific
 *   candidate ordering (PreferenceUtilityService).
 *
 * Spike-only tool. It never calls LLM, web search or web fetch providers.
 * It refuses to run unless the database is exactly `zigzag_39_test`, the
 * server confirms it and the repository disposable guard accepts it.
 *
 * Usage (from be/):
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_39_test \
 *   OVERPASS_API_URL=http://localhost:12345/api/interpreter \
 *   SMOKE_OUT=/abs/out/dir SMOKE_LABEL=after \
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     ../spikes/catalog-quality-smoke-2026-10-23/run-catalog-smoke.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { closeDb, getPrisma, resetDb } from '../../be/test/integration/support/test-db';
import { assertDisposableDatabase } from '../../be/test/support/assert-disposable-database';
import { OverpassApiService } from '../../be/src/modules/integrations/osm/services/overpass-api.service';
import { OsmPlacesService } from '../../be/src/modules/integrations/osm/services/osm-places.service';
import { StructuredPoiAcquisitionProvider } from '../../be/src/modules/tours/providers/structured-poi-acquisition.provider';
import { StructuredPoiCatalogAcquisitionService } from '../../be/src/modules/tours/services/structured-poi-catalog-acquisition.service';
import { StructuredKnowledgePersistenceService } from '../../be/src/modules/tours/services/structured-knowledge-persistence.service';
import { ExperienceCatalogService } from '../../be/src/modules/tours/services/experience-catalog.service';
import { ExperienceAcquisitionPlannerService } from '../../be/src/modules/tours/services/experience-acquisition-planner.service';
import { ExperienceAcquisitionService } from '../../be/src/modules/tours/services/experience-acquisition.service';
import { PreferenceUtilityService } from '../../be/src/modules/tours/services/preference-utility.service';
import { buildPreferenceSpec } from '../../be/src/modules/tours/utils/preference-spec-builder.util';
import { structuredSelectionAssertion } from '../../be/src/modules/tours/utils/preference-facet-merge.util';
import { PREFERENCE_DIMENSIONS } from '../../be/src/modules/tours/preferences/preference-facet-vocabulary';
import * as smokeExtensions from './smoke-extensions';

const EXPECTED_DATABASE = 'zigzag_39_test';
const DESTINATION = {
  destinationName: 'Buenos Aires',
  destinationCountry: 'Argentina',
  destinationCountryCode: 'AR',
  latitude: -34.6161845,
  longitude: -58.4332979,
  radiusMeters: 13420.134076587048,
};

type Tags = Record<string, string>;

/** Diagnostic-only structured class buckets (never production input). */
const CLASS_BUCKETS: Array<[string, (t: Tags) => boolean]> = [
  ['tombs', (t) => t.historic === 'tomb'],
  ['memorials', (t) => t.historic === 'memorial'],
  ['monuments', (t) => t.historic === 'monument'],
  ['artworks', (t) => t.tourism === 'artwork'],
  ['museums', (t) => t.tourism === 'museum'],
  ['visitorAttractions', (t) => t.tourism === 'attraction'],
  ['heritageTagged', (t) => t.heritage !== undefined],
  ['placesOfWorship', (t) => t.amenity === 'place_of_worship'],
  ['parks', (t) => t.leisure === 'park'],
  ['foodRelated', (t) => isFoodRelated(t)],
];

/** Diagnostic gastronomy definition for supply measurement only. */
const FOOD_AMENITIES = new Set([
  'restaurant',
  'cafe',
  'marketplace',
  'food_court',
  'fast_food',
  'ice_cream',
  'pub',
  'bar',
  'biergarten',
]);
const FOOD_SHOPS = new Set([
  'bakery',
  'pastry',
  'confectionery',
  'deli',
  'cheese',
  'butcher',
  'greengrocer',
  'wine',
  'coffee',
  'tea',
  'chocolate',
]);
function isFoodRelated(t: Tags): boolean {
  return FOOD_AMENITIES.has(t.amenity ?? '') || FOOD_SHOPS.has(t.shop ?? '');
}
function foodType(t: Tags): string {
  if (FOOD_AMENITIES.has(t.amenity ?? '')) return `amenity=${t.amenity}`;
  return `shop=${t.shop}`;
}

function count<T>(items: readonly T[], key: (item: T) => string) {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function main() {
  const outDir = process.env.SMOKE_OUT;
  const label = process.env.SMOKE_LABEL ?? 'run';
  if (!outDir) throw new Error('SMOKE_OUT is required');
  mkdirSync(outDir, { recursive: true });

  // --- Disposable database guard (three independent checks) ---
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (decodeURIComponent(url.pathname.slice(1)) !== EXPECTED_DATABASE) {
    throw new Error(`Refusing: DATABASE_URL must target ${EXPECTED_DATABASE}`);
  }
  assertDisposableDatabase();
  const prisma = await getPrisma();
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>(
    Prisma.sql`SELECT current_database() AS db`,
  );
  if (db !== EXPECTED_DATABASE) {
    throw new Error(`Refusing: server reports database ${db}`);
  }
  const overpassUrl = process.env.OVERPASS_API_URL ?? '';
  if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(overpassUrl)) {
    throw new Error('Refusing: OVERPASS_API_URL must be the local service');
  }
  await resetDb();

  // --- Outbound request ledger: every external host the run contacts ---
  const hosts: Record<string, number> = {};
  axios.interceptors.request.use((config) => {
    const host = new URL(config.url ?? '', 'http://unknown').host;
    hosts[host] = (hosts[host] ?? 0) + 1;
    return config;
  });

  const config = new ConfigService();
  const overpass = new OverpassApiService(config);
  const osmPlaces = new OsmPlacesService(overpass as any, config);
  const captured: { candidates: any[] } = { candidates: [] };
  const capturingOsm = new Proxy(osmPlaces, {
    get(target, prop, receiver) {
      if (prop !== 'lookupFeaturesNear') {
        return Reflect.get(target, prop, receiver);
      }
      return async (...args: Parameters<OsmPlacesService['lookupFeaturesNear']>) => {
        const result = await target.lookupFeaturesNear(...args);
        captured.candidates.push(...result.value);
        return result;
      };
    },
  });
  const provider = smokeExtensions.buildStructuredPoiProvider(
    capturingOsm as OsmPlacesService,
    config,
  ) as StructuredPoiAcquisitionProvider;
  const catalog = new ExperienceCatalogService(prisma, {} as any);
  const persistence = new StructuredPoiCatalogAcquisitionService(
    prisma,
    catalog,
    new StructuredKnowledgePersistenceService(prisma),
  );
  const forbidden = (name: string) => ({
    [name]: () => {
      throw new Error(`Smoke forbids ${name}`);
    },
  });
  const acquisition = new ExperienceAcquisitionService(
    catalog,
    {} as any,
    undefined,
    undefined,
    forbidden('synthesizeProposals') as any,
    undefined,
    undefined,
    forbidden('search') as any,
    forbidden('extract') as any,
    undefined,
    forbidden('fetch') as any,
    undefined,
    provider,
    persistence,
  );
  const plan = smokeExtensions.buildPlan(
    new ExperienceAcquisitionPlannerService(),
    DESTINATION,
  );
  const startedAt = Date.now();
  const execution = await acquisition.executePlan(plan);
  const acquisitionMs = Date.now() - startedAt;
  const structured: any = (execution as any).providerResults?.structured_poi;
  if (!structured || structured.status !== 'success') {
    throw new Error(
      `STRUCTURED_POI did not succeed: ${JSON.stringify(structured)?.slice(0, 500)}`,
    );
  }
  const persistenceResult = structured.provenance.persistence;

  // Composition exactly as ExperienceGenerationService does after acquisition.
  const composedIds = await catalog.composeAdmittedPlacesWithinScope({
    latitude: DESTINATION.latitude,
    longitude: DESTINATION.longitude,
    radiusMeters: DESTINATION.radiusMeters,
  });
  const experiences = await catalog.findVerifiedByIds(composedIds);

  // Fixed typed smoke preferences; no language interpretation, no LLM.
  const preferenceSpec = buildPreferenceSpec(
    {
      days: 3,
      intent: {
        interests: ['history', 'architecture', 'gastronomy'],
        explorationStyle: 'balanced',
      },
      mobility: { travelPace: 'moderate' },
    } as any,
    {
      assertions: [
        structuredSelectionAssertion({
          field: 'smoke.localCharacter',
          dimension: PREFERENCE_DIMENSIONS.LOCAL_CHARACTER,
          key: 'traditional',
          polarity: 'INCLUDE',
          constraint: 'SOFT',
        }),
        structuredSelectionAssertion({
          field: 'smoke.iconicPlaces',
          dimension: PREFERENCE_DIMENSIONS.TOURISM_INTENSITY,
          key: 'iconic',
          polarity: 'INCLUDE',
          constraint: 'SOFT',
        }),
      ],
      unresolvedConcepts: [],
      anchoredPlaces: [],
      positiveSemanticQuery: '',
    } as any,
  );
  const preferenceUtility = await new PreferenceUtilityService({
    getSimilarityScores: forbidden('getSimilarityScores').getSimilarityScores,
  } as any).derive({
    experiences: experiences as any,
    preferenceSpec,
    softAnchorIds: [],
  });

  // --- Read back canonical persisted state ---
  const entities = await prisma.geoEntity.findMany({
    include: {
      identities: true,
      admission: true,
      childRelations: true,
      parentRelations: true,
    },
  });
  const relations = await prisma.geoEntityRelation.findMany();
  const prominence = await smokeExtensions.readProminence(prisma);
  const candidatesByKey = new Map<string, any>(
    captured.candidates.map((c) => [c.id, c]),
  );
  const entityTags = (entity: (typeof entities)[number]): Tags => {
    const merged: Tags = {};
    for (const identity of entity.identities) {
      Object.assign(merged, candidatesByKey.get(identity.externalId)?.tags ?? {});
    }
    return merged;
  };
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const admitted = entities.filter((e) => e.admission?.outcome === 'ADMITTED');
  const composedEntityIds = experiences.map(
    (experience: any) => experience.components?.[0]?.geoEntity?.id,
  );

  const bucketize = (list: Array<(typeof entities)[number]>) =>
    Object.fromEntries(
      CLASS_BUCKETS.map(([bucket, test]) => [
        bucket,
        list.filter((e) => test(entityTags(e))).length,
      ]),
    );

  // --- Visit-unit / edge diagnostics from the captured provider facts ---
  const edgeDiagnostics = smokeExtensions.diagnoseEdges(
    captured.candidates,
    persistenceResult.candidateOutcomes,
    relations,
  );

  // --- Gastronomy supply ---
  const foodCandidates = captured.candidates.filter((c) => isFoodRelated(c.tags));
  const outcomeByKey = new Map<string, any>(
    persistenceResult.candidateOutcomes.map((o: any) => [o.externalId, o]),
  );
  const composedSet = new Set(composedEntityIds);
  const gastronomy = {
    sourceInventory: await smokeExtensions.measureFoodInventory(
      overpassUrl,
      DESTINATION,
      Math.min(DESTINATION.radiusMeters, 8000),
    ),
    candidates: foodCandidates.length,
    candidatesWithWikidata: foodCandidates.filter((c) => c.tags.wikidata).length,
    byType: count(foodCandidates, (c) => foodType(c.tags)),
    admitted: foodCandidates.filter(
      (c) => outcomeByKey.get(c.id)?.admissionOutcome === 'ADMITTED',
    ).length,
    experiences: [
      ...new Set(
        foodCandidates
          .filter((c) => composedSet.has(outcomeByKey.get(c.id)?.geoEntityId))
          .map((c) => c.name),
      ),
    ],
    rejectionReasons: count(
      foodCandidates.filter(
        (c) => outcomeByKey.get(c.id)?.admissionOutcome !== 'ADMITTED',
      ),
      (c) => outcomeByKey.get(c.id)?.admissionOutcome ?? 'NO_OUTCOME',
    ),
  };

  // --- Top 30 by the production ordering ---
  const experienceById = new Map(experiences.map((e: any) => [e.id, e]));
  const top = preferenceUtility.order.slice(0, 30).map((id, index) => {
    const experience: any = experienceById.get(id);
    const geoEntityId = experience.components?.[0]?.geoEntity?.id;
    const entity = entityById.get(geoEntityId)!;
    const tags = entityTags(entity);
    const assessment = preferenceUtility.byId.get(id)!;
    const next = preferenceUtility.order[index + 1];
    return {
      rank: index + 1,
      name: experience.canonicalName,
      experienceId: id,
      geoEntityId,
      identities: entity.identities.map((i) => `${i.provider}:${i.externalId}`),
      structuredClass: CLASS_BUCKETS.filter(([, test]) => test(tags)).map(
        ([bucket]) => bucket,
      ),
      classTags: Object.fromEntries(
        Object.entries(tags).filter(([k]) =>
          ['tourism', 'historic', 'memorial', 'amenity', 'leisure', 'heritage', 'shop', 'artwork_type'].includes(k),
        ),
      ),
      admission: {
        outcome: entity.admission?.outcome,
        signals: entity.admission?.signals,
        policyVersion: entity.admission?.policyVersion,
      },
      prominenceEvidence: prominence.byGeoEntityId[geoEntityId] ?? [],
      preference: assessment.breakdown,
      orderReasonVsNext: next
        ? smokeExtensions.explainOrder(preferenceUtility, id, next)
        : null,
      parentChild: {
        childRelations: entity.childRelations.length,
        parentRelations: entity.parentRelations.length,
      },
    };
  });

  const funnel = {
    rawResultCount: structured.provenance.rawResultCount,
    structuredCandidates: persistenceResult.candidateOutcomes.length,
    canonicalIdentities: persistenceResult.canonicalCount,
    persistedGeoEntities: entities.length,
    identityConflicts: persistenceResult.candidateOutcomes.filter(
      (o: any) => o.admissionOutcome === 'IDENTITY_CONFLICT',
    ).length,
    possibleDuplicatePairs: persistenceResult.possibleDuplicates.length,
    possibleDuplicateReasons: count(
      persistenceResult.possibleDuplicates,
      (d: any) => d.reason ?? d.reasons?.join('+') ?? 'UNKNOWN',
    ),
    visitUnitOutcomes: count(
      persistenceResult.candidateOutcomes,
      (o: any) => o.visitUnitOutcome ?? 'NO_PARENT_RELATIONSHIP',
    ),
    persistedRelations: relations.length,
    relationDiagnostics: persistenceResult.relationDiagnostics ?? null,
    relationEvidenceSources: count(relations, (r) => r.evidenceSource),
    entityFacts: structured.provenance.entityFacts ?? null,
    parentAreas: structured.provenance.parentAreas ?? null,
    relationClassifications: count(
      relations,
      (r) => r.visitUnitClassification ?? 'UNCLASSIFIED',
    ),
    admissionOutcomes: count(entities, (e) => e.admission?.outcome ?? 'NONE'),
    admitted: admitted.length,
    rejected: entities.length - admitted.length,
    composed: experiences.length,
    withDuration: experiences.filter((e: any) => e.durationMinutes != null).length,
  };

  const report = {
    label,
    head: execSync('git rev-parse HEAD').toString().trim(),
    dirty: execSync('git status --porcelain').toString().trim().length > 0,
    runtime: {
      database: db,
      destinationScope: DESTINATION,
      overpass: overpassUrl,
      acquisitionMs,
      externalHosts: hosts,
      structuredRoute:
        (plan as any).sourcePlans?.find((p: any) => p.provider === 'structured_poi')
          ?.structuredPoi ?? null,
      structuredProvenance: {
        baseDiscovery: structured.provenance.baseDiscovery ?? null,
        coverage: structured.provenance.coverage ?? null,
      },
    },
    funnel,
    admittedByClass: bucketize(admitted),
    composedByClass: bucketize(
      composedEntityIds.map((id) => entityById.get(id)!).filter(Boolean),
    ),
    rejectionReasonsByClass: Object.fromEntries(
      CLASS_BUCKETS.map(([bucket, test]) => [
        bucket,
        count(
          entities.filter(
            (e) => test(entityTags(e)) && e.admission?.outcome !== 'ADMITTED',
          ),
          (e) => e.admission?.outcome ?? 'NONE',
        ),
      ]),
    ),
    prominence: prominence.summary(composedEntityIds),
    edgeDiagnostics,
    gastronomy,
    preferenceUtility: {
      policyVersion: preferenceUtility.policyVersion,
      semanticRanking: preferenceUtility.semanticRanking,
      facets: preferenceSpec.facets.map((f) => `${f.dimension}:${f.key}`),
    },
    top30: top,
  };
  writeFileSync(
    path.join(outDir, `catalog-smoke-${label}.json`),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    path.join(outDir, `catalog-smoke-${label}-full-order.json`),
    JSON.stringify(
      preferenceUtility.order.map((id) => (experienceById.get(id) as any).canonicalName),
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { label, funnel, gastronomy: { ...gastronomy, experiences: gastronomy.experiences.length }, externalHosts: hosts },
      null,
      2,
    ),
  );
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exitCode = 1;
});
