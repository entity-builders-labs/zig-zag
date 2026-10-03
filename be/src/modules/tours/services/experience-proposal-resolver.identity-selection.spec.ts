import * as fs from 'fs';
import * as path from 'path';
import { NominatimResult } from '@integrations/osm/interfaces/nominatim.interface';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { GeoEntityHint } from '../interfaces/experience-discovery.interface';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { ownedAuthorization } from '../fixtures/geographic-authorization.fixture';
import { withDefaultGeographicAuthorization } from '../utils/geographic-validation-authorization.util';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

/**
 * RW4 candidate selection before identity verification.
 *
 * The Ojo de Agua pools are the REAL local-Nominatim responses captured for
 * the RW4 replay (`../fixtures/rw4-ojo-de-agua-nominatim-pool.json`):
 * `DEFAULT` is the pre-fix five-result window (five hamlets or dwellings in
 * other provinces), and `PROVIDER_MAXIMUM` is the full 31-member same-name
 * pool, which also holds the Lujan de Cuyo restaurant
 * `osm:node:4797394430` near the bottom of the provider's importance order.
 */
const POOL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../fixtures/rw4-ojo-de-agua-nominatim-pool.json'),
    'utf8',
  ),
) as Record<'DEFAULT' | 'PROVIDER_MAXIMUM', NominatimResult[]>;
const LUJAN_RESTAURANT = 'osm:node:4797394430';
const CORDOBA_HAMLET = 'osm:node:198407364';

// Simplified Ciudad de Mendoza admin polygon. The Lujan de Cuyo record
// (-33.13, -68.96) lies OUTSIDE it, like the real one (29 km from the
// centre): a source-defined component beyond a descriptive destination.
const MENDOZA: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: {
    id: 'osm:relation:4206801',
    name: 'Ciudad de Mendoza',
    osmType: 'relation',
    osmId: 4206801,
    tags: { boundary: 'administrative', admin_level: '8' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-68.9, -32.93],
          [-68.8, -32.93],
          [-68.8, -32.85],
          [-68.9, -32.85],
          [-68.9, -32.93],
        ],
      ],
    },
  },
};

function build(options: {
  nominatimResults?: NominatimResult[];
  osmPool?: unknown[];
  nearby?: Array<{ qid: string; label: string }>;
  wikidataLabels?: Record<string, { label: string; aliases?: string[] }>;
  /** Boundary the (faked) locality grounder returns for any assertion. */
  localityBoundary?: GeoJsonGeometry;
  placesFailure?: Error;
  /** The Nominatim search itself fails (timeout, provider outage). */
  nominatimFailure?: Error;
  catalogCandidates?: unknown[];
  overtureCandidates?: unknown[];
  /** A Geoapify result whose Place Details declares this OSM identity. */
  placesDeclaringOsm?: {
    name: string;
    latitude: number;
    longitude: number;
    osmId: string;
    /** A second same-name Places result (a collision inside the circle). */
    secondSameName?: { latitude: number; longitude: number };
  };
}) {
  const osmPlaces = {
    lookupPoisWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: options.osmPool ?? [] }),
    lookupPoisNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupBoundaryById: jest.fn(),
    lookupHighwaysByName: jest.fn(),
  };
  const catalog = {
    findGeoEntityCandidatesForHint: jest
      .fn()
      .mockResolvedValue({ candidates: options.catalogCandidates ?? [] }),
    rememberVerifiedHintName: jest.fn().mockResolvedValue('REMEMBERED'),
    findGeoEntityIdsByIdentities: jest.fn().mockResolvedValue([]),
    upsertGeoEntityWithIdentities: jest.fn().mockResolvedValue({
      status: 'CREATED',
      geoEntity: { id: 'geo-1' },
      attachedExternalIds: [],
    }),
    upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    persistVerifiedExperience: jest
      .fn()
      .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
  };
  const nominatim = {
    search: options.nominatimFailure
      ? jest.fn().mockRejectedValue(options.nominatimFailure)
      : jest.fn().mockResolvedValue(options.nominatimResults ?? []),
  };
  const wikidata = {
    getEntitySummaries: jest.fn(async (qids: string[]) => {
      const map = new Map();
      for (const qid of qids) {
        const summary = options.wikidataLabels?.[qid];
        if (summary) map.set(qid, { qid, ...summary });
      }
      return map;
    }),
    findNearbyPlaces: jest.fn().mockResolvedValue(options.nearby ?? []),
  };
  const localityGrounder = {
    groundLocality: jest.fn(async (assertion: any) =>
      options.localityBoundary
        ? {
            status: 'GROUNDED' as const,
            assertion,
            boundary: {
              provider: 'openstreetmap' as const,
              externalId: 'osm:relation:lujan',
              name: 'Departamento Luján de Cuyo',
              geometry: options.localityBoundary,
            },
          }
        : {
            status: 'UNGROUNDED' as const,
            assertion,
            reason: 'NO_BOUNDARY' as const,
          },
    ),
  };
  const declared = options.placesDeclaringOsm;
  const placesApi = declared
    ? {
        provider: 'geoapify' as const,
        declaresSourceIdentitiesInDetails: true,
        getStatus: jest.fn(),
        searchNearby: jest.fn(),
        searchText: jest.fn().mockResolvedValue({
          data: [
            ...(declared.secondSameName
              ? [
                  {
                    id: 'geo-2',
                    name: declared.name,
                    displayName: { text: declared.name },
                    location: declared.secondSameName,
                    types: [],
                    featureClass: 'point_of_interest',
                  },
                ]
              : []),
            {
              id: 'geo-1',
              name: declared.name,
              displayName: { text: declared.name },
              location: {
                latitude: declared.latitude,
                longitude: declared.longitude,
              },
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
            id: 'geo-1',
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: declared.osmId },
            ],
          },
          provenance: {
            provider: 'geoapify',
            cacheStatus: 'miss-live',
            requestedCount: 1,
            receivedCount: 1,
          },
        }),
      }
    : options.placesFailure
      ? {
          provider: 'geoapify' as const,
          declaresSourceIdentitiesInDetails: true,
          getStatus: jest.fn(),
          searchNearby: jest.fn(),
          searchText: jest.fn().mockRejectedValue(options.placesFailure),
          getPlaceDetails: jest.fn(),
        }
      : undefined;
  const service = new ExperienceProposalResolverService(
    osmPlaces as any,
    catalog as any,
    { validate: jest.fn().mockReturnValue({ accepted: true }) } as any,
    undefined,
    nominatim as any,
    placesApi as any,
    wikidata as any,
    options.overtureCandidates
      ? ({
          lookupExactPlace: jest.fn().mockResolvedValue({
            candidates: options.overtureCandidates,
            resultCount: options.overtureCandidates.length,
            coverage: 'PARTIAL_OR_UNKNOWN',
          }),
        } as any)
      : undefined,
    localityGrounder,
  );
  return { service, catalog, nominatim, wikidata, localityGrounder, placesApi };
}

const lujanItinerary = (
  hintName: string,
  assertions: Partial<GeoEntityHint> = {},
) => ({
  name: 'Lujan de Cuyo Wine Tasting Itinerary',
  themes: ['wine'],
  traits: [] as string[],
  intents: [] as string[],
  componentHints: [
    {
      key: 'component',
      name: hintName,
      role: 'venue' as const,
      expectedKind: 'PLACE' as const,
      evidenceKeys: ['ev-1'],
      ...assertions,
    },
  ],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed itinerary',
});

const resolveRouteLike = (
  service: ExperienceProposalResolverService,
  hintName: string,
  observations?: SourceObservation[],
  assertions: Partial<GeoEntityHint> = {},
) =>
  service.resolve({
    destinationName: 'Ciudad de Mendoza',
    destinationCountryCode: 'AR',
    geographicScope: MENDOZA,
    candidates: [
      {
        candidate: lujanItinerary(hintName, assertions),
        geographicAuthorization: ownedAuthorization('route_like'),
      },
    ],
    evidence: [
      {
        key: 'ev-1',
        source: 'web',
        title: 'The Best Wineries in Mendoza',
        snippet: `${hintName} in Lujan de Cuyo`,
      },
    ],
    ...(observations ? { observations } : {}),
  } as any);

const attemptOf = (result: any, strategy: string) =>
  result.entityResolution.forensicAudit[0].componentAudits[0].attempts.find(
    (attempt: any) => attempt.strategy === strategy,
  );

const expectNoIdentityWrites = (
  catalog: ReturnType<typeof build>['catalog'],
) => {
  expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
  expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
  expect(catalog.rememberVerifiedHintName).not.toHaveBeenCalled();
};

describe('ExperienceProposalResolverService -- RW4 candidate selection before verification', () => {
  it('asks Nominatim for its whole result window, not the importance-truncated default', async () => {
    const { service, nominatim } = build({});

    await resolveRouteLike(service, 'Ojo de Agua');

    expect(nominatim.search).toHaveBeenCalledWith(
      'Ojo de Agua',
      expect.objectContaining({
        countryCode: 'AR',
        resultWindow: 'PROVIDER_MAXIMUM',
      }),
    );
  });

  it('real replay: the Lujan de Cuyo member ranked near the bottom by importance is the one selected, beyond the descriptive destination, but stays AMBIGUOUS among 31 homonyms', async () => {
    const { service, catalog } = build({
      nominatimResults: POOL.PROVIDER_MAXIMUM,
      // Even a corroborating NEARBY item cannot single out one member of a
      // real same-name pool (preserved 2026-10-03 correction).
      nearby: [{ qid: 'Q-nearby', label: 'Ojo de Agua' }],
    });
    const lujanRank = POOL.PROVIDER_MAXIMUM.findIndex(
      (result) => `osm:${result.osmType}:${result.osmId}` === LUJAN_RESTAURANT,
    );
    expect(lujanRank).toBeGreaterThanOrEqual(5);

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt.providerResultCount).toBe(31);
    expect(attempt.selectedCandidate.externalId).toBe(LUJAN_RESTAURANT);
    expect(attempt.identityEvidence).toContainEqual({
      type: 'EXACT_NAME',
      identityMultiplicity: 'MULTIPLE',
    });
    expect(attempt.verificationDecision).toBe('AMBIGUOUS');
    expect(result.resolved[0].status).toBe('rejected');
    expectNoIdentityWrites(catalog);
  });

  it('real replay: when the provider response holds no plausible member (pre-fix window), the nearest Cordoba hamlet is tried but never verified', async () => {
    const { service, catalog } = build({
      nominatimResults: POOL.DEFAULT,
      nearby: [{ qid: 'Q-nearby', label: 'Ojo de Agua' }],
    });
    expect(
      POOL.DEFAULT.some(
        (result) =>
          `osm:${result.osmType}:${result.osmId}` === LUJAN_RESTAURANT,
      ),
    ).toBe(false);

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt.selectedCandidate.externalId).toBe(CORDOBA_HAMLET);
    expect(attempt.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });

  it('same name, same province, different physical kinds: a restaurant and a hamlet both in Mendoza stay AMBIGUOUS, whichever is nearer', async () => {
    const restaurant = POOL.PROVIDER_MAXIMUM.find(
      (result) => `osm:${result.osmType}:${result.osmId}` === LUJAN_RESTAURANT,
    )!;
    // Constructed: a same-name Mendoza settlement nearer the destination.
    const mendozaHamlet: NominatimResult = {
      ...POOL.DEFAULT[0],
      osmId: 1,
      latitude: -32.95,
      longitude: -68.85,
      displayName: 'Ojo de Agua, Departamento Godoy Cruz, Mendoza, Argentina',
      address: { state: 'Mendoza', country: 'Argentina', countryCode: 'AR' },
    };
    const { service, catalog } = build({
      nominatimResults: [restaurant, mendozaHamlet],
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt.selectedCandidate.externalId).toBe('osm:node:1');
    expect(attempt.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: Nominatim and Geoapify converging on the same OSM node never decide a known homonym collision', async () => {
    // Constructed: an "Ojo de Agua" venue inside Ciudad de Mendoza added to
    // the REAL pre-fix pool (five homonyms elsewhere). Geoapify's search is
    // a circle around the destination, so it can only reach this member;
    // Place Details declares the same OSM node Nominatim selected.
    const inDestination: NominatimResult = {
      ...POOL.DEFAULT[0],
      osmId: 77,
      class: 'amenity',
      type: 'restaurant',
      latitude: -32.89,
      longitude: -68.85,
      displayName: 'Ojo de Agua, Ciudad de Mendoza, Mendoza, Argentina',
    };
    const { service, catalog } = build({
      nominatimResults: [...POOL.DEFAULT, inDestination],
      nearby: [{ qid: 'Q-nearby', label: 'Ojo de Agua' }],
      placesDeclaringOsm: {
        name: 'Ojo de Agua',
        latitude: -32.89,
        longitude: -68.85,
        osmId: 'osm:node:77',
        // A second same-name venue inside the circle, farther from the
        // centre: Places also sees a collision.
        secondSameName: { latitude: -32.92, longitude: -68.88 },
      },
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    const places = attemptOf(result, 'PLACES');
    // The collision is a fact about the hint, recorded from every pool
    // examined so far, not a flag on the converging pair.
    expect(places.identityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'IDENTITY_CONVERGENCE' }),
        expect.objectContaining({
          type: 'CONVERGENCE_PROVENANCE',
          upstream: 'SHARED_UPSTREAM',
        }),
        expect.objectContaining({
          type: 'COMPETITOR_EXAMINATION',
          outcome: 'MATERIAL_COMPETITOR_KNOWN',
        }),
      ]),
    );
    expect(places.verificationDecision).not.toBe('VERIFIED');
    expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
    expectNoIdentityWrites(catalog);
  });

  it('a unique exact-name member in the right area still verifies (selection widening does not weaken a genuine SINGLE)', async () => {
    const restaurant = POOL.PROVIDER_MAXIMUM.find(
      (result) => `osm:${result.osmType}:${result.osmId}` === LUJAN_RESTAURANT,
    )!;
    const { service, catalog } = build({ nominatimResults: [restaurant] });

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    expect(attemptOf(result, 'NOMINATIM').verificationDecision).toBe(
      'VERIFIED',
    );
    expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
  });
});

describe('ExperienceProposalResolverService -- explicit identity contradiction', () => {
  // A Wikivoyage-style listing whose own `wikidata=` names the component.
  const listing = (qid: string): SourceObservation =>
    ({
      evidenceKey: 'ev-1',
      sourceKind: 'wikivoyage',
      name: 'Bodega Ejemplo',
      canonicalIdentity: { wikidataQid: qid },
    }) as unknown as SourceObservation;
  const osmWinery = (qid: string) => ({
    id: 'osm:node:77',
    name: 'Bodega Ejemplo',
    osmType: 'node',
    osmId: 77,
    geometry: { type: 'Point', coordinates: [-68.85, -32.89] },
    tags: { craft: 'winery', wikidata: qid },
  });

  it('rejects a lone exact-name record whose own QID differs from the QID the source declares, before any write', async () => {
    const { service, catalog } = build({
      osmPool: [osmWinery('Q200')],
    });

    const result = await resolveRouteLike(service, 'Bodega Ejemplo', [
      listing('Q100'),
    ]);

    const attempt = attemptOf(result, 'LOCAL_OSM_POOL');
    // A regional Experience may lie beyond the destination, so one member
    // of the destination-bounded pool is not established unique (UNKNOWN).
    expect(attempt.identityEvidence).toEqual(
      expect.arrayContaining([
        { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
        {
          type: 'IDENTITY_CONTRADICTION',
          fact: 'WIKIDATA_QID',
          sourceQid: 'Q100',
          candidateQid: 'Q200',
        },
      ]),
    );
    expect(attempt.verificationDecision).toBe('REJECTED');
    expectNoIdentityWrites(catalog);
  });

  it('verifies the same unique exact-name record when the declared QIDs agree', async () => {
    const { service, catalog } = build({ osmPool: [osmWinery('Q100')] });

    const result = await resolveRouteLike(service, 'Bodega Ejemplo', [
      listing('q100'),
    ]);

    const attempt = attemptOf(result, 'LOCAL_OSM_POOL');
    expect(attempt.verificationDecision).toBe('VERIFIED');
    expect(
      attempt.identityEvidence.some(
        (item: any) => item.type === 'IDENTITY_CONTRADICTION',
      ),
    ).toBe(false);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
  });
});

describe('ExperienceProposalResolverService -- contextual identity on the real Ojo de Agua pool', () => {
  // Simplified Luján de Cuyo department: contains the Agrelo restaurant
  // (-33.13, -68.96) and none of the other 30 homonyms. The REAL OSM
  // boundary is grounded by the production grounder (milestone 2).
  const LUJAN: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-69.3, -33.45],
        [-68.75, -33.45],
        [-68.75, -32.95],
        [-69.3, -32.95],
        [-69.3, -33.45],
      ],
    ],
  };
  // Elsewhere in Mendoza (Valle de Uco), holding no homonym.
  const TUNUYAN: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-69.4, -33.7],
        [-69.0, -33.7],
        [-69.0, -33.4],
        [-69.4, -33.4],
        [-69.4, -33.7],
      ],
    ],
  };
  const CAPTION = 'Wine and lunch at Ojo de Agua in Lujan de Cuyo';
  const lujanAssertion = {
    localityAssertion: {
      locality: 'Lujan de Cuyo',
      evidenceKey: 'ev-1',
      supportSpan: CAPTION,
    },
  };
  const establishment = {
    physicalKindAssertion: {
      kind: 'ESTABLISHMENT' as const,
      term: 'winery lunch',
      evidenceKey: 'ev-1',
      supportSpan: '3. Ojo de Agua – 1:30 pm for a winery lunch',
    },
  };
  const restaurant = POOL.PROVIDER_MAXIMUM.find(
    (result) => `osm:${result.osmType}:${result.osmId}` === LUJAN_RESTAURANT,
  )!;

  it('POSITIVE: the stated locality + stated kind single out the Agrelo restaurant among 31 homonyms -> contextually VERIFIED', async () => {
    const { service, catalog } = build({
      nominatimResults: POOL.PROVIDER_MAXIMUM,
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
      ...establishment,
    });

    const audit = result.entityResolution.forensicAudit[0].componentAudits[0];
    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt.selectedCandidate.externalId).toBe(LUJAN_RESTAURANT);
    expect(attempt.identityEvidence).toEqual(
      expect.arrayContaining([
        { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
        {
          type: 'CONTEXTUAL_CORRESPONDENCE',
          assertion: 'LOCALITY',
          locality: 'Lujan de Cuyo',
          coverage: 'PROVIDER_WINDOW_NOT_REACHED',
          memberCount: 31,
          consistentCount: 1,
          outcome: 'DISTINGUISHED',
        },
      ]),
    );
    expect(attempt.verificationDecision).toBe('VERIFIED');
    expect(audit.identityContext).toMatchObject({
      locality: {
        locality: 'Lujan de Cuyo',
        supportSpan: CAPTION,
        grounding: 'GROUNDED',
        boundaryId: 'osm:relation:lujan',
      },
      physicalKind: { kind: 'ESTABLISHMENT', term: 'winery lunch' },
    });
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: LUJAN_RESTAURANT }),
    );
  });

  it('the decision does not depend on proximity: context picks the restaurant even when a nearer member would win the ranking', async () => {
    // A same-name dwelling placed next to the destination centre ranks
    // first by distance; it is outside Luján de Cuyo.
    const nearDwelling: NominatimResult = {
      ...POOL.DEFAULT[4],
      osmId: 2,
      latitude: -32.89,
      longitude: -68.84,
    };
    const { service } = build({
      nominatimResults: [nearDwelling, ...POOL.PROVIDER_MAXIMUM],
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
      ...establishment,
    });

    expect(attemptOf(result, 'NOMINATIM').selectedCandidate.externalId).toBe(
      LUJAN_RESTAURANT,
    );
  });

  it('NEGATIVE: the pre-fix window (no Luján member) never verifies the Córdoba hamlet: locality and kind both contradict it', async () => {
    const { service, catalog } = build({
      nominatimResults: POOL.DEFAULT,
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
      ...establishment,
    });

    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt.selectedCandidate.externalId).toBe(CORDOBA_HAMLET);
    expect(attempt.identityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'IDENTITY_CONTRADICTION',
          fact: 'LOCALITY',
        }),
        expect.objectContaining({
          type: 'IDENTITY_CONTRADICTION',
          fact: 'PHYSICAL_KIND',
          candidateKind: 'SETTLEMENT',
        }),
      ]),
    );
    expect(attempt.verificationDecision).toBe('REJECTED');
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: the wrong explicitly asserted locality rejects the same-name restaurant', async () => {
    const { service, catalog } = build({
      nominatimResults: [restaurant],
      localityBoundary: TUNUYAN,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      localityAssertion: {
        locality: 'Tunuyan',
        evidenceKey: 'ev-1',
        supportSpan: 'Ojo de Agua in Tunuyan',
      },
    });

    const attempt = attemptOf(result, 'NOMINATIM');
    // A provider-local unique name does not survive a known contradiction.
    expect(attempt.identityEvidence).toContainEqual({
      type: 'EXACT_NAME',
      identityMultiplicity: 'SINGLE',
    });
    expect(attempt.verificationDecision).toBe('REJECTED');
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: two equally plausible establishments in one locality stay AMBIGUOUS', async () => {
    const twin: NominatimResult = {
      ...restaurant,
      osmId: 3,
      latitude: -33.2,
      longitude: -69.0,
    };
    const { service, catalog } = build({
      nominatimResults: [...POOL.PROVIDER_MAXIMUM, twin],
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
      ...establishment,
    });

    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt.identityEvidence).toContainEqual(
      expect.objectContaining({
        type: 'CONTEXTUAL_CORRESPONDENCE',
        outcome: 'AMBIGUOUS',
        consistentCount: 2,
      }),
    );
    expect(attempt.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: a window cut off at the provider maximum is not a complete comparison', async () => {
    const filler = (index: number): NominatimResult => ({
      ...POOL.DEFAULT[1],
      osmId: 1000 + index,
    });
    const saturated = [
      restaurant,
      ...Array.from({ length: 39 }, (_unused, index) => filler(index)),
    ];
    const { service, catalog } = build({
      nominatimResults: saturated,
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
      ...establishment,
    });

    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt.identityEvidence).toContainEqual(
      expect.objectContaining({
        type: 'CONTEXTUAL_CORRESPONDENCE',
        coverage: 'NOT_ESTABLISHED',
        outcome: 'INCOMPLETE_COMPARISON',
      }),
    );
    expect(attempt.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: a lone exact match in a saturated window is not SINGLE (multiplicity UNKNOWN)', async () => {
    const other = (index: number): NominatimResult => ({
      ...POOL.DEFAULT[1],
      osmId: 2000 + index,
      displayName: `Hostería Aguas ${index}, Neuquén, Argentina`,
    });
    const { service, catalog } = build({
      nominatimResults: [
        restaurant,
        ...Array.from({ length: 39 }, (_unused, index) => other(index)),
      ],
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    expect(attemptOf(result, 'NOMINATIM').identityEvidence).toContainEqual({
      type: 'EXACT_NAME',
      identityMultiplicity: 'UNKNOWN',
    });
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: an itinerary heading alone ("Lujan de Cuyo Itinerary") is no component assertion: the real pool stays AMBIGUOUS', async () => {
    const { service, catalog, localityGrounder } = build({
      nominatimResults: POOL.PROVIDER_MAXIMUM,
      localityBoundary: LUJAN,
    });

    // The Experience is named after Luján de Cuyo, but the hint carries no
    // component-specific locality assertion.
    const result = await resolveRouteLike(service, 'Ojo de Agua');

    expect(localityGrounder.groundLocality).not.toHaveBeenCalled();
    expect(attemptOf(result, 'NOMINATIM').verificationDecision).toBe(
      'AMBIGUOUS',
    );
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: an ungroundable locality is missing evidence, never a contradiction or a verification', async () => {
    const { service, catalog } = build({
      nominatimResults: POOL.PROVIDER_MAXIMUM,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
    });

    const audit = result.entityResolution.forensicAudit[0].componentAudits[0];
    expect(audit.identityContext.locality).toMatchObject({
      grounding: 'UNGROUNDED',
      ungroundedReason: 'NO_BOUNDARY',
    });
    expect(attemptOf(result, 'NOMINATIM').verificationDecision).toBe(
      'AMBIGUOUS',
    );
    expectNoIdentityWrites(catalog);
  });

  it('NEGATIVE: a near, differently named business is never a contextual match', async () => {
    const nearbyBusiness: NominatimResult = {
      ...restaurant,
      osmId: 4,
      displayName:
        'Bodega Ojo del Agua Restó, Agrelo, Luján de Cuyo, Mendoza, Argentina',
    };
    const { service, catalog } = build({
      nominatimResults: [nearbyBusiness],
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
      ...establishment,
    });

    const attempt = attemptOf(result, 'NOMINATIM');
    expect(attempt?.verificationDecision).not.toBe('VERIFIED');
    expectNoIdentityWrites(catalog);
  });

  it('a later Places timeout does not block an identity already established by the examined pool', async () => {
    const { service, catalog, placesApi } = build({
      nominatimResults: POOL.PROVIDER_MAXIMUM,
      localityBoundary: LUJAN,
      placesFailure: new Error('timeout of 5000ms exceeded'),
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      ...lujanAssertion,
      ...establishment,
    });

    expect(attemptOf(result, 'NOMINATIM').verificationDecision).toBe(
      'VERIFIED',
    );
    expect(placesApi!.searchText).not.toHaveBeenCalled();
    expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: a provider-local lone name in the local OSM pool is rejected when it lies outside the asserted locality', async () => {
    const { service, catalog } = build({
      osmPool: [
        {
          id: 'osm:node:88',
          name: 'Bodega Ejemplo',
          osmType: 'node',
          osmId: 88,
          // Mendoza city centre: outside Luján de Cuyo.
          geometry: { type: 'Point', coordinates: [-68.845, -32.889] },
          tags: { craft: 'winery' },
        },
      ],
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(
      service,
      'Bodega Ejemplo',
      undefined,
      {
        localityAssertion: {
          locality: 'Lujan de Cuyo',
          evidenceKey: 'ev-1',
          supportSpan: 'Bodega Ejemplo in Lujan de Cuyo',
        },
      },
    );

    const attempt = attemptOf(result, 'LOCAL_OSM_POOL');
    // Regional Experience: the destination-bounded pool cannot establish
    // SINGLE; the contradiction rejects either way.
    expect(attempt.identityEvidence).toEqual(
      expect.arrayContaining([
        { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
        expect.objectContaining({
          type: 'IDENTITY_CONTRADICTION',
          fact: 'LOCALITY',
        }),
      ]),
    );
    expect(attempt.verificationDecision).toBe('REJECTED');
    expectNoIdentityWrites(catalog);
  });

  describe('verified hint memory stays bound to the context that verified it', () => {
    // The GeoEntity a contextual COLD verification persisted, reached WARM
    // through its remembered hint key.
    const rememberedRestaurant = {
      geoEntityId: 'geo-ojo-de-agua',
      name: 'Ojo de Agua',
      kind: 'PLACE',
      latitude: -33.1300868,
      longitude: -68.9641048,
      geometry: { type: 'Point', coordinates: [-68.9641048, -33.1300868] },
      address: null as string | null,
      identities: [{ provider: 'openstreetmap', externalId: LUJAN_RESTAURANT }],
      matchKind: 'VERIFIED_HINT',
    };

    it('COLD: a contextually VERIFIED component is remembered only after persistence', async () => {
      const { service, catalog } = build({
        nominatimResults: POOL.PROVIDER_MAXIMUM,
        localityBoundary: LUJAN,
      });

      await resolveRouteLike(service, 'Ojo de Agua', undefined, {
        ...lujanAssertion,
        ...establishment,
      });

      expect(catalog.rememberVerifiedHintName).toHaveBeenCalledWith(
        'geo-1',
        'Ojo de Agua',
      );
    });

    it('WARM, same stated locality: reuses the GeoEntity with no provider acquisition', async () => {
      const { service, nominatim } = build({
        catalogCandidates: [rememberedRestaurant],
        localityBoundary: LUJAN,
      });

      const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
        ...lujanAssertion,
      });

      expect(attemptOf(result, 'CATALOG_REUSE').verificationDecision).toBe(
        'VERIFIED',
      );
      expect(nominatim.search).not.toHaveBeenCalled();
    });

    it('WARM, contradicting stated locality: the remembered name alone cannot reuse it; acquisition continues', async () => {
      const { service, nominatim } = build({
        catalogCandidates: [rememberedRestaurant],
        localityBoundary: TUNUYAN,
        nominatimResults: [],
      });

      const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
        localityAssertion: {
          locality: 'Tunuyan',
          evidenceKey: 'ev-1',
          supportSpan: 'Ojo de Agua in Tunuyan',
        },
      });

      const reuse = attemptOf(result, 'CATALOG_REUSE');
      expect(reuse.identityEvidence).toContainEqual(
        expect.objectContaining({
          type: 'IDENTITY_CONTRADICTION',
          fact: 'LOCALITY',
        }),
      );
      expect(reuse.verificationDecision).toBe('REJECTED');
      expect(nominatim.search).toHaveBeenCalled();
    });

    it('WARM, no stated locality (an excursion departing from another city): reuse is still allowed', async () => {
      const { service, nominatim } = build({
        catalogCandidates: [rememberedRestaurant],
      });

      const result = await resolveRouteLike(service, 'Ojo de Agua');

      expect(attemptOf(result, 'CATALOG_REUSE').verificationDecision).toBe(
        'VERIFIED',
      );
      expect(nominatim.search).not.toHaveBeenCalled();
    });
  });
});

describe('ExperienceProposalResolverService -- Overture pool on the same terms', () => {
  // Simplified Luján de Cuyo boundary, as above.
  const LUJAN: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-69.3, -33.45],
        [-68.75, -33.45],
        [-68.75, -32.95],
        [-69.3, -32.95],
        [-69.3, -33.45],
      ],
    ],
  };
  const overtureRow = (
    featureId: string,
    latitude: number,
    longitude: number,
    exactName: 'MULTIPLE' | 'UNKNOWN' | 'SINGLE',
  ) => ({
    hintKey: 'component',
    hintName: 'Finca Ejemplo',
    provider: 'overture',
    externalId: featureId,
    canonicalName: 'Finca Ejemplo',
    kind: 'PLACE',
    latitude,
    longitude,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    role: 'venue',
    nameEvidenceMultiplicity: { exactName, declaredAlias: 'UNKNOWN' },
    structuralKind: 'UNKNOWN',
    upstreamDatasets: ['meta'],
  });
  const lujanLocality = {
    localityAssertion: {
      locality: 'Lujan de Cuyo',
      evidenceKey: 'ev-1',
      supportSpan: 'Lunch at Finca Ejemplo in Lujan de Cuyo',
    },
  };

  it('feature-id order is not a preference: the member nearest the scope window is tried, and a name collision stays AMBIGUOUS', async () => {
    const { service, catalog } = build({
      overtureCandidates: [
        // First by feature id, far away (Salta).
        overtureRow('0000-far', -24.79, -65.41, 'MULTIPLE'),
        overtureRow('ffff-near', -32.9, -68.85, 'MULTIPLE'),
      ],
    });

    const result = await resolveRouteLike(service, 'Finca Ejemplo');

    const attempt = attemptOf(result, 'OVERTURE_IDENTITY');
    expect(attempt.providerResultCount).toBe(2);
    expect(attempt.selectedCandidate.externalId).toBe('ffff-near');
    expect(attempt.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });

  it('a stated locality picks no Overture member alone (snapshot coverage is not a typed fact) and rejects one outside it', async () => {
    const { service, catalog } = build({
      overtureCandidates: [overtureRow('outside', -32.9, -68.85, 'SINGLE')],
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(
      service,
      'Finca Ejemplo',
      undefined,
      lujanLocality,
    );

    const attempt = attemptOf(result, 'OVERTURE_IDENTITY');
    expect(attempt.identityEvidence).toContainEqual(
      expect.objectContaining({
        type: 'IDENTITY_CONTRADICTION',
        fact: 'LOCALITY',
      }),
    );
    expect(attempt.verificationDecision).toBe('REJECTED');
    expectNoIdentityWrites(catalog);
  });

  it('two Overture members inside the stated locality stay AMBIGUOUS', async () => {
    const { service, catalog } = build({
      overtureCandidates: [
        overtureRow('a', -33.13, -68.96, 'MULTIPLE'),
        overtureRow('b', -33.2, -69.0, 'MULTIPLE'),
      ],
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(
      service,
      'Finca Ejemplo',
      undefined,
      lujanLocality,
    );

    const attempt = attemptOf(result, 'OVERTURE_IDENTITY');
    expect(attempt.identityEvidence).toContainEqual(
      expect.objectContaining({
        type: 'CONTEXTUAL_CORRESPONDENCE',
        outcome: 'AMBIGUOUS',
        consistentCount: 2,
      }),
    );
    expect(attempt.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });

  it('one partial-snapshot member inside the stated locality is an INCOMPLETE comparison: INSUFFICIENT_EVIDENCE, not VERIFIED', async () => {
    const { service, catalog } = build({
      overtureCandidates: [overtureRow('inside', -33.13, -68.96, 'UNKNOWN')],
      localityBoundary: LUJAN,
    });

    const result = await resolveRouteLike(
      service,
      'Finca Ejemplo',
      undefined,
      lujanLocality,
    );

    const attempt = attemptOf(result, 'OVERTURE_IDENTITY');
    expect(attempt.identityEvidence).toContainEqual(
      expect.objectContaining({
        type: 'CONTEXTUAL_CORRESPONDENCE',
        coverage: 'NOT_ESTABLISHED',
        outcome: 'INCOMPLETE_COMPARISON',
      }),
    );
    expect(attempt.verificationDecision).toBe('INSUFFICIENT_EVIDENCE');
    expectNoIdentityWrites(catalog);
  });
});

/**
 * 2026-10-03 ambiguity policy: competitors are a fact about the HINT,
 * collected from every pool examined for it, and uniqueness is concluded
 * only from a pool that covered the component's admission scope. Each
 * "c708b9a9" note records the verdict the pre-fix policy produced on the
 * same inputs (re-run against c708b9a9's production files).
 */
describe('ExperienceProposalResolverService -- hint-level competitor examination', () => {
  const RESTAURANT = POOL.PROVIDER_MAXIMUM.find(
    (result) => `osm:${result.osmType}:${result.osmId}` === LUJAN_RESTAURANT,
  )!;
  // Constructed: a same-name venue inside Ciudad de Mendoza.
  const inDestination = (
    osmId: number,
    latitude = -32.89,
  ): NominatimResult => ({
    ...RESTAURANT,
    osmId,
    latitude,
    longitude: -68.85,
    displayName: 'Ojo de Agua, Ciudad de Mendoza, Mendoza, Argentina',
  });
  const inDestinationOsmNode = {
    id: 'osm:node:77',
    name: 'Ojo de Agua',
    osmType: 'node',
    osmId: 77,
    geometry: { type: 'Point', coordinates: [-68.85, -32.89] },
    tags: { amenity: 'restaurant' },
  };
  const resolveStrict = (
    service: ExperienceProposalResolverService,
    hintName: string,
    hintExtra: Partial<GeoEntityHint> = {},
  ) =>
    service.resolve({
      destinationName: 'Ciudad de Mendoza',
      destinationCountryCode: 'AR',
      geographicScope: MENDOZA,
      candidates: withDefaultGeographicAuthorization([
        lujanItinerary(hintName, hintExtra),
      ]),
      evidence: [
        {
          key: 'ev-1',
          source: 'web',
          title: 'Mendoza city restaurants',
          snippet: `${hintName} in Ciudad de Mendoza`,
        },
      ],
    } as any);
  const examinationOf = (attempt: any) =>
    attempt.identityEvidence.find(
      (item: any) => item.type === 'COMPETITOR_EXAMINATION',
    );

  it('DEFECT A: a regional Experience never verifies on destination-bounded pools that saw no competitor (Nominatim failed)', async () => {
    // c708b9a9: LOCAL_OSM_POOL VERIFIED on EXACT_NAME/SINGLE of a pool that
    // cannot reach Luján de Cuyo; failing that, the PLACES convergence on the
    // same node VERIFIED because neither pool "knew" a collision.
    const { service, catalog } = build({
      osmPool: [inDestinationOsmNode],
      nominatimFailure: new Error('Nominatim timeout'),
      placesDeclaringOsm: {
        name: 'Ojo de Agua',
        latitude: -32.89,
        longitude: -68.85,
        osmId: 'osm:node:77',
      },
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    const local = attemptOf(result, 'LOCAL_OSM_POOL');
    expect(local.identityEvidence).toContainEqual({
      type: 'EXACT_NAME',
      identityMultiplicity: 'UNKNOWN',
    });
    expect(local.verificationDecision).toBe('INSUFFICIENT_EVIDENCE');
    expect(attemptOf(result, 'NOMINATIM').executionStatus).toBe('failed');
    const places = attemptOf(result, 'PLACES');
    expect(places.identityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'IDENTITY_CONVERGENCE' }),
        expect.objectContaining({
          type: 'CONVERGENCE_PROVENANCE',
          upstream: 'SHARED_UPSTREAM',
        }),
      ]),
    );
    expect(examinationOf(places)).toMatchObject({
      outcome: 'NO_COMPETITOR_OBSERVED',
      examinedStrategies: ['LOCAL_OSM_POOL', 'PLACES'],
    });
    expect(places.verificationDecision).toBe('INSUFFICIENT_EVIDENCE');
    expectNoIdentityWrites(catalog);
  });

  it('DEFECT A: a saturated Nominatim window plus a Places convergence is not an examined competitor set', async () => {
    // c708b9a9: Nominatim's lone exact member in a full window was UNKNOWN,
    // which was not a known collision, so the PLACES convergence VERIFIED.
    const filler = (index: number): NominatimResult => ({
      ...POOL.DEFAULT[0],
      osmId: 1000 + index,
      displayName: `Aguada ${index}, Departamento Minas, Córdoba, Argentina`,
    });
    const saturated = [
      inDestination(77),
      ...Array.from({ length: 39 }, (_, index) => filler(index)),
    ];
    const { service, catalog } = build({
      nominatimResults: saturated,
      placesDeclaringOsm: {
        name: 'Ojo de Agua',
        latitude: -32.89,
        longitude: -68.85,
        osmId: 'osm:node:77',
      },
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    const nominatim = attemptOf(result, 'NOMINATIM');
    expect(nominatim.providerResultCount).toBe(40);
    expect(nominatim.identityEvidence).toContainEqual({
      type: 'EXACT_NAME',
      identityMultiplicity: 'UNKNOWN',
    });
    const places = attemptOf(result, 'PLACES');
    expect(
      places.identityEvidence.some(
        (item: any) => item.type === 'IDENTITY_CONVERGENCE',
      ),
    ).toBe(true);
    expect(examinationOf(places).outcome).toBe('NO_COMPETITOR_OBSERVED');
    expect(places.verificationDecision).not.toBe('VERIFIED');
    expectNoIdentityWrites(catalog);
  });

  it('DEFECT B: a Places SINGLE inside the circle never outweighs two admissible homonyms Nominatim returned', async () => {
    // c708b9a9: PLACES VERIFIED on its own EXACT_NAME/SINGLE.
    const { service, catalog } = build({
      nominatimResults: [inDestination(77), inDestination(78, -32.91)],
      placesDeclaringOsm: {
        name: 'Ojo de Agua',
        latitude: -32.9,
        longitude: -68.86,
        // A third OSM record: neither of Nominatim's two.
        osmId: 'osm:node:500',
      },
    });

    const result = await resolveStrict(service, 'Ojo de Agua');

    expect(attemptOf(result, 'NOMINATIM').verificationDecision).toBe(
      'AMBIGUOUS',
    );
    const places = attemptOf(result, 'PLACES');
    expect(places.identityEvidence).toContainEqual({
      type: 'EXACT_NAME',
      identityMultiplicity: 'SINGLE',
    });
    expect(examinationOf(places)).toMatchObject({
      outcome: 'MATERIAL_COMPETITOR_KNOWN',
      competitorCount: 2,
      examinedStrategies: ['LOCAL_OSM_POOL', 'NOMINATIM', 'PLACES'],
    });
    expect(places.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });

  it('a destination-bounded Experience: a homonym the component could never be admitted at does not block (single destination policy)', async () => {
    // The Córdoba hamlet lies outside the strict destination; the Ciudad de
    // Mendoza venue is the only admissible record, in both pools.
    const { service, catalog } = build({
      nominatimResults: [inDestination(77), POOL.DEFAULT[0]],
      placesDeclaringOsm: {
        name: 'Ojo de Agua',
        latitude: -32.89,
        longitude: -68.85,
        osmId: 'osm:node:77',
      },
    });

    const result = await resolveStrict(service, 'Ojo de Agua');

    const places = attemptOf(result, 'PLACES');
    expect(examinationOf(places)).toMatchObject({
      outcome: 'NO_MATERIAL_COMPETITOR',
      competitorCount: 0,
    });
    expect(places.verificationDecision).toBe('VERIFIED');
    expect(catalog.upsertGeoEntityWithIdentities).toHaveBeenCalledTimes(1);
  });

  it('one provider is enough: an untruncated country-bounded pool holding only the candidate verifies with no second dataset', async () => {
    const { service, catalog } = build({ nominatimResults: [RESTAURANT] });

    const result = await resolveRouteLike(service, 'Ojo de Agua');

    const nominatim = attemptOf(result, 'NOMINATIM');
    expect(examinationOf(nominatim)).toMatchObject({
      outcome: 'NO_MATERIAL_COMPETITOR',
      examinedStrategies: ['LOCAL_OSM_POOL', 'NOMINATIM'],
    });
    expect(nominatim.verificationDecision).toBe('VERIFIED');
    expect(attemptOf(result, 'PLACES')).toBeUndefined();
    expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
  });

  it('a brand website shared by two physical locations identifies neither', async () => {
    // Constructed: a second "Ojo de Agua" branch of the same brand in
    // Maipú, Mendoza. The component cites the brand site, which is
    // provenance only (never a facility identity).
    const maipuBranch: NominatimResult = {
      ...RESTAURANT,
      osmId: 4797394431,
      latitude: -32.98,
      longitude: -68.79,
      displayName: 'Ojo de Agua, Maipú, Mendoza, Argentina',
    };
    const { service, catalog } = build({
      nominatimResults: [RESTAURANT, maipuBranch],
    });

    const result = await resolveRouteLike(service, 'Ojo de Agua', undefined, {
      sourceLink: {
        evidenceKey: 'ev-1',
        url: 'https://ojodeagua.example/',
        linkText: 'Ojo de Agua',
      },
    });

    const nominatim = attemptOf(result, 'NOMINATIM');
    expect(examinationOf(nominatim).outcome).toBe('MATERIAL_COMPETITOR_KNOWN');
    expect(nominatim.verificationDecision).toBe('AMBIGUOUS');
    expectNoIdentityWrites(catalog);
  });
});
