import * as fs from 'fs';
import * as path from 'path';
import { NominatimResult } from '@integrations/osm/interfaces/nominatim.interface';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { ownedAuthorization } from '../fixtures/geographic-authorization.fixture';
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
      .mockResolvedValue({ candidates: [] }),
    rememberVerifiedHintName: jest.fn().mockResolvedValue('REMEMBERED'),
    findGeoEntityIdsByIdentities: jest.fn().mockResolvedValue([]),
    upsertGeoEntityWithIdentities: jest.fn(),
    upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    persistVerifiedExperience: jest
      .fn()
      .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
  };
  const nominatim = {
    search: jest.fn().mockResolvedValue(options.nominatimResults ?? []),
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
  const service = new ExperienceProposalResolverService(
    osmPlaces as any,
    catalog as any,
    { validate: jest.fn().mockReturnValue({ accepted: true }) } as any,
    undefined,
    nominatim as any,
    undefined,
    wikidata as any,
  );
  return { service, catalog, nominatim, wikidata };
}

const lujanItinerary = (hintName: string) => ({
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
    },
  ],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed itinerary',
});

const resolveRouteLike = (
  service: ExperienceProposalResolverService,
  hintName: string,
  observations?: SourceObservation[],
) =>
  service.resolve({
    destinationName: 'Ciudad de Mendoza',
    destinationCountryCode: 'AR',
    geographicScope: MENDOZA,
    candidates: [
      {
        candidate: lujanItinerary(hintName),
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

  it('rejects a unique exact-name record whose own QID differs from the QID the source declares, before any write', async () => {
    const { service, catalog, wikidata } = build({
      osmPool: [osmWinery('Q200')],
    });

    const result = await resolveRouteLike(service, 'Bodega Ejemplo', [
      listing('Q100'),
    ]);

    const attempt = attemptOf(result, 'LOCAL_OSM_POOL');
    expect(attempt.identityEvidence).toEqual(
      expect.arrayContaining([
        { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
        {
          type: 'IDENTITY_CONTRADICTION',
          fact: 'WIKIDATA_QID',
          sourceQid: 'Q100',
          candidateQid: 'Q200',
        },
      ]),
    );
    expect(attempt.verificationDecision).toBe('REJECTED');
    // A typed, local fact: no Wikidata round trip is needed to see it.
    expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
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
