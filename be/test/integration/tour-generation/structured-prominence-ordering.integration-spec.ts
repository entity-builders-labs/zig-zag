import { OsmPlacesService } from '../../../src/modules/integrations/osm/services/osm-places.service';
import { StructuredPoiAcquisitionProvider } from '../../../src/modules/tours/providers/structured-poi-acquisition.provider';
import { StructuredPoiCatalogAcquisitionService } from '../../../src/modules/tours/services/structured-poi-catalog-acquisition.service';
import { StructuredKnowledgePersistenceService } from '../../../src/modules/tours/services/structured-knowledge-persistence.service';
import { ExperienceCatalogService } from '../../../src/modules/tours/services/experience-catalog.service';
import { PreferenceUtilityService } from '../../../src/modules/tours/services/preference-utility.service';
import { closeDb, getPrisma, resetDb } from '../support/test-db';

const destination = {
  destinationName: 'Fixture City',
  latitude: -34.6,
  longitude: -58.38,
  radiusMeters: 5_000,
};

describe('tour-generation integration · structured prominence ordering (task 39.4)', () => {
  beforeEach(async () => resetDb());

  afterAll(async () => closeDb());

  it('orders catalog Experiences by persisted GeoEntity prominence without changing admission, catalog presence or Experience state', async () => {
    const prisma = await getPrisma();
    const features = [
      { osmId: 1, tags: { tourism: 'museum' } },
      { osmId: 2, tags: { tourism: 'museum', wikidata: 'Q2' } },
      { osmId: 3, tags: { tourism: 'museum', heritage: '2' } },
    ];
    const osm = {
      lookupFeaturesNear: jest.fn().mockResolvedValue({
        status: 'success',
        rawResultCount: features.length,
        value: features.map((feature) => ({
          id: `osm:node:${feature.osmId}`,
          name: `Fixture museum ${feature.osmId}`,
          osmType: 'node',
          osmId: feature.osmId,
          geometry: {
            type: 'Point',
            coordinates: [-58.38 + feature.osmId / 10_000, -34.6],
          },
          tags: feature.tags,
        })),
      }),
    } as unknown as OsmPlacesService;
    const wikidata = {
      lookupStructuredEntityFacts: jest.fn().mockResolvedValue({
        facts: new Map([
          [
            'Q2',
            {
              qid: 'Q2',
              instanceOf: [],
              heritageDesignations: [],
              sitelinks: ['es', 'en', 'de'].map((language) => ({
                site: `${language}wiki`,
                url: `https://${language}.wikipedia.org/wiki/Fixture`,
              })),
            },
          ],
        ]),
        missingQids: new Set(),
        failedQids: new Set(),
        observedAt: new Date('2026-10-23T10:00:00Z'),
      }),
    };
    const catalog = new ExperienceCatalogService(prisma, {} as any);
    const discovered = await new StructuredPoiAcquisitionProvider(
      osm,
      wikidata as any,
    ).acquire(destination, {
      radiusMeters: 5_000,
      entityFacts: { sourceClass: 'STRUCTURED_ENTITY_FACTS' },
    });
    await new StructuredPoiCatalogAcquisitionService(
      prisma,
      catalog,
      new StructuredKnowledgePersistenceService(prisma),
    ).persist(discovered.value);
    const composedIds =
      await catalog.composeAdmittedPlacesWithinScope(destination);
    const experiences = await catalog.findVerifiedByIds(composedIds);
    const stateBefore = JSON.stringify({
      admission: await prisma.geoEntityAdmission.findMany({
        orderBy: { geoEntityId: 'asc' },
      }),
      experiences: await prisma.experience.findMany({ orderBy: { id: 'asc' } }),
    });

    const utility = await new PreferenceUtilityService({} as any).derive({
      experiences: experiences as any,
      preferenceSpec: { facets: [], assertions: [], semanticQuery: '' },
      softAnchorIds: [],
    });

    const nameOf = (id: string) =>
      (experiences as any[]).find((experience) => experience.id === id)
        .canonicalName;
    expect(utility.order.map(nameOf)).toEqual([
      'Fixture museum 3',
      'Fixture museum 2',
      'Fixture museum 1',
    ]);
    const [heritageId, sitelinkId, unknownId] = utility.order;
    expect(utility.byId.get(sitelinkId)!.orderDecision).toMatchObject({
      after: heritageId,
      decidedBy: 'PROMINENCE',
      prominenceLevel: 'HERITAGE_DESIGNATION',
    });
    expect(utility.byId.get(unknownId)!.orderDecision).toMatchObject({
      after: sitelinkId,
      decidedBy: 'PROMINENCE',
      prominenceLevel: 'ENCYCLOPEDIC_SITELINKS',
    });
    expect(
      utility.byId.get(sitelinkId)!.prominence.encyclopedicSitelinks,
    ).toEqual({
      status: 'KNOWN',
      count: 3,
      refs: [
        {
          kind: 'ENCYCLOPEDIC_SITELINK_COUNT',
          source: 'wikidata:Q2',
          field: 'sitelinks',
          value: 3,
        },
      ],
    });
    // The lowest-ranked candidate stays admitted, composed and available.
    expect(
      utility.byId.get(unknownId)!.prominence.encyclopedicSitelinks,
    ).toEqual({
      status: 'UNKNOWN',
    });
    expect(
      JSON.stringify({
        admission: await prisma.geoEntityAdmission.findMany({
          orderBy: { geoEntityId: 'asc' },
        }),
        experiences: await prisma.experience.findMany({
          orderBy: { id: 'asc' },
        }),
      }),
    ).toBe(stateBefore);
    expect(await prisma.experience.count()).toBe(3);
  });
});
