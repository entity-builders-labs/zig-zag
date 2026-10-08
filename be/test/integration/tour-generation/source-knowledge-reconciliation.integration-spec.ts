import { GeoEntityKind } from '@prisma/client';
import {
  ExperienceCatalogService,
  VerifiedExperienceComponentInput,
} from 'src/modules/tours/services/experience-catalog.service';
import { ExperienceEmbeddingIndexerService } from 'src/shared/ai/services/experience-embedding-indexer.service';
import { ExperienceVectorStoreService } from 'src/shared/ai/services/experience-vector-store.service';
import { EXPERIENCE_EMBEDDING_DOCUMENT_VERSION } from 'src/shared/ai/interfaces/embedding-index.interface';
import { buildTourExperienceCreateData } from 'src/modules/tours/utils/tour-experience-snapshot.util';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * SAME reconciliation (UNION OF KNOWLEDGE) against real Postgres: a later
 * observation of the SAME source composition resolves canonical members
 * that were unresolved, inside the catalog's SAME transaction. It never
 * merges different compositions (UNION OF EXPERIENCES), never downgrades a
 * resolution, never overwrites a conflicting one, and never leaves a stale
 * embedding authoritative.
 */
describe('tour-generation integration · SAME source-knowledge reconciliation', () => {
  let catalog: ExperienceCatalogService;
  const WALK = 'Self Guided Walking Tour San Telmo';
  const SOURCE = 'https://example.org/san-telmo-walk';
  const geo: Record<string, string> = {};

  const place = async (name: string, latitude: number, longitude: number) => {
    const result = await catalog.upsertGeoEntityWithIdentities({
      name,
      kind: GeoEntityKind.PLACE,
      latitude,
      longitude,
      identities: [{ provider: 'openstreetmap', externalId: `node/${name}` }],
    });
    if (result.status === 'IDENTITY_CONFLICT') throw new Error('conflict');
    return result.geoEntity.id;
  };

  type Member = { name: string; geo?: string };
  const components = (members: Member[]): VerifiedExperienceComponentInput[] =>
    members.map((member) =>
      member.geo
        ? { geoEntityId: member.geo, sourceName: member.name, role: 'stop' }
        : {
            resolutionState: 'UNRESOLVED',
            resolutionReason: 'NO_CANDIDATE_ACQUIRED',
            sourceName: member.name,
            role: 'stop',
          },
    );
  const persist = (members: Member[], canonicalName = WALK, url = SOURCE) =>
    catalog.persistVerifiedExperience({
      canonicalName,
      description: 'A self-guided historic walk.',
      metadata: { themes: ['history'], intents: ['walk'] },
      components: components(members),
      evidence: [{ source: 'web', url, title: canonicalName }],
    });

  const membersOf = async (experienceId: string) =>
    (
      await (
        await getPrisma()
      ).experienceComponent.findMany({
        where: { experienceId },
        orderBy: { sourcePosition: 'asc' },
      })
    ).map((member) => ({
      sourcePosition: member.sourcePosition,
      sourceName: member.sourceName,
      state: member.resolutionState,
      geoEntityId: member.geoEntityId,
      reason: member.resolutionReason,
      source: member.resolutionSource,
    }));

  const A = () => ({ name: 'Plaza Dorrego', geo: geo.dorrego });
  const B = () => ({ name: 'Casa Minima', geo: geo.casaMinima });
  const C = () => ({ name: 'Teatro Colon', geo: geo.teatroColon });
  const cUnresolved = { name: 'Teatro Colon' };
  const dUnresolved = { name: 'Obelisco' };

  beforeAll(async () => {
    catalog = new ExperienceCatalogService(await getPrisma(), {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
    geo.dorrego = await place('Plaza Dorrego', -34.6212, -58.3731);
    geo.casaMinima = await place('Casa Minima', -34.6209, -58.3703);
    geo.teatroColon = await place('Teatro Colon', -34.6011, -58.3833);
    geo.otherColon = await place('Teatro Colon Annex', -34.6013, -58.3836);
    geo.lezama = await place('Parque Lezama', -34.6265, -58.3696);
  });

  afterAll(async () => {
    await closeDb();
  });

  it('1/14. a richer SAME observation resolves canonical members, keeping id, positions, wording and count', async () => {
    const canonical = await persist([A(), B(), cUnresolved, dUnresolved]);
    const before = await membersOf(canonical.id);

    const observed = await persist([A(), B(), C(), dUnresolved]);

    expect((observed as any).dedupeDecision).toBe('SAME');
    expect(observed.id).toBe(canonical.id);
    expect((observed as any).sourceKnowledgeReconciliation.outcome).toBe(
      'ENRICHED',
    );
    const after = await membersOf(canonical.id);
    expect(
      after.map(({ sourcePosition, sourceName }) => [
        sourcePosition,
        sourceName,
      ]),
    ).toEqual(
      before.map(({ sourcePosition, sourceName }) => [
        sourcePosition,
        sourceName,
      ]),
    );
    expect(after[2]).toEqual(
      expect.objectContaining({
        state: 'RESOLVED',
        geoEntityId: geo.teatroColon,
        reason: null,
        source: 'AUTOMATIC',
      }),
    );
    expect(after[3]).toEqual(
      expect.objectContaining({ state: 'UNRESOLVED', geoEntityId: null }),
    );
    expect(
      await (
        await getPrisma()
      ).experience.count({
        where: { canonicalName: WALK },
      }),
    ).toBe(1);
  });

  it('2. a SAME observation with LESS knowledge does not remove a valid resolution', async () => {
    const canonical = await persist([A(), B(), C(), dUnresolved]);

    const observed = await persist([A(), B(), cUnresolved, dUnresolved]);

    expect((observed as any).dedupeDecision).toBe('SAME');
    expect((observed as any).sourceKnowledgeReconciliation.outcome).toBe(
      'NO_NEW_KNOWLEDGE',
    );
    expect((await membersOf(canonical.id))[2]).toEqual(
      expect.objectContaining({
        state: 'RESOLVED',
        geoEntityId: geo.teatroColon,
      }),
    );
  });

  it('3. a conflicting resolution of the same member fails closed: no silent overwrite', async () => {
    const canonical = await persist([A(), B(), C(), dUnresolved]);
    const before = await membersOf(canonical.id);

    const observed = await persist([
      A(),
      B(),
      { name: 'Teatro Colon', geo: geo.otherColon },
      { name: 'Obelisco', geo: geo.lezama },
    ]);

    // The dedupe authority never calls this SAME, so nothing is merged.
    expect((observed as any).dedupeDecision).not.toBe('SAME');
    expect(await membersOf(canonical.id)).toEqual(before);
  });

  it('4. SUBCOMPOSITION (A-B vs A-B-C-D) does not union source-member knowledge', async () => {
    const canonical = await persist([A(), B(), cUnresolved, dUnresolved]);
    const before = await membersOf(canonical.id);

    const sub = await persist([A(), B()], 'Dorrego and Casa Minima');

    expect((sub as any).dedupeEvidence.structure.relation).toBe(
      'SUBCOMPOSITION',
    );
    expect(sub.id).not.toBe(canonical.id);
    expect(await membersOf(canonical.id)).toEqual(before);
  });

  it('5. PARTIAL_OVERLAP does not union source-member knowledge', async () => {
    const canonical = await persist([A(), B(), cUnresolved, dUnresolved]);
    const before = await membersOf(canonical.id);

    const overlap = await persist(
      [A(), B(), C(), { name: 'Parque Lezama', geo: geo.lezama }],
      'San Telmo and Lezama loop',
      'https://example.org/other-walk',
    );

    expect((overlap as any).dedupeEvidence.structure.relation).toBe(
      'PARTIAL_OVERLAP',
    );
    expect(await membersOf(canonical.id)).toEqual(before);
  });

  it('12/13. enrichment invalidates the stale vector; the reindexed document carries the newly resolved member', async () => {
    const prisma = await getPrisma();
    const documents: string[][] = [];
    const identity = {
      provider: 'test',
      model: 'test-embedding',
      dimensions: 256,
      documentVersion: EXPERIENCE_EMBEDDING_DOCUMENT_VERSION,
    };
    const embeddings = {
      getIndexIdentity: () => identity,
      getStatus: () => ({ status: 'available' }),
      getEmbeddings: () => ({
        embedDocuments: async (batch: string[]) => {
          documents.push(batch);
          return batch.map(() => Array(256).fill(0.01));
        },
        embedQuery: async () => Array(256).fill(0.01),
      }),
    };
    const indexer = new ExperienceEmbeddingIndexerService(
      prisma,
      embeddings as any,
    );
    const vectorStore = new ExperienceVectorStoreService(
      embeddings as any,
      prisma,
    );

    const canonical = await persist([A(), B(), cUnresolved, dUnresolved]);
    await indexer.index([canonical.id]);
    expect(documents[0][0]).not.toContain('Teatro Colon');
    const indexedBefore = await vectorStore.getSimilarityScores(
      [canonical.id],
      'historic walk',
    );
    expect((indexedBefore as any).scores.has(canonical.id)).toBe(true);

    await persist([A(), B(), C(), dUnresolved]);

    // The 3/4-state vector is gone: it cannot rank the enriched Experience.
    const stale = await prisma.experience.findUniqueOrThrow({
      where: { id: canonical.id },
    });
    expect(stale.embeddedAt).toBeNull();
    expect(stale.embeddingDocumentVersion).toBeNull();
    const afterInvalidation = await vectorStore.getSimilarityScores(
      [canonical.id],
      'historic walk',
    );
    expect((afterInvalidation as any).scores.has(canonical.id)).toBe(false);

    // The same synchronous reindex the resolver runs after SAME embeds the
    // enriched document.
    await indexer.index([canonical.id]);
    expect(documents[1][0]).toContain('Teatro Colon');
    const reindexed = await vectorStore.getSimilarityScores(
      [canonical.id],
      'historic walk',
    );
    expect((reindexed as any).scores.has(canonical.id)).toBe(true);
  });

  it('15. a Tour materialized after enrichment snapshots only the resolved (navigable) members', async () => {
    const prisma = await getPrisma();
    const canonical = await persist([A(), B(), cUnresolved, dUnresolved]);
    await persist([A(), B(), C(), dUnresolved]);

    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: canonical.id },
      include: { components: { include: { geoEntity: true } } },
    });
    const tour = await prisma.tour.create({ data: { name: 'Snapshot tour' } });
    const created = await prisma.tourExperience.create({
      data: buildTourExperienceCreateData(
        tour.id,
        { dayNumber: 1, order: 1, duration: 2 },
        experience,
      ),
    });
    const snapshot = await prisma.tourExperienceComponent.findMany({
      where: { tourExperienceId: created.id },
      orderBy: { name: 'asc' },
    });
    expect(snapshot.map((component) => component.name)).toEqual([
      'Casa Minima',
      'Plaza Dorrego',
      'Teatro Colon',
    ]);
    expect(snapshot.every((component) => component.geoEntityId)).toBe(true);
  });
});
