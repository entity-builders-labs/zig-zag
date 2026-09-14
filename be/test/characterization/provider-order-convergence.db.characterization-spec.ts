import { ExperienceStatus } from '@prisma/client';
import { PrismaService } from 'src/core/database/prisma.service';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import {
  getGuardedCharacterizationPrisma,
  resetCharacterizationDb,
  closeDb,
} from './support/db';

/**
 * TEST 8 — PROVIDER ORDER MUST CONVERGE
 *
 * The same real Experience is discovered by two structured providers. One
 * emits rich facets (`themes/traits/intents`), the other emits empty arrays.
 * `ExperienceCatalogService.persistVerifiedExperience` dedupes them to SAME
 * and merges metadata with `mergeMetadata` = shallow `{ ...left, ...right }`
 * (incoming wins per top-level key).
 *
 * Characterization: compatible evidence converges to the same canonical
 * Experience regardless of persistence order.
 */

const CANONICAL_NAME = 'Shared Landmark Guided Visit';
const RICH_METADATA = {
  themes: ['history', 'architecture'],
  traits: ['guided_tour'],
  intents: ['walk'],
  source: 'grounded_experience_discovery',
};
const EMPTY_METADATA = {
  themes: [] as string[],
  traits: [] as string[],
  intents: [] as string[],
  source: 'grounded_experience_discovery',
};

describe('CHAR-8 provider order convergence (real Postgres)', () => {
  let prisma: PrismaService;
  let catalog: ExperienceCatalogService;

  beforeAll(async () => {
    prisma = await getGuardedCharacterizationPrisma();
    catalog = new ExperienceCatalogService(prisma, {} as any);
  });

  afterAll(async () => {
    await resetCharacterizationDb(prisma);
    await closeDb();
  });

  async function seedGeoEntity(): Promise<string> {
    const geo = await prisma.geoEntity.create({
      data: {
        name: 'Shared Landmark',
        kind: 'PLACE',
        latitude: -32.9475,
        longitude: -60.6284,
      },
    });
    return geo.id;
  }

  async function persist(geoEntityId: string, metadata: unknown) {
    return catalog.persistVerifiedExperience({
      canonicalName: CANONICAL_NAME,
      description: 'A guided visit to a shared landmark.',
      durationMinutes: 90,
      metadata,
      components: [{ geoEntityId, role: 'venue', required: true }],
      evidence: [{ source: 'osm' }],
    });
  }

  async function finalFacets(): Promise<{
    themes: unknown;
    traits: unknown;
    intents: unknown;
    count: number;
  }> {
    const rows = await prisma.experience.findMany({
      where: {
        status: ExperienceStatus.VERIFIED,
        canonicalName: CANONICAL_NAME,
      },
    });
    const meta = (rows[0]?.metadata ?? {}) as Record<string, unknown>;
    return {
      themes: meta.themes,
      traits: meta.traits,
      intents: meta.intents,
      count: rows.length,
    };
  }

  it('RUN 1 — empty provider then rich provider: rich facets survive', async () => {
    await resetCharacterizationDb(prisma);
    const geoEntityId = await seedGeoEntity();
    await persist(geoEntityId, EMPTY_METADATA);
    const second = await persist(geoEntityId, RICH_METADATA);
    expect((second as any).dedupeDecision).toBe('SAME');

    const facets = await finalFacets();
    // eslint-disable-next-line no-console
    console.info('[CHAR-8] RUN1 empty->rich =>', JSON.stringify(facets));
    expect(facets.count).toBe(1);
    expect(facets.themes).toEqual(['architecture', 'history']);
    expect(facets.traits).toEqual(['guided_tour']);
    expect(facets.intents).toEqual(['walk']);
  });

  it('RUN 2 — rich provider then empty provider: rich facets remain canonical', async () => {
    await resetCharacterizationDb(prisma);
    const geoEntityId = await seedGeoEntity();
    await persist(geoEntityId, RICH_METADATA);
    const second = await persist(geoEntityId, EMPTY_METADATA);
    expect((second as any).dedupeDecision).toBe('SAME');

    const facets = await finalFacets();
    // eslint-disable-next-line no-console
    console.info('[CHAR-8] RUN2 rich->empty =>', JSON.stringify(facets));
    expect(facets.count).toBe(1);
    expect(facets.themes).toEqual(['architecture', 'history']);
    expect(facets.traits).toEqual(['guided_tour']);
    expect(facets.intents).toEqual(['walk']);
  });

  it('INVARIANT: the canonical Experience has the same facets regardless of provider order', async () => {
    await resetCharacterizationDb(prisma);
    let geoEntityId = await seedGeoEntity();
    await persist(geoEntityId, EMPTY_METADATA);
    await persist(geoEntityId, RICH_METADATA);
    const run1 = await finalFacets();

    await resetCharacterizationDb(prisma);
    geoEntityId = await seedGeoEntity();
    await persist(geoEntityId, RICH_METADATA);
    await persist(geoEntityId, EMPTY_METADATA);
    const run2 = await finalFacets();

    expect(run2).toEqual(run1);
  });
});
