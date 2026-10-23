import { ExperienceAcquisitionPlan } from '../../../src/modules/tours/interfaces/experience-acquisition-plan.interface';
import { ExperienceAcquisitionPlannerService } from '../../../src/modules/tours/services/experience-acquisition-planner.service';
import { ExperienceAcquisitionService } from '../../../src/modules/tours/services/experience-acquisition.service';
import { StructuredPoiAcquisitionProvider } from '../../../src/modules/tours/providers/structured-poi-acquisition.provider';
import { StructuredPoiCatalogAcquisitionService } from '../../../src/modules/tours/services/structured-poi-catalog-acquisition.service';
import { StructuredKnowledgePersistenceService } from '../../../src/modules/tours/services/structured-knowledge-persistence.service';
import { ExperienceCatalogService } from '../../../src/modules/tours/services/experience-catalog.service';
import { OsmPlacesService } from '../../../src/modules/integrations/osm/services/osm-places.service';
import { closeDb, getPrisma, resetDb } from '../support/test-db';

const destination = {
  destinationName: 'Buenos Aires',
  latitude: -34.6,
  longitude: -58.38,
  radiusMeters: 5_000,
};

function osm(
  osmType: 'node' | 'way' | 'relation',
  osmId: number,
  name: string,
  tags: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `osm:${osmType}:${osmId}`,
    name,
    osmType,
    osmId,
    geometry: {
      type: 'Point' as const,
      coordinates: [-58.38 + osmId / 1_000_000, -34.6],
    },
    tags,
    ...extra,
  };
}

describe('tour-generation integration · destination structured POI path', () => {
  beforeEach(async () => resetDb());

  afterAll(async () => closeDb());

  async function runProductionPlan(
    features: ReturnType<typeof osm>[],
    lookupStatus: 'success' | 'failed' = 'success',
  ) {
    const prisma = await getPrisma();
    const osmPlaces = {
      lookupFeaturesNear: jest.fn().mockResolvedValue(
        lookupStatus === 'failed'
          ? {
              status: 'failed',
              value: [],
              rawResultCount: 0,
              failureReason: 'Overpass offline',
            }
          : {
              status: 'success',
              value: features,
              rawResultCount: features.length,
            },
      ),
      // No parent-site area geometry in this fixture: containment is
      // covered by structured-parent-containment.integration-spec.ts.
      lookupAreaGeometries: jest.fn().mockResolvedValue({
        status: 'success',
        value: new Map(),
        failedIds: [],
      }),
    } as unknown as OsmPlacesService;
    const provider = new StructuredPoiAcquisitionProvider(osmPlaces);
    const catalog = new ExperienceCatalogService(prisma, {} as any);
    const persistence = new StructuredPoiCatalogAcquisitionService(
      prisma,
      catalog,
      new StructuredKnowledgePersistenceService(prisma),
    );
    const synthesizer = { synthesizeProposals: jest.fn() };
    const groundedSearch = { search: jest.fn() };
    const discoveryExtractor = { extract: jest.fn() };
    const webContent = { fetch: jest.fn() };
    const acquisition = new ExperienceAcquisitionService(
      catalog,
      {} as any,
      undefined,
      undefined,
      synthesizer as any,
      undefined,
      undefined,
      groundedSearch as any,
      discoveryExtractor as any,
      undefined,
      webContent as any,
      undefined,
      provider,
      persistence,
    );
    const plan: ExperienceAcquisitionPlan =
      new ExperienceAcquisitionPlannerService().buildAcquisitionPlan({
        destination,
        deficits: [
          {
            origin: 'global_capacity',
            reason: 'Destination catalog has candidate-supply capacity gap',
            currentEligibleCount: 0,
            requiredEligibleCount: 1,
          },
        ],
      });
    const result = await acquisition.executePlan(plan);
    return {
      prisma,
      osmPlaces,
      plan,
      result,
      synthesizer,
      groundedSearch,
      discoveryExtractor,
      webContent,
    };
  }

  it('discovers, reconciles, applies visit-unit/admission policies and persists without proposal or research calls', async () => {
    const {
      prisma,
      osmPlaces,
      plan,
      result,
      synthesizer,
      groundedSearch,
      discoveryExtractor,
      webContent,
    } = await runProductionPlan([
      osm('node', 101, 'Standalone museum', {
        tourism: 'museum',
        opening_hours: 'Mo-Fr 10:00-18:00',
      }),
      osm('node', 102, 'Bare artwork', {
        tourism: 'artwork',
      }),
      osm(
        'relation',
        103,
        'Museum complex',
        { tourism: 'museum' },
        {
          memberIds: ['osm:node:104'],
        },
      ),
      osm('node', 104, 'Artwork inside museum', { tourism: 'artwork' }),
      osm('node', 105, 'Art museum with evidence duration', {
        tourism: 'museum',
        visit_duration_minutes: '75',
      }),
      osm('node', 106, 'Art museum without duration', { tourism: 'museum' }),
      osm('node', 107, 'Museum Wikidata node', {
        tourism: 'museum',
        wikidata: 'Q9001',
      }),
      osm('way', 108, 'Museum Wikidata way', {
        tourism: 'museum',
        wikidata: 'Q9001',
      }),
      osm(
        'relation',
        109,
        'Museum label relation',
        { tourism: 'museum' },
        { identityMemberIds: ['osm:node:110'] },
      ),
      osm('node', 110, 'Museum label node', { tourism: 'museum' }),
    ]);

    expect(plan.sourcePlans.map((source) => source.provider)).toEqual([
      'structured_poi',
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.structuredPoiPersistence).toMatchObject({
      status: 'SUCCEEDED',
      discoveredCount: 10,
      canonicalCount: 8,
      persistedCount: 8,
    });
    expect(result.structuredPoiPersistence?.candidateOutcomes).toHaveLength(10);
    expect(
      result.providerResults.structured_poi?.provenance?.persistence,
    ).toMatchObject({
      status: 'SUCCEEDED',
      canonicalCount: 8,
      candidateOutcomes: expect.arrayContaining([
        expect.objectContaining({
          externalId: 'osm:node:104',
          visitUnitOutcome: 'SUB_FEATURE_OF',
        }),
      ]),
    });
    expect(osmPlaces.lookupFeaturesNear).toHaveBeenCalledTimes(1);
    expect(osmPlaces.lookupFeaturesNear).toHaveBeenCalledWith(
      destination.latitude,
      destination.longitude,
      destination.radiusMeters,
      expect.any(Array),
    );

    const standalone = await prisma.geoEntity.findFirstOrThrow({
      where: { name: 'Standalone museum' },
    });
    expect(
      await prisma.geoEntityAdmission.findUniqueOrThrow({
        where: { geoEntityId: standalone.id },
      }),
    ).toMatchObject({
      outcome: 'ADMITTED',
      evidence: expect.objectContaining({
        provider: 'openstreetmap',
        signalEvidence: expect.arrayContaining([
          {
            signal: 'EXPLICIT_VISITOR_CLASSIFICATION',
            provider: 'openstreetmap',
            externalId: 'osm:node:101',
            field: 'tourism',
            value: 'museum',
          },
        ]),
      }),
    });
    expect(
      await prisma.geoEntityOpeningHours.findUniqueOrThrow({
        where: { geoEntityId: standalone.id },
      }),
    ).toMatchObject({
      status: 'UNKNOWN',
      source: 'openstreetmap',
      sourceRaw: 'Mo-Fr 10:00-18:00',
    });

    const artwork = await prisma.geoEntity.findFirstOrThrow({
      where: { name: 'Bare artwork' },
    });
    expect(
      await prisma.geoEntityAdmission.findUniqueOrThrow({
        where: { geoEntityId: artwork.id },
      }),
    ).toMatchObject({ outcome: 'INSUFFICIENT_ADMISSION_EVIDENCE' });

    const child = await prisma.geoEntity.findFirstOrThrow({
      where: { name: 'Artwork inside museum' },
    });
    const parent = await prisma.geoEntity.findFirstOrThrow({
      where: { name: 'Museum complex' },
    });
    expect(
      await prisma.geoEntityRelation.findUniqueOrThrow({
        where: {
          childId_parentId_type: {
            childId: child.id,
            parentId: parent.id,
            type: 'PART_OF',
          },
        },
      }),
    ).toMatchObject({
      evidenceSource: 'PROVIDER_SITE_MEMBERSHIP',
      visitUnitClassification: 'CHILD_REQUIRES_PARENT_VISIT',
    });
    expect(result.structuredPoiPersistence?.offeredGeoEntityIds).not.toContain(
      child.id,
    );
    expect(
      result.structuredPoiPersistence?.candidateOutcomes.find(
        (outcome) => outcome.externalId === 'osm:node:104',
      ),
    ).toMatchObject({
      admissionOutcome: 'INSUFFICIENT_ADMISSION_EVIDENCE',
      visitUnitOutcome: 'SUB_FEATURE_OF',
      geoEntityId: child.id,
    });

    const duplicateIdentity = await prisma.geoEntityIdentity.findMany({
      where: {
        externalId: { in: ['osm:node:107', 'osm:way:108', 'Q9001'] },
      },
      orderBy: { externalId: 'asc' },
    });
    expect(
      new Set(duplicateIdentity.map((identity) => identity.geoEntityId)).size,
    ).toBe(1);
    expect(
      duplicateIdentity.every((identity) => identity.linkRule !== null),
    ).toBe(true);
    expect(
      duplicateIdentity.every(
        (identity) => identity.linkPolicyVersion === 'structured-identity-v1',
      ),
    ).toBe(true);
    expect(
      duplicateIdentity.every((identity) => identity.linkEvidence !== null),
    ).toBe(true);
    expect(
      duplicateIdentity.find((identity) => identity.externalId === 'Q9001'),
    ).toMatchObject({
      linkRule: 'SHARED_ENCYCLOPEDIC_ID',
      linkEvidence: {
        mergeBasis: 'SHARED_QID',
        evidence: ['Q9001'],
      },
    });
    const structuralIdentity = await prisma.geoEntityIdentity.findMany({
      where: {
        externalId: { in: ['osm:relation:109', 'osm:node:110'] },
      },
    });
    expect(
      new Set(structuralIdentity.map((item) => item.geoEntityId)).size,
    ).toBe(1);
    expect(
      structuralIdentity.find((item) => item.externalId === 'osm:node:110'),
    ).toMatchObject({
      linkRule: 'PROVIDER_STRUCTURAL_RELATION',
      linkEvidence: {
        mergeBasis: 'STRUCTURAL_RELATIONSHIP',
        evidence: ['osm:relation:109'],
      },
    });

    const withDuration = await prisma.geoEntity.findFirstOrThrow({
      where: { name: 'Art museum with evidence duration' },
    });
    expect(
      await prisma.geoEntityVisitDuration.findUniqueOrThrow({
        where: { geoEntityId: withDuration.id },
      }),
    ).toMatchObject({
      status: 'RESOLVED',
      typicalMinutes: 75,
      authorityClass: 'STRUCTURED_PROVIDER',
      evidence: expect.objectContaining({
        provider: 'openstreetmap',
        facts: [
          expect.objectContaining({
            externalId: 'osm:node:105',
            field: 'visit_duration_minutes',
            rawValue: '75',
            typicalMinutes: 75,
          }),
        ],
      }),
    });
    const withoutDuration = await prisma.geoEntity.findFirstOrThrow({
      where: { name: 'Art museum without duration' },
    });
    expect(
      await prisma.geoEntityVisitDuration.findUnique({
        where: { geoEntityId: withoutDuration.id },
      }),
    ).toBeNull();

    // This route has no web, LLM, or content-fetch strategy in the plan.
    expect(result.webResults).toBeUndefined();
    expect(result.observations).toEqual([]);
    expect(synthesizer.synthesizeProposals).not.toHaveBeenCalled();
    expect(groundedSearch.search).not.toHaveBeenCalled();
    expect(discoveryExtractor.extract).not.toHaveBeenCalled();
    expect(webContent.fetch).not.toHaveBeenCalled();
  });

  it('keeps provider outages as FAILED rather than successful empty discovery', async () => {
    const { prisma, result } = await runProductionPlan([], 'failed');
    expect(result.providerResults.structured_poi).toMatchObject({
      status: 'failed',
      failureReason: 'Overpass offline',
      provenance: { sourceClass: 'STRUCTURED_POI', status: 'FAILED' },
    });
    expect(result.structuredPoiPersistence).toBeUndefined();
    expect(await prisma.geoEntity.count()).toBe(0);
  });
});
