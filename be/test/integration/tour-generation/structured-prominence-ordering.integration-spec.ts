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

describe('tour-generation integration · catalog Experiences ordered by persisted prominence', () => {
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
              hasCoordinateLocation: true,
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
    // prominence-v2: encyclopedic notability before a national designation
    // without articles; the designation still precedes no evidence at all.
    expect(utility.order.map(nameOf)).toEqual([
      'Fixture museum 2',
      'Fixture museum 3',
      'Fixture museum 1',
    ]);
    const [sitelinkId, heritageId, unknownId] = utility.order;
    expect(utility.byId.get(heritageId)!.orderDecision).toMatchObject({
      after: sitelinkId,
      decidedBy: 'PROMINENCE',
      prominenceLevel: 'ENCYCLOPEDIC_SITELINKS',
    });
    expect(utility.byId.get(unknownId)!.orderDecision).toMatchObject({
      after: heritageId,
      decidedBy: 'PROMINENCE',
      prominenceLevel: 'HERITAGE_SCOPE',
    });
    expect(
      utility.byId.get(heritageId)!.prominence.heritageDesignation,
    ).toMatchObject({ status: 'KNOWN', strongestScope: 'NATIONAL' });
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

  it('reorders admitted structured Experiences when the requested interests change, for typed reasons', async () => {
    const prisma = await getPrisma();
    const features = [
      {
        osmId: 11,
        tags: { tourism: 'museum', historic: 'building', heritage: '2' },
      },
      { osmId: 12, tags: { amenity: 'cafe', tourism: 'attraction' } },
    ];
    const osm = {
      lookupFeaturesNear: jest.fn().mockResolvedValue({
        status: 'success',
        rawResultCount: features.length,
        value: features.map((feature) => ({
          id: `osm:node:${feature.osmId}`,
          name: `Fixture place ${feature.osmId}`,
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
    const catalog = new ExperienceCatalogService(prisma, {} as any);
    const discovered = await new StructuredPoiAcquisitionProvider(osm).acquire(
      destination,
      { radiusMeters: 5_000 },
    );
    await new StructuredPoiCatalogAcquisitionService(
      prisma,
      catalog,
      new StructuredKnowledgePersistenceService(prisma),
    ).persist(discovered.value);
    const experiences = await catalog.findVerifiedByIds(
      await catalog.composeAdmittedPlacesWithinScope(destination),
    );
    const nameOf = (id: string) =>
      (experiences as any[]).find((experience) => experience.id === id)
        .canonicalName;
    const facet = (key: string) => ({
      dimension: 'theme',
      key,
      provenance: 'DIRECT' as const,
      importance: 1,
      confidence: 1,
      evidence: [] as never[],
      required: false,
    });
    const orderFor = async (key: string) =>
      new PreferenceUtilityService({} as any).derive({
        experiences: experiences as any,
        preferenceSpec: {
          facets: [facet(key)] as any,
          assertions: [],
          semanticQuery: '',
        },
        softAnchorIds: [],
      });

    const history = await orderFor('history');
    const gastronomy = await orderFor('gastronomy');

    expect(history.order.map(nameOf)).toEqual([
      'Fixture place 11',
      'Fixture place 12',
    ]);
    expect(gastronomy.order.map(nameOf)).toEqual([
      'Fixture place 12',
      'Fixture place 11',
    ]);
    expect(
      gastronomy.byId.get(gastronomy.order[1])!.orderDecision,
    ).toMatchObject({
      decidedBy: 'DIRECT_EVIDENCE',
    });
    expect(gastronomy.byId.get(gastronomy.order[0])!.matchedFacets).toEqual([
      'theme:gastronomy',
    ]);
    // Relevance comes from persisted typed observations, not from a quality score.
    expect(
      (experiences as any[]).every(
        (experience) => experience.qualityScore === null,
      ),
    ).toBe(true);
    const observations = await prisma.geoEntityTargetObservation.findMany({
      orderBy: { sourceFactId: 'asc' },
    });
    expect(observations.map((row: any) => row.sourceFactId)).toEqual([
      'osm:node:11#historic=building>theme:architecture',
      'osm:node:11#historic=building>theme:history',
      'osm:node:12#amenity=cafe>intent:food',
      'osm:node:12#amenity=cafe>theme:food',
      'osm:node:12#amenity=cafe>theme:gastronomy',
    ]);
  });
});
