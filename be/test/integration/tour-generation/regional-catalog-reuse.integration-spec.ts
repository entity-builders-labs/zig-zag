import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { AreaRouteAnchorResolverService } from 'src/modules/tours/services/area-route-anchor-resolver.service';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { ownedAuthorization } from 'src/modules/tours/fixtures/geographic-authorization.fixture';
import { geographicScopeSearchWindow } from 'src/modules/tours/utils/experience-geographic-scope.policy';
import { isTourEligibleForDestinationRequest } from 'src/modules/tours/utils/tour-destination-eligibility.policy';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Spec 2026-10-02 Part II, RW4 cases G/H/K — regional catalog reuse through
 * REAL canonical persisted state (real Postgres, real resolver, real
 * composite validation, real catalog, real anchor resolver; only the
 * Nominatim/OSM transports are deterministic fakes). Synthetic geography
 * (no Mendoza/Uco strings): "Fixture Valley" lies ~120 km beyond the trip
 * destination "Fixture City".
 *
 *  COLD: a ROUTE_LIKE candidate with a source-backed AREA hint persists ONE
 *        verified regional Experience under its canonical AREA scope.
 *  WARM: a later request whose authoritative scope is the user-named
 *        regional AREA resolves to the SAME canonical AREA GeoEntity and
 *        retrieves the SAME Experience from the catalog — no reacquisition,
 *        no new Experience row. Nothing is patched by hand.
 *  H:    the destination-window retrieval does not make that Experience
 *        tour-eligible for a destination-only request.
 */
describe('tour-generation integration · regional catalog reuse (Part II G/H)', () => {
  const square = (lon: number, lat: number, d: number) => ({
    type: 'Polygon' as const,
    coordinates: [
      [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ] as [number, number][],
    ],
  });
  const FIXTURE_CITY: GeographicScope = {
    kind: 'AREA_BOUNDARY',
    boundary: {
      id: 'osm:relation:100',
      name: 'Fixture City',
      osmType: 'relation',
      osmId: 100,
      tags: { boundary: 'administrative', admin_level: '8' },
      geometry: square(10, 45, 0.05),
    },
  };
  const VALLEY_BOUNDARY = {
    id: 'osm:relation:900',
    name: 'Fixture Valley',
    osmType: 'relation' as const,
    osmId: 900,
    tags: { boundary: 'administrative', admin_level: '8' },
    geometry: square(10, 43.92, 0.25),
  };
  const nominatimResults: Record<string, any[]> = {
    'Fixture Valley': [
      {
        osmType: 'relation',
        osmId: 900,
        addresstype: 'town',
        placeRank: 16,
        class: 'boundary',
        type: 'administrative',
        displayName: 'Fixture Valley, Fixtureland',
        importance: 0.4,
        latitude: 43.92,
        longitude: 10,
      },
    ],
    'Estate One': [
      {
        osmType: 'node',
        osmId: 901,
        addresstype: 'tourism',
        placeRank: 30,
        class: 'tourism',
        type: 'attraction',
        displayName: 'Estate One, Fixture Valley, Fixtureland',
        importance: 0.2,
        latitude: 43.85,
        longitude: 9.9,
        address: { country: 'Fixtureland' },
      },
    ],
    'Estate Two': [
      {
        osmType: 'node',
        osmId: 902,
        addresstype: 'tourism',
        placeRank: 30,
        class: 'tourism',
        type: 'attraction',
        displayName: 'Estate Two, Fixture Valley, Fixtureland',
        importance: 0.2,
        latitude: 43.95,
        longitude: 10.05,
        address: { country: 'Fixtureland' },
      },
    ],
  };

  let catalog: ExperienceCatalogService;
  let nominatim: { search: jest.Mock; reverse: jest.Mock };
  let osmPlaces: Record<string, jest.Mock>;

  const resolveCold = () =>
    new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog,
      new CompositeGeographicValidationService(),
      undefined,
      nominatim as any,
    ).resolve({
      destinationName: 'Fixture City',
      destinationCountryCode: 'FX',
      geographicScope: FIXTURE_CITY,
      candidates: [
        {
          candidate: {
            name: 'Fixture Valley estates itinerary',
            themes: ['wine'],
            traits: [],
            intents: ['route_like'],
            componentHints: [
              {
                key: 'valley',
                name: 'Fixture Valley',
                role: 'area',
                expectedKind: 'AREA',
                evidenceKeys: ['ev-1'],
              },
              {
                key: 'one',
                name: 'Estate One',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
              {
                key: 'two',
                name: 'Estate Two',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'source-backed regional itinerary',
          },
          geographicAuthorization: ownedAuthorization('route_like'),
        },
      ],
      evidence: [
        {
          key: 'ev-1',
          source: 'web',
          url: 'https://example.test/fixture-valley',
          title: 'Fixture City wine guide',
          snippet:
            'From Fixture City, spend a day in Fixture Valley: Estate One, then Estate Two.',
        },
      ],
    });

  beforeAll(async () => {
    const prisma = await getPrisma();
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
    nominatim = {
      search: jest.fn(async (query: string) => nominatimResults[query] ?? []),
      reverse: jest.fn(),
    };
    osmPlaces = {
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisNear: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: VALLEY_BOUNDARY }),
      lookupHighwaysByName: jest.fn().mockResolvedValue({
        status: 'success',
        value: { rawCount: 0, segments: [], rejected: [] },
      }),
    };
  });

  afterAll(async () => {
    await closeDb();
  });

  it('COLD persists the verified regional Experience; WARM retrieves the SAME canonical Experience through the regional AREA scope without reacquisition', async () => {
    const prisma = await getPrisma();

    // --- COLD -------------------------------------------------------------
    const cold = await resolveCold();
    const accepted = cold.resolved[0];
    expect(accepted.status).toBe('accepted');
    expect(accepted.experienceId).toEqual(expect.any(String));
    const validation = cold.geographicValidation.results[0];
    expect(validation.experienceScope).toEqual(
      expect.objectContaining({
        provenance: 'CANDIDATE_AREA',
        destinationRelation: 'OUTSIDE',
      }),
    );
    expect(validation.destinationRelation?.relation).toBe(
      'OUTSIDE_DESTINATION',
    );
    const experienceId = accepted.experienceId!;
    const persisted = await prisma.experience.findUniqueOrThrow({
      where: { id: experienceId },
      include: { components: { include: { geoEntity: true } } },
    });
    expect(persisted.status).toBe('VERIFIED');
    // The canonical scope is persisted through the EXISTING relationship:
    // the area-role component pointing at the canonical AREA GeoEntity.
    const areaComponent = persisted.components.find(
      (component) => component.role === 'area',
    )!;
    expect(areaComponent.geoEntity.kind).toBe('AREA');
    expect(areaComponent.geoEntity.geometry).toEqual(VALLEY_BOUNDARY.geometry);
    expect(persisted.components).toHaveLength(3);

    // --- WARM -------------------------------------------------------------
    // A later request names the region as its geographic scope. The real
    // anchor resolver resolves it to the SAME canonical AREA GeoEntity
    // (identity correlation on the real OSM relation), never a new one.
    nominatim.search.mockClear();
    const [anchor] = await new AreaRouteAnchorResolverService(
      osmPlaces as any,
      catalog,
      nominatim as any,
    ).resolveNamedAnchors(
      [
        {
          rawName: 'Fixture Valley',
          usage: 'geographic_scope',
          priority: 'must',
        },
      ],
      { destinationCountryCode: 'FX', geographicScope: FIXTURE_CITY },
    );
    expect(anchor).toMatchObject({ status: 'resolved', kind: 'area' });
    expect(anchor.status === 'resolved' && anchor.geoEntityId).toBe(
      areaComponent.geoEntityId,
    );

    // Catalog retrieval through the regional scope (the same canonical
    // area-membership policy cold validation used) finds the SAME row.
    const warm = await catalog.findVerifiedMultiComponentInArea(
      areaComponent.geoEntityId,
      'AREA_ANCHORED_ROUTE',
    );
    expect(warm.map((row) => row.id)).toEqual([experienceId]);
    // No reacquisition of the Experience's components happened for the
    // retrieval itself, and no redundant Experience row exists.
    expect(nominatim.search.mock.calls.map(([query]) => query)).not.toContain(
      'Estate One',
    );
    expect(await prisma.experience.count()).toBe(1);

    // A repeated COLD materialization of the same source composition
    // reconciles to the same canonical Experience (dedupe SAME).
    const again = await resolveCold();
    expect(again.resolved[0].experienceId).toBe(experienceId);
    expect(await prisma.experience.count()).toBe(1);
  });

  it('H: the destination-window retrieval may return nothing of the regional Experience, and even when a row is retrieved it is not tour-eligible unless WITHIN the destination', async () => {
    const cold = await resolveCold();
    const experienceId = cold.resolved[0].experienceId!;
    const window = geographicScopeSearchWindow(
      FIXTURE_CITY,
      'DESTINATION_AREA',
    )!;

    const destinationPool = await catalog.findVerifiedWithinForMatching(
      window.center.latitude,
      window.center.longitude,
      window.radiusMeters,
    );
    expect(destinationPool.map((row) => row.id)).not.toContain(experienceId);

    // Retrieved explicitly (e.g. through the regional scope), the same
    // canonical row is still NOT eligible for a destination-only tour.
    const [row] = await catalog.findVerifiedByIds([experienceId]);
    expect(row.id).toBe(experienceId);
    expect(isTourEligibleForDestinationRequest(row, FIXTURE_CITY)).toBe(false);
  });
});
