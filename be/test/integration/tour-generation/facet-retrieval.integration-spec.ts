import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { FacetRetrievalService } from 'src/modules/tours/services/facet-retrieval.service';
import { RequestedFacet } from 'src/modules/tours/interfaces/preference-spec.interface';
import { getPrisma, resetDb, closeDb } from '../support/test-db';
import { seedVerifiedExperience } from '../support/seed';

/**
 * Task A6 (facet strong/weak/satisfied semantics) + Task A6.1 (PostGIS
 * geography boundary review fix) integration coverage.
 *
 * The scale regressions that prove the old `FACET_RETRIEVAL_LIMIT = 2000` /
 * bounded-global-scan boundary is gone live in
 * `catalog-retrieval.integration-spec.ts`, directly against
 * `ExperienceCatalogService.findVerifiedWithinForMatching` -- this file
 * focuses on facet-matching-specific behavior (strong/weak/satisfied,
 * embedding non-authority) wired through the real
 * `ExperienceCatalogService` + real Postgres/PostGIS.
 */
describe('tour-generation integration · facet retrieval (Task A6 / A6.1)', () => {
  let catalog: ExperienceCatalogService;
  let service: FacetRetrievalService;

  const CENTER = { latitude: -34.6083, longitude: -58.3712 };
  // The destination polygon the 5 km window belongs to (PD1 eligibility).
  const DESTINATION: GeographicScope = {
    kind: 'AREA_BOUNDARY',
    boundary: {
      id: 'osm:relation:1',
      name: 'Fixture City',
      osmType: 'relation',
      osmId: 1,
      tags: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.45, -34.66],
            [-58.3, -34.66],
            [-58.3, -34.55],
            [-58.45, -34.55],
            [-58.45, -34.66],
          ],
        ],
      },
    },
  };
  const HISTORY_FACET: RequestedFacet = {
    dimension: 'theme',
    key: 'history',
    weight: 1,
    source: 'wizard',
    required: false,
  };

  beforeAll(async () => {
    const prisma = await getPrisma();
    // Real services, only the external Places dependency stubbed.
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
    service = new FacetRetrievalService(catalog);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('marks a facet satisfied when a single strong match exists', async () => {
    const prisma = await getPrisma();
    const id = await seedVerifiedExperience(prisma, {
      canonicalName: 'Museo Histórico Nacional',
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
      themes: ['history'],
      qualityScore: 4.0,
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
      destination: DESTINATION,
    });

    expect(result.strongMatches).toEqual([id]);
    expect(result.satisfied).toBe(true);
  });

  it('does not match a candidate whose name contains the facet key but whose themes do not', async () => {
    const prisma = await getPrisma();
    await seedVerifiedExperience(prisma, {
      canonicalName: 'History Bar & Grill', // name contains "History"...
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
      themes: ['food'], // ...but themes do not include "history".
      qualityScore: 4.5,
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
      destination: DESTINATION,
    });

    expect(result.strongMatches).toEqual([]);
    expect(result.weakMatches).toEqual([]);
    expect(result.satisfied).toBe(false);
  });

  it('never returns a bare/no-component Experience at all (Task A6.1 -- the PostGIS boundary requires a real component)', async () => {
    const prisma = await getPrisma();
    const bare = await prisma.experience.create({
      data: {
        canonicalName: 'Bare Row (no components)',
        status: 'VERIFIED',
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
        qualityScore: 4.5,
        metadata: { themes: ['history'] },
      },
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
      destination: DESTINATION,
    });

    // Under A6's old Experience.latitude/longitude-authoritative boundary
    // this thematically-matching bare row would have landed in weakMatches.
    // Under A6.1's component-grounded PostGIS boundary it is never even
    // returned by the geography query, so it cannot be strong OR weak.
    expect(result.strongMatches).not.toContain(bare.id);
    expect(result.weakMatches).not.toContain(bare.id);
  });

  it('never lets a non-matching candidate into history strong/weak coverage, no matter how high a diagnostic/mock semantic similarity it carries', async () => {
    const prisma = await getPrisma();
    // A real, in-scope, high-quality, component-grounded Experience -- but
    // themed "tango", not "history". Carries a diagnostic field shaped like
    // a future embedding-based semanticSimilarity score of 0.99 (spec/plan:
    // "an Experience with no history facet remains non-matching even if a
    // later embedding similarity would be very high"). A6/A6.1 never
    // generate or consult embeddings for coverage -- this proves nothing
    // resembling that signal can smuggle a non-matching row into coverage.
    const tangoId = await seedVerifiedExperience(prisma, {
      canonicalName: 'Tango Show Venue',
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
      themes: ['tango'],
      qualityScore: 4.9,
    });
    await prisma.experience.update({
      where: { id: tangoId },
      data: {
        metadata: {
          source: 'seed',
          themes: ['tango'],
          traits: [],
          intents: [],
          // Diagnostic-only mock field; must never be read by matching.
          semanticSimilarity: 0.99,
        },
      },
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
      destination: DESTINATION,
    });

    expect(result.strongMatches).not.toContain(tangoId);
    expect(result.weakMatches).not.toContain(tangoId);
    expect(result.satisfied).toBe(false);
  });
});
