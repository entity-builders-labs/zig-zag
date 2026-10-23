import { OsmPlacesService } from '../../../src/modules/integrations/osm/services/osm-places.service';
import { StructuredPoiAcquisitionProvider } from '../../../src/modules/tours/providers/structured-poi-acquisition.provider';
import { StructuredPoiCatalogAcquisitionService } from '../../../src/modules/tours/services/structured-poi-catalog-acquisition.service';
import { StructuredKnowledgePersistenceService } from '../../../src/modules/tours/services/structured-knowledge-persistence.service';
import { ExperienceCatalogService } from '../../../src/modules/tours/services/experience-catalog.service';
import { STRUCTURED_PROMINENCE_POLICY_VERSION } from '../../../src/modules/tours/prominence/structured-prominence.policy';
import { ExperienceAcquisitionPlannerService } from '../../../src/modules/tours/services/experience-acquisition-planner.service';
import { ExperienceAcquisitionService } from '../../../src/modules/tours/services/experience-acquisition.service';
import { closeDb, getPrisma, resetDb } from '../support/test-db';

const destination = {
  destinationName: 'Fixture City',
  latitude: -34.6,
  longitude: -58.38,
  radiusMeters: 5_000,
};

type Feature = {
  osmType: 'node' | 'way';
  osmId: number;
  tags: Record<string, string>;
};

function osmFeatures(features: Feature[]) {
  return {
    lookupFeaturesNear: jest.fn().mockResolvedValue({
      status: 'success',
      rawResultCount: features.length,
      value: features.map((feature) => ({
        id: `osm:${feature.osmType}:${feature.osmId}`,
        name: `Fixture place ${feature.osmId}`,
        osmType: feature.osmType,
        osmId: feature.osmId,
        geometry: {
          type: 'Point' as const,
          coordinates: [-58.38, -34.6],
        },
        tags: feature.tags,
      })),
    }),
  } as unknown as OsmPlacesService;
}

function wikidataOutcome(input: {
  facts?: Array<{ qid: string; articles?: string[]; heritage?: string[] }>;
  missing?: string[];
  failed?: string[];
  observedAt?: Date;
}) {
  return {
    lookupStructuredEntityFacts: jest.fn().mockResolvedValue({
      facts: new Map(
        (input.facts ?? []).map((item) => [
          item.qid,
          {
            qid: item.qid,
            instanceOf: [] as string[],
            heritageDesignations: item.heritage ?? [],
            sitelinks: (item.articles ?? []).map((language) => ({
              site: `${language}wiki`,
              url: `https://${language}.wikipedia.org/wiki/Fixture`,
            })),
          },
        ]),
      ),
      missingQids: new Set(input.missing ?? []),
      failedQids: new Set(input.failed ?? []),
      observedAt: input.observedAt ?? new Date('2026-10-23T10:00:00Z'),
    }),
  };
}

describe('tour-generation integration · structured prominence evidence (task 39.3)', () => {
  beforeEach(async () => resetDb());

  afterAll(async () => closeDb());

  async function acquire(
    features: Feature[],
    wikidata: ReturnType<typeof wikidataOutcome>,
  ) {
    const prisma = await getPrisma();
    const provider = new StructuredPoiAcquisitionProvider(
      osmFeatures(features),
      wikidata as any,
    );
    const catalog = new ExperienceCatalogService(prisma, {} as any);
    const persistence = new StructuredPoiCatalogAcquisitionService(
      prisma,
      catalog,
      new StructuredKnowledgePersistenceService(prisma),
    );
    const discovered = await provider.acquire(destination, {
      radiusMeters: 5_000,
      entityFacts: { sourceClass: 'STRUCTURED_ENTITY_FACTS' },
    });
    const result = await persistence.persist(discovered.value);
    return { prisma, catalog, result };
  }

  async function entityFor(prisma: any, externalId: string) {
    const identity = await prisma.geoEntityIdentity.findUniqueOrThrow({
      where: {
        provider_externalId: { provider: 'openstreetmap', externalId },
      },
      include: {
        geoEntity: { include: { admission: true, prominenceEvidence: true } },
      },
    });
    return identity.geoEntity;
  }

  it('a QID with no recorded articles stays identity evidence only: no prominence row and no notability admission', async () => {
    const { prisma } = await acquire(
      [
        {
          osmType: 'node',
          osmId: 1,
          tags: { historic: 'memorial', wikidata: 'Q1' },
        },
      ],
      wikidataOutcome({ facts: [{ qid: 'Q1' }] }),
    );
    const entity = await entityFor(prisma, 'osm:node:1');

    expect(entity.prominenceEvidence).toEqual([]);
    expect(entity.admission).toMatchObject({
      outcome: 'INSUFFICIENT_ADMISSION_EVIDENCE',
      signals: ['HISTORIC_CLASSIFICATION'],
    });
    await expect(
      prisma.geoEntityIdentity.findUnique({
        where: {
          provider_externalId: { provider: 'wikidata', externalId: 'Q1' },
        },
      }),
    ).resolves.toMatchObject({ geoEntityId: entity.id });
  });

  it('persists encyclopedic evidence with its provenance and lets descriptive + notability admit per C6', async () => {
    const observedAt = new Date('2026-10-23T11:00:00Z');
    const { prisma } = await acquire(
      [
        {
          osmType: 'node',
          osmId: 2,
          tags: { historic: 'memorial', wikidata: 'Q2' },
        },
      ],
      wikidataOutcome({
        facts: [
          { qid: 'Q2', articles: ['es', 'en', 'fr'], heritage: ['Q900'] },
        ],
        observedAt,
      }),
    );
    const entity = await entityFor(prisma, 'osm:node:2');

    expect(
      entity.prominenceEvidence
        .map((row: any) => {
          const { id, geoEntityId, ...fact } = row;
          expect(id).toEqual(expect.any(String));
          expect(geoEntityId).toBe(entity.id);
          return fact;
        })
        .sort((a: any, b: any) => a.kind.localeCompare(b.kind)),
    ).toEqual([
      {
        kind: 'ENCYCLOPEDIC_SITELINK_COUNT',
        sourceProvider: 'wikidata',
        providerIdentity: 'Q2',
        sourceRecordId: 'Q2',
        fieldPath: 'sitelinks',
        numericValue: 3,
        textValue: null,
        languageCode: null,
        authority: null,
        designationLevel: null,
        providerMetric: null,
        comparisonScope: null,
        observedAt,
        policyVersion: STRUCTURED_PROMINENCE_POLICY_VERSION,
      },
      {
        kind: 'HERITAGE_DESIGNATION',
        sourceProvider: 'wikidata',
        providerIdentity: 'Q2',
        sourceRecordId: 'Q2',
        fieldPath: 'claims.P1435.Q900',
        numericValue: null,
        textValue: null,
        languageCode: null,
        authority: null,
        designationLevel: 'Q900',
        providerMetric: null,
        comparisonScope: null,
        observedAt,
        policyVersion: STRUCTURED_PROMINENCE_POLICY_VERSION,
      },
    ]);
    // Heritage designation is decisive admission evidence (39.2 canonical).
    expect(entity.admission.outcome).toBe('ADMITTED');
    expect(entity.admission.signals).toEqual(
      expect.arrayContaining([
        'HERITAGE_DESIGNATION',
        'ENCYCLOPEDIC_NOTABILITY',
      ]),
    );
    expect((entity.admission.evidence as any).signalEvidence).toEqual(
      expect.arrayContaining([
        {
          signal: 'ENCYCLOPEDIC_NOTABILITY',
          field: 'sitelinks',
          value: 3,
          provider: 'wikidata',
          externalId: 'Q2',
        },
      ]),
    );
  });

  it('historic classification plus independent notability admits; without notability it does not', async () => {
    const { prisma } = await acquire(
      [
        {
          osmType: 'node',
          osmId: 3,
          tags: { historic: 'monument', wikidata: 'Q3' },
        },
        { osmType: 'node', osmId: 4, tags: { historic: 'monument' } },
      ],
      wikidataOutcome({ facts: [{ qid: 'Q3', articles: ['es'] }] }),
    );
    expect((await entityFor(prisma, 'osm:node:3')).admission.outcome).toBe(
      'ADMITTED',
    );
    const absent = await entityFor(prisma, 'osm:node:4');
    expect(absent.admission.outcome).toBe('INSUFFICIENT_ADMISSION_EVIDENCE');
    expect(absent.prominenceEvidence).toEqual([]);
  });

  it('attaches the prominence of a reconciled duplicate to the surviving canonical GeoEntity only', async () => {
    const { prisma } = await acquire(
      [
        {
          osmType: 'node',
          osmId: 5,
          tags: { tourism: 'attraction', wikidata: 'Q5' },
        },
        {
          osmType: 'way',
          osmId: 6,
          tags: { tourism: 'attraction', wikidata: 'Q5' },
        },
      ],
      wikidataOutcome({ facts: [{ qid: 'Q5', articles: ['es', 'en'] }] }),
    );
    const node = await entityFor(prisma, 'osm:node:5');
    const way = await entityFor(prisma, 'osm:way:6');

    expect(node.id).toBe(way.id);
    expect(await prisma.geoEntity.count()).toBe(1);
    const rows = await prisma.geoEntityProminenceEvidence.findMany();
    expect(new Set(rows.map((row: any) => row.geoEntityId))).toEqual(
      new Set([way.id]),
    );
    expect(
      rows.filter((row: any) => row.kind === 'ENCYCLOPEDIC_SITELINK_COUNT'),
    ).toHaveLength(1);
  });

  it('an unavailable lookup keeps prior evidence; a later observation updates it in place without changing identity or composition', async () => {
    const features: Feature[] = [
      {
        osmType: 'node',
        osmId: 7,
        tags: { tourism: 'museum', wikidata: 'Q7' },
      },
    ];
    const first = await acquire(
      features,
      wikidataOutcome({ facts: [{ qid: 'Q7', articles: ['es'] }] }),
    );
    const before = await entityFor(first.prisma, 'osm:node:7');
    await first.catalog.composeAdmittedPlacesWithinScope(destination);
    const experienceBefore = await first.prisma.experience.findFirstOrThrow();

    const unavailable = await acquire(
      features,
      wikidataOutcome({ failed: ['Q7'] }),
    );
    const kept = await entityFor(unavailable.prisma, 'osm:node:7');
    expect(kept.id).toBe(before.id);
    expect(
      kept.prominenceEvidence.find(
        (row: any) => row.kind === 'ENCYCLOPEDIC_SITELINK_COUNT',
      ),
    ).toMatchObject({ numericValue: 1 });

    const updated = await acquire(
      features,
      wikidataOutcome({ facts: [{ qid: 'Q7', articles: ['es', 'en', 'it'] }] }),
    );
    const after = await entityFor(updated.prisma, 'osm:node:7');
    await updated.catalog.composeAdmittedPlacesWithinScope(destination);
    const experienceAfter = await updated.prisma.experience.findFirstOrThrow();

    expect(after.id).toBe(before.id);
    expect(
      after.prominenceEvidence.find(
        (row: any) => row.kind === 'ENCYCLOPEDIC_SITELINK_COUNT',
      ),
    ).toMatchObject({ numericValue: 3 });
    expect(experienceAfter.id).toBe(experienceBefore.id);
    expect(experienceAfter.compositionSignature).toBe(
      experienceBefore.compositionSignature,
    );
    expect(await updated.prisma.experience.count()).toBe(1);

    // A resolved item that no longer records articles removes the stale fact.
    const cleared = await acquire(
      features,
      wikidataOutcome({ facts: [{ qid: 'Q7' }] }),
    );
    const clearedEntity = await entityFor(cleared.prisma, 'osm:node:7');
    expect(
      clearedEntity.prominenceEvidence.map((row: any) => row.kind),
    ).toEqual(['EXPLICIT_VISITOR_CLASSIFICATION']);
  });

  it('an unavailable encyclopedic lookup cannot revoke an admission that rested on that evidence; a resolved absence re-evaluates it', async () => {
    const features: Feature[] = [
      {
        osmType: 'node',
        osmId: 8,
        tags: { historic: 'memorial', wikidata: 'Q8' },
      },
    ];
    const admitted = await acquire(
      features,
      wikidataOutcome({ facts: [{ qid: 'Q8', articles: ['es', 'en'] }] }),
    );
    expect(
      (await entityFor(admitted.prisma, 'osm:node:8')).admission.outcome,
    ).toBe('ADMITTED');

    const outage = await acquire(features, wikidataOutcome({ failed: ['Q8'] }));
    const kept = await entityFor(outage.prisma, 'osm:node:8');
    expect(kept.admission.outcome).toBe('ADMITTED');
    expect(kept.admission.signals).toEqual(
      expect.arrayContaining(['ENCYCLOPEDIC_NOTABILITY']),
    );
    expect((kept.admission.evidence as any).signalEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: 'ENCYCLOPEDIC_NOTABILITY',
          provider: 'wikidata',
          externalId: 'Q8',
          value: 2,
        }),
      ]),
    );

    const resolvedAbsent = await acquire(
      features,
      wikidataOutcome({ missing: ['Q8'] }),
    );
    expect(
      (await entityFor(resolvedAbsent.prisma, 'osm:node:8')).admission.outcome,
    ).toBe('INSUFFICIENT_ADMISSION_EVIDENCE');
  });

  it('the production planner routes entity facts through the executor into persisted evidence', async () => {
    const prisma = await getPrisma();
    const wikidata = wikidataOutcome({
      facts: [{ qid: 'Q9', articles: ['es'] }],
    });
    const provider = new StructuredPoiAcquisitionProvider(
      osmFeatures([
        {
          osmType: 'node',
          osmId: 9,
          tags: { tourism: 'museum', wikidata: 'Q9' },
        },
      ]),
      wikidata as any,
    );
    const catalog = new ExperienceCatalogService(prisma, {} as any);
    const acquisition = new ExperienceAcquisitionService(
      catalog,
      {} as any,
      undefined,
      undefined,
      { synthesizeProposals: jest.fn() } as any,
      undefined,
      undefined,
      { search: jest.fn() } as any,
      { extract: jest.fn() } as any,
      undefined,
      { fetch: jest.fn() } as any,
      undefined,
      provider,
      new StructuredPoiCatalogAcquisitionService(
        prisma,
        catalog,
        new StructuredKnowledgePersistenceService(prisma),
      ),
    );
    const plan = new ExperienceAcquisitionPlannerService().buildAcquisitionPlan(
      {
        destination,
        deficits: [
          {
            origin: 'global_capacity',
            reason: 'Fixture capacity gap',
            currentEligibleCount: 0,
            requiredEligibleCount: 1,
          },
        ],
      },
    );

    const result: any = await acquisition.executePlan(plan);

    expect(wikidata.lookupStructuredEntityFacts).toHaveBeenCalledWith(['Q9']);
    expect(result.providerResults.structured_poi.provenance).toMatchObject({
      entityFacts: { status: 'SUCCEEDED', requested: 1, known: 1 },
    });
    const entity = await entityFor(prisma, 'osm:node:9');
    expect(
      entity.prominenceEvidence.map((row: any) => row.kind).sort(),
    ).toEqual([
      'ENCYCLOPEDIC_SITELINK_COUNT',
      'EXPLICIT_VISITOR_CLASSIFICATION',
    ]);
  });
});
