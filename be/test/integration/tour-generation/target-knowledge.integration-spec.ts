import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { getPrisma, resetDb, closeDb } from '../support/test-db';
import { TargetObservationFact } from 'src/modules/tours/preferences/target-knowledge.interface';

const WHEELCHAIR_KEY = 'accessibility:wheelchair_access';

function fact(
  sourceFactId: string,
  state: 'SATISFIES' | 'DOES_NOT_SATISFY' | 'INCONCLUSIVE',
): TargetObservationFact {
  return {
    target: { dimension: 'accessibility', key: 'wheelchair_access' },
    observation: { sourceFactId, state },
  };
}

describe('tour-generation integration · target knowledge (task 25.7)', () => {
  let catalog: ExperienceCatalogService;

  beforeAll(async () => {
    const prisma = await getPrisma();
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  async function experienceFor(
    externalId: string,
    targetObservations: TargetObservationFact[],
  ): Promise<string> {
    const prisma = await getPrisma();
    const geo = await catalog.upsertGeoEntity({
      name: 'Museo Accesible',
      kind: 'PLACE',
      provider: 'openstreetmap',
      externalId,
      latitude: -34.6083,
      longitude: -58.3712,
      targetObservations,
    });
    const experience = await prisma.experience.create({
      data: {
        canonicalName: 'Museo Accesible',
        status: 'VERIFIED',
        qualityScore: 4,
        latitude: -34.6083,
        longitude: -58.3712,
        components: {
          create: [
            { geoEntityId: geo.id, order: 0, role: 'venue', required: true },
          ],
        },
      },
    });
    return experience.id;
  }

  async function projectedKnowledge(experienceId: string) {
    const rows = await catalog.findVerifiedWithinForMatching(
      -34.6083,
      -58.3712,
      3000,
    );
    const row = rows.find((candidate) => candidate.id === experienceId);
    return row?.matchFacts.targetKnowledge;
  }

  it('persists a wheelchair=yes observation and surfaces reconciled SATISFIES', async () => {
    const id = await experienceFor('osm:node:1', [
      fact('osm:node:1:wheelchair', 'SATISFIES'),
    ]);
    expect(await projectedKnowledge(id)).toEqual([
      { byTarget: { [WHEELCHAIR_KEY]: { state: 'SATISFIES' } } },
    ]);
  });

  it('persists a wheelchair=no observation and surfaces DOES_NOT_SATISFY', async () => {
    const id = await experienceFor('osm:node:2', [
      fact('osm:node:2:wheelchair', 'DOES_NOT_SATISFY'),
    ]);
    expect(await projectedKnowledge(id)).toEqual([
      { byTarget: { [WHEELCHAIR_KEY]: { state: 'DOES_NOT_SATISFY' } } },
    ]);
  });

  it('reconciles independent yes+no observations to CONFLICTING_EVIDENCE', async () => {
    const id = await experienceFor('osm:node:3', [
      fact('osm:node:3:wheelchair', 'SATISFIES'),
      fact('osm:node:3:wheelchair:independent', 'DOES_NOT_SATISFY'),
    ]);
    expect(await projectedKnowledge(id)).toEqual([
      {
        byTarget: {
          [WHEELCHAIR_KEY]: {
            state: 'UNKNOWN',
            reason: 'CONFLICTING_EVIDENCE',
          },
        },
      },
    ]);
  });

  it('supersedes a re-observation of the same source-fact identity (one active row)', async () => {
    const prisma = await getPrisma();
    await experienceFor('osm:node:4', [
      fact('osm:node:4:wheelchair', 'SATISFIES'),
    ]);
    await experienceFor('osm:node:4', [
      fact('osm:node:4:wheelchair', 'DOES_NOT_SATISFY'),
    ]);

    const rows = await prisma.geoEntityTargetObservation.findMany({
      where: { sourceFactId: 'osm:node:4:wheelchair' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('DOES_NOT_SATISFY');
  });
});
