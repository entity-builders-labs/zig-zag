import { geographicScopeSearchWindow } from 'src/modules/tours/utils/experience-geographic-scope.policy';
import { withDefaultGeographicAuthorization } from 'src/modules/tours/utils/geographic-validation-authorization.util';
import { GeoEntityKind, Prisma } from '@prisma/client';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Stage 3 verified hint memory against real Postgres: the exact hint text
 * of a VERIFIED resolution is remembered on the canonical GeoEntity row
 * (`verifiedHintNames` / `verifiedHintNameKeys` text[] + GIN index), so a
 * later request with the same text reuses that GeoEntity catalog-first
 * even when it differs from the canonical name. Array persistence, the
 * atomic/idempotent concurrent append, the alignment CHECK, multiplicity
 * and GIN usage all depend on Postgres itself -- nothing here is mocked
 * except the external identity providers in the resolver round-trip.
 */
describe('tour-generation integration · verified hint memory', () => {
  let catalog: ExperienceCatalogService;

  const FARMACIA = {
    name: 'Farmacia de la Estrella',
    kind: GeoEntityKind.PLACE,
    latitude: -34.6102605,
    longitude: -58.3721513,
  };
  const SCOPE: GeographicScope = {
    kind: 'POINT_RADIUS',
    latitude: -34.61,
    longitude: -58.372,
    radiusMeters: 5_000,
  };

  const createPlace = async (
    name: string,
    externalId: string,
    at: { latitude: number; longitude: number } = FARMACIA,
    kind: GeoEntityKind = GeoEntityKind.PLACE,
  ) => {
    const result = await catalog.upsertGeoEntityWithIdentities({
      name,
      kind,
      latitude: at.latitude,
      longitude: at.longitude,
      identities: [{ provider: 'openstreetmap', externalId }],
    });
    if (result.status === 'IDENTITY_CONFLICT') throw new Error('conflict');
    return result.geoEntity.id;
  };
  const memoryOf = async (id: string) =>
    (await getPrisma()).geoEntity.findUniqueOrThrow({
      where: { id },
      select: { verifiedHintNames: true, verifiedHintNameKeys: true },
    });

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

  it('a new GeoEntity starts with empty verified hint memory; remembering persists the verbatim text and its key', async () => {
    const id = await createPlace(FARMACIA.name, 'osm:node:3348573778');
    expect(await memoryOf(id)).toEqual({
      verifiedHintNames: [],
      verifiedHintNameKeys: [],
    });

    expect(
      await catalog.rememberVerifiedHintName(id, 'Farmacia la Estrella'),
    ).toBe('REMEMBERED');

    expect(await memoryOf(id)).toEqual({
      verifiedHintNames: ['Farmacia la Estrella'],
      verifiedHintNameKeys: ['farmacia la estrella'],
    });
    // The canonical name is untouched.
    const prisma = await getPrisma();
    expect(
      (await prisma.geoEntity.findUniqueOrThrow({ where: { id } })).name,
    ).toBe('Farmacia de la Estrella');
  });

  it('is idempotent by key: the same hint twice (or a differently cased/accented spelling) stays one logical entry', async () => {
    const id = await createPlace(FARMACIA.name, 'osm:node:3348573778');

    await catalog.rememberVerifiedHintName(id, 'Farmacia la Estrella');
    expect(
      await catalog.rememberVerifiedHintName(id, 'Farmacia la Estrella'),
    ).toBe('ALREADY_REMEMBERED');
    expect(
      await catalog.rememberVerifiedHintName(id, 'FARMACIA LA ESTRELLA'),
    ).toBe('ALREADY_REMEMBERED');

    expect(await memoryOf(id)).toEqual({
      verifiedHintNames: ['Farmacia la Estrella'],
      verifiedHintNameKeys: ['farmacia la estrella'],
    });
  });

  it('one GeoEntity can remember several independently verified hints', async () => {
    const id = await createPlace(
      'Cementerio de la Recoleta',
      'osm:way:183842128',
      { latitude: -34.5877, longitude: -58.3936 },
    );

    await catalog.rememberVerifiedHintName(id, 'Recoleta Cemetery');
    await catalog.rememberVerifiedHintName(id, 'Cementerio de Recoleta');

    expect(await memoryOf(id)).toEqual({
      verifiedHintNames: ['Recoleta Cemetery', 'Cementerio de Recoleta'],
      verifiedHintNameKeys: ['recoleta cemetery', 'cementerio de recoleta'],
    });
  });

  it('concurrent verified resolutions of the SAME hint store it exactly once (no duplicate, no lost update)', async () => {
    const id = await createPlace(FARMACIA.name, 'osm:node:3348573778');

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        catalog.rememberVerifiedHintName(id, 'Farmacia la Estrella'),
      ),
    );

    expect(outcomes.filter((o) => o === 'REMEMBERED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ALREADY_REMEMBERED')).toHaveLength(11);
    expect(await memoryOf(id)).toEqual({
      verifiedHintNames: ['Farmacia la Estrella'],
      verifiedHintNameKeys: ['farmacia la estrella'],
    });
  });

  it('concurrent verified resolutions of DIFFERENT hints on one GeoEntity lose no update and stay aligned', async () => {
    const id = await createPlace(FARMACIA.name, 'osm:node:3348573778');
    const hints = Array.from({ length: 12 }, (_, i) => `Farmacia hint ${i}`);

    await Promise.all(
      hints.map((hint) => catalog.rememberVerifiedHintName(id, hint)),
    );

    const memory = await memoryOf(id);
    expect([...memory.verifiedHintNames].sort()).toEqual([...hints].sort());
    expect(memory.verifiedHintNameKeys).toEqual(
      memory.verifiedHintNames.map((name) => name.toLowerCase()),
    );
  });

  it('the database rejects misaligned arrays (CHECK geo_entity_verified_hint_names_aligned)', async () => {
    const prisma = await getPrisma();
    const id = await createPlace(FARMACIA.name, 'osm:node:3348573778');

    await expect(
      prisma.$executeRaw`UPDATE "geo_entity" SET "verifiedHintNames" = ARRAY['orphan']::text[] WHERE "id" = ${id}`,
    ).rejects.toThrow(/geo_entity_verified_hint_names_aligned/);
  });

  it('the same remembered key on two GeoEntities is allowed, and an in-scope lookup returns BOTH (no first-wins)', async () => {
    const a = await createPlace('Parroquia San José', 'osm:node:1', {
      latitude: -34.611,
      longitude: -58.373,
    });
    const b = await createPlace('Colegio San José', 'osm:node:2', {
      latitude: -34.609,
      longitude: -58.371,
    });
    // Same key on a different kind and outside the scope: never candidates.
    const route = await createPlace(
      'Calle San José',
      'osm:way:3',
      { latitude: -34.61, longitude: -58.372 },
      GeoEntityKind.ROUTE,
    );
    const far = await createPlace('San José (Mendoza)', 'osm:node:4', {
      latitude: -32.9,
      longitude: -68.8,
    });
    for (const id of [a, b, route, far]) {
      await catalog.rememberVerifiedHintName(id, 'San José');
    }

    const { candidates } = await catalog.findGeoEntityCandidatesForHint({
      hintName: 'San José',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(SCOPE, 'DESTINATION_AREA')!,
    });

    expect(candidates.map((c) => c.geoEntityId).sort()).toEqual([a, b].sort());
    expect(candidates.every((c) => c.matchKind === 'VERIFIED_HINT')).toBe(true);
  });

  it('canonical-name lookup still works and wins over the remembered key for the same row', async () => {
    const id = await createPlace('Casa Mínima', 'osm:node:4440588689', {
      latitude: -34.6168,
      longitude: -58.3713,
    });
    await catalog.rememberVerifiedHintName(id, 'Casa Mínima');

    const { candidates } = await catalog.findGeoEntityCandidatesForHint({
      hintName: 'Casa Minima',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(SCOPE, 'DESTINATION_AREA')!,
    });

    expect(candidates).toEqual([
      expect.objectContaining({ geoEntityId: id, matchKind: 'CANONICAL_NAME' }),
    ]);
  });

  it('the verified-hint lookup is served by the GIN index (EXPLAIN of the exact production query shape)', async () => {
    const prisma = await getPrisma();
    // A dense catalog inside the scope, so the planner has a real choice.
    const rows = Array.from({ length: 5_000 }, (_, i) => ({
      name: `Filler place ${i}`,
      kind: GeoEntityKind.PLACE,
      latitude: -34.61 + ((i % 100) - 50) * 0.0002,
      longitude: -58.372 + (Math.floor(i / 100) - 25) * 0.0002,
      verifiedHintNames: [`Filler hint ${i}`],
      verifiedHintNameKeys: [`filler hint ${i}`],
    }));
    await prisma.geoEntity.createMany({ data: rows });
    const id = await createPlace(FARMACIA.name, 'osm:node:3348573778');
    await catalog.rememberVerifiedHintName(id, 'Farmacia la Estrella');
    await prisma.$executeRaw`ANALYZE "geo_entity"`;

    const plan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
      Prisma.sql`EXPLAIN
        SELECT "id" FROM "geo_entity"
        WHERE "verifiedHintNameKeys" @> ARRAY[${'farmacia la estrella'}]::text[]
          AND "kind" = ${GeoEntityKind.PLACE}::"GeoEntityKind"
          AND "latitude" BETWEEN ${-34.66} AND ${-34.56}
          AND "longitude" BETWEEN ${-58.43} AND ${-58.31}
        ORDER BY "id"`,
    );
    const text = plan.map((line) => line['QUERY PLAN']).join('\n');
    console.info(`verified-hint lookup plan:\n${text}`);
    expect(text).toContain('geo_entity_verifiedHintNameKeys_idx');
    expect(text).not.toMatch(/Seq Scan on geo_entity/);

    const { candidates } = await catalog.findGeoEntityCandidatesForHint({
      hintName: 'Farmacia la Estrella',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(SCOPE, 'DESTINATION_AREA')!,
    });
    expect(candidates.map((c) => [c.geoEntityId, c.matchKind])).toEqual([
      [id, 'VERIFIED_HINT'],
    ]);
  });

  describe('resolver round-trip: COLD remembers, WARM reuses with no provider acquisition', () => {
    const DESTINATION: GeographicScope = {
      kind: 'AREA_BOUNDARY',
      boundary: {
        id: 'osm:relation:1224652',
        name: 'Buenos Aires',
        osmType: 'relation',
        osmId: 1224652,
        tags: { boundary: 'administrative', admin_level: '8' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-58.53, -34.71],
              [-58.36, -34.71],
              [-58.36, -34.53],
              [-58.53, -34.53],
              [-58.53, -34.71],
            ],
          ],
        },
      },
    };

    function providers() {
      return {
        osmPlaces: {
          lookupPoisWithin: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupPoisNear: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupBoundaryById: jest.fn(),
          lookupHighwaysByName: jest.fn(),
        },
        nominatim: {
          search: jest.fn().mockResolvedValue([
            {
              osmType: 'node',
              osmId: 3348573778,
              class: 'amenity',
              type: 'pharmacy',
              addresstype: 'amenity',
              displayName:
                'Farmacia de la Estrella, 201, Defensa, Monserrat, Buenos Aires, Argentina',
              importance: 0.1,
              latitude: -34.6101871,
              longitude: -58.3721455,
              address: { city: 'Buenos Aires', country: 'Argentina' },
            },
          ]),
        },
        placesApi: {
          provider: 'geoapify' as const,
          declaresSourceIdentitiesInDetails: true,
          getStatus: jest.fn(),
          searchNearby: jest.fn(),
          searchText: jest.fn().mockResolvedValue({
            data: [
              {
                id: 'geo-farmacia-search',
                name: 'Farmacia de la Estrella',
                displayName: { text: 'Farmacia de la Estrella' },
                location: { latitude: -34.6102605, longitude: -58.3721513 },
                types: [],
                featureClass: 'point_of_interest',
              },
            ],
            provenance: {
              provider: 'geoapify',
              cacheStatus: 'miss-live',
              requestedCount: 10,
              receivedCount: 1,
            },
          }),
          getPlaceDetails: jest.fn().mockResolvedValue({
            data: {
              id: 'geo-farmacia-details',
              // The pharmacy's own Wikidata item declares the hint spelling
              // as an alias (OWN_QID): the structural path that verifies the
              // non-exact hint. Nominatim and Geoapify reaching the same OSM
              // node is one upstream record, not corroboration.
              sourceIdentities: [
                {
                  provider: 'openstreetmap',
                  externalId: 'osm:node:3348573778',
                },
                { provider: 'wikidata', externalId: 'Q-farmacia' },
              ],
            },
            provenance: {
              provider: 'geoapify',
              cacheStatus: 'miss-live',
              requestedCount: 1,
              receivedCount: 1,
            },
          }),
        },
        wikidata: {
          getEntitySummaries: jest.fn().mockResolvedValue(
            new Map([
              [
                'Q-farmacia',
                {
                  qid: 'Q-farmacia',
                  label: 'Farmacia de la Estrella',
                  aliases: ['Farmacia la Estrella'],
                },
              ],
            ]),
          ),
          findNearbyPlaces: jest.fn().mockResolvedValue([]),
        },
      };
    }

    const resolveFarmacia = (p: ReturnType<typeof providers>) => {
      const service = new ExperienceProposalResolverService(
        p.osmPlaces as any,
        catalog,
        { validate: jest.fn().mockReturnValue({ accepted: true }) } as any,
        undefined,
        p.nominatim as any,
        p.placesApi as any,
        p.wikidata as any,
      );
      return service.resolve({
        destinationName: 'Buenos Aires, Argentina',
        destinationCountryCode: 'AR',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          {
            name: 'Farmacia la Estrella visit',
            themes: ['history'],
            traits: [],
            intents: ['visit'],
            componentHints: [
              {
                key: 'hint',
                name: 'Farmacia la Estrella',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'source-backed place',
          },
        ]),
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            title: 'Buenos Aires highlights',
            snippet: 'Farmacia la Estrella in Buenos Aires',
          },
        ],
      } as any);
    };
    const audit = (result: any) =>
      result.entityResolution.forensicAudit[0].componentAudits[0];

    it('Farmacia la Estrella -> Farmacia de la Estrella', async () => {
      const prisma = await getPrisma();

      const cold = providers();
      const coldResult = await resolveFarmacia(cold);
      const coldAudit = audit(coldResult);
      expect(coldAudit.finalStatus).toBe('resolved');
      expect(coldAudit.verifiedHintMemory).toBe('REMEMBERED');
      const geoEntityId = coldAudit.resolvedGeoEntity.geoEntityId;
      expect(await memoryOf(geoEntityId)).toEqual({
        verifiedHintNames: ['Farmacia la Estrella'],
        verifiedHintNameKeys: ['farmacia la estrella'],
      });
      const before = {
        geoEntities: await prisma.geoEntity.count(),
        identities: await prisma.geoEntityIdentity.count(),
      };

      const warm = providers();
      const warmResult = await resolveFarmacia(warm);
      const warmAudit = audit(warmResult);

      expect(warmAudit.attempts.map((a: any) => a.strategy)).toEqual([
        'CATALOG_REUSE',
      ]);
      expect(warmAudit.attempts[0].identityEvidence).toEqual([
        {
          type: 'CATALOG_VERIFIED_HINT_MATCH',
          verifiedHintKey: 'farmacia la estrella',
          identityMultiplicity: 'SINGLE',
        },
      ]);
      expect(warmAudit.resolvedGeoEntity).toMatchObject({
        geoEntityId,
        canonicalName: 'Farmacia de la Estrella',
      });
      for (const fn of [
        warm.placesApi.searchText,
        warm.placesApi.getPlaceDetails,
        warm.nominatim.search,
        warm.wikidata.getEntitySummaries,
        warm.wikidata.findNearbyPlaces,
        warm.osmPlaces.lookupPoisWithin,
        warm.osmPlaces.lookupPoisNear,
      ]) {
        expect(fn).not.toHaveBeenCalled();
      }
      expect({
        geoEntities: await prisma.geoEntity.count(),
        identities: await prisma.geoEntityIdentity.count(),
      }).toEqual(before);
      expect(await memoryOf(geoEntityId)).toEqual({
        verifiedHintNames: ['Farmacia la Estrella'],
        verifiedHintNameKeys: ['farmacia la estrella'],
      });
    });
  });
});
