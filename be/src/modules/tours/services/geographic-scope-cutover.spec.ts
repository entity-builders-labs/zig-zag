import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { PlacesSearchTextParams } from '@integrations/google-places/interfaces/places-api.interface';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';
import {
  GeographicScope,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { WorkUnitAnchorScope } from '../interfaces/experience-geographic-scope.interface';
import { ownedAuthorization } from '../fixtures/geographic-authorization.fixture';
import {
  geographicScopeSearchWindow,
  scopeSearchWindow,
} from '../utils/experience-geographic-scope.policy';
import { distanceMeters } from '../utils/geographic-coherence.util';
import { extractExperienceCandidates } from '../utils/experience-candidate-extraction.util';

/**
 * Spec 2026-10-02 Part II scenario matrix (§P2-11) plus the RW4 task's
 * additional cases A–L, deterministic. Synthetic fixtures use an unrelated
 * "Fixture City / Fixture Valley" geography (case K); the Uco regression
 * (case L) uses the real COLD #11 source excerpt and characterized
 * component coordinates, with a FIXTURE AREA polygon — the real "Valle de
 * Uco" has no canonical polygon in current providers (see
 * spikes/rw4-geographic-scope-uco-area-probe-2026-10-02/).
 */

const square = (
  longitude: number,
  latitude: number,
  halfSideDegrees: number,
): GeoJsonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [longitude - halfSideDegrees, latitude - halfSideDegrees],
      [longitude + halfSideDegrees, latitude - halfSideDegrees],
      [longitude + halfSideDegrees, latitude + halfSideDegrees],
      [longitude - halfSideDegrees, latitude + halfSideDegrees],
      [longitude - halfSideDegrees, latitude - halfSideDegrees],
    ],
  ],
});

// --- Synthetic geography (case K): no Mendoza/Uco strings in production. ---
const FIXTURE_CITY_GEOMETRY = square(10, 45, 0.05);
const FIXTURE_CITY: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: {
    id: 'osm:relation:100',
    name: 'Fixture City',
    osmType: 'relation',
    osmId: 100,
    tags: { boundary: 'administrative', admin_level: '8' },
    geometry: FIXTURE_CITY_GEOMETRY,
  },
};
// ~120 km south of Fixture City.
const FIXTURE_VALLEY_GEOMETRY = square(10, 43.92, 0.25);

const hint = (
  key: string,
  name: string,
  role: 'area' | 'venue' | 'waypoint' | 'route' = 'venue',
) => ({
  key,
  name,
  role,
  expectedKind:
    role === 'area'
      ? ('AREA' as const)
      : role === 'route'
        ? ('ROUTE' as const)
        : ('PLACE' as const),
  evidenceKeys: ['ev-1'],
});

const candidateOf = (
  name: string,
  componentHints: ReturnType<typeof hint>[],
): ExperienceCandidate => ({
  name,
  themes: ['wine'],
  traits: [],
  intents: ['route_like'],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed itinerary',
  componentHints,
});

const venueEntity = (
  key: string,
  latitude: number,
  longitude: number,
  adminContext?: ResolvedGeoEntity['adminContext'],
): ResolvedGeoEntity => ({
  hintKey: key,
  hintName: key,
  canonicalName: key,
  provider: 'openstreetmap',
  externalId: `osm:node:${key}`,
  geoEntityId: `geo-${key}`,
  role: 'venue',
  kind: GeoEntityKind.PLACE,
  status: 'resolved',
  latitude,
  longitude,
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' },
  ...(adminContext ? { adminContext } : {}),
});

const areaEntity = (
  key: string,
  geometry: GeoJsonGeometry,
  latitude: number,
  longitude: number,
): ResolvedGeoEntity => ({
  hintKey: key,
  hintName: key,
  canonicalName: key,
  provider: 'openstreetmap',
  externalId: `osm:relation:${key}`,
  geoEntityId: `geo-${key}`,
  role: 'area',
  kind: GeoEntityKind.AREA,
  status: 'resolved',
  latitude,
  longitude,
  geometry,
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' },
});

const validateWith = (
  candidate: ExperienceCandidate,
  entities: ResolvedGeoEntity[],
  options: {
    authorization?: Parameters<
      CompositeGeographicValidationService['validate']
    >[3];
    destination?: GeographicScope;
    workUnitScope?: WorkUnitAnchorScope;
  } = {},
) => {
  const destination = options.destination ?? FIXTURE_CITY;
  return new CompositeGeographicValidationService().validate(
    {
      candidate,
      status: 'accepted',
      resolvedEntities: entities,
      rejectionReasons: [],
    },
    destination.kind === 'AREA_BOUNDARY' ? destination.boundary : undefined,
    options.workUnitScope,
    options.authorization,
    destination,
  );
};

const VALLEY_VENUES = [
  venueEntity('v1', 43.85, 9.9),
  venueEntity('v2', 43.95, 10.05),
  venueEntity('v3', 44.05, 10.1),
];
const VALLEY_CANDIDATE = candidateOf('Fixture Valley itinerary', [
  hint('valley', 'Fixture Valley', 'area'),
  hint('v1', 'Estate One'),
  hint('v2', 'Estate Two'),
  hint('v3', 'Estate Three'),
]);
const VALLEY_ENTITIES = [
  areaEntity('valley', FIXTURE_VALLEY_GEOMETRY, 43.92, 10),
  ...VALLEY_VENUES,
];

describe('Part II geographic scope — composite validation (S4)', () => {
  it('C/K: a ROUTE_LIKE candidate whose source-backed AREA lies ~120 km beyond the destination is validated against that AREA and ACCEPTED; the destination relation is only a fact', () => {
    const result = validateWith(VALLEY_CANDIDATE, VALLEY_ENTITIES, {
      authorization: ownedAuthorization('route_like'),
    });

    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('canonical_area');
    expect(result.experienceScope).toEqual({
      kind: 'AREA',
      provenance: 'CANDIDATE_AREA',
      name: 'valley',
      geoEntityId: 'geo-valley',
      destinationRelation: 'OUTSIDE',
      membership: 'DESCRIPTIVE',
    });
    expect(result.destinationRelation?.relation).toBe('OUTSIDE_DESTINATION');
  });

  it('§P2-18 C/F: a stop far outside the source-named AREA is not decided by distance — evidence decides: one supporting record + no contradiction keeps it (fact recorded); a region contradiction of the AREA rejects it', () => {
    const farStop = (adminContext?: ResolvedGeoEntity['adminContext']) =>
      validateWith(
        VALLEY_CANDIDATE,
        [
          areaEntity('valley', FIXTURE_VALLEY_GEOMETRY, 43.92, 10),
          venueEntity(
            'v1',
            43.85,
            9.9,
            adminContext && { ...adminContext, region: 'South' },
          ),
          venueEntity(
            'v2',
            43.95,
            10.05,
            adminContext && { ...adminContext, region: 'South' },
          ),
          // Real, but nowhere near Fixture Valley.
          venueEntity('v3', 46.5, 12.5, adminContext),
        ],
        { authorization: ownedAuthorization('route_like') },
      );

    const noRegionEvidence = farStop();
    expect(noRegionEvidence.accepted).toBe(true);
    expect(noRegionEvidence.experienceScope?.outsideScopeComponentKeys).toEqual(
      ['v3'],
    );

    const contradicted = farStop({
      country: 'Fixtureland',
      region: 'Other Province',
    });
    expect(contradicted.accepted).toBe(false);
    expect(contradicted.rejectionReasons).toEqual(['geographic_incoherence']);
    expect(
      contradicted.decisionEntities?.find((entity) => entity.hintKey === 'v3'),
    ).toEqual(
      expect.objectContaining({
        relation: 'offending',
        decisionReason: 'REGION_CONFLICT',
      }),
    );
  });

  it('§P2-18: region diversity among members INSIDE the AREA is not a contradiction (an AREA may straddle a boundary) — REGION_CONFLICT only contradicts the source-named AREA for a member outside it', () => {
    const result = validateWith(
      VALLEY_CANDIDATE,
      [
        VALLEY_ENTITIES[0],
        venueEntity('v1', 43.85, 9.9, {
          country: 'Fixtureland',
          region: 'North',
        }),
        venueEntity('v2', 43.95, 10.05, {
          country: 'Fixtureland',
          region: 'South',
        }),
        VALLEY_VENUES[2],
      ],
      { authorization: ownedAuthorization('route_like') },
    );

    expect(result.accepted).toBe(true);
    expect(result.experienceScope?.outsideScopeComponentKeys).toBeUndefined();
  });

  it('§P2-18 E (amended PD2): the same venues WITHOUT a verified AREA are a source-defined composition — no circle, no polygon, no UNKNOWN for a missing AREA', () => {
    const result = validateWith(
      candidateOf('Fixture Valley itinerary', [
        hint('v1', 'Estate One'),
        hint('v2', 'Estate Two'),
        hint('v3', 'Estate Three'),
      ]),
      VALLEY_VENUES,
      { authorization: ownedAuthorization('route_like') },
    );

    expect(result.accepted).toBe(true);
    expect(result.experienceScope).toEqual({
      kind: 'SOURCE_DEFINED_COMPONENTS',
      provenance: 'SOURCE_COMPOSITION',
      membership: 'DESCRIPTIVE',
      supportingEvidenceKeys: ['ev-1'],
    });
    expect(result.destinationRelation?.relation).toBe('OUTSIDE_DESTINATION');
  });

  it.each([
    ['DEFAULT', undefined],
    [
      'WALK (I: WALK never borrows ROUTE_LIKE authority)',
      ownedAuthorization('walk', 'AREA_ROUTE_WALK'),
    ],
  ])(
    '%s: a candidate-owned AREA beyond the destination is not admissible -> GEOGRAPHIC_SCOPE_UNKNOWN',
    (_label, authorization) => {
      const result = validateWith(VALLEY_CANDIDATE, VALLEY_ENTITIES, {
        authorization,
      });
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['geographic_scope_unknown']);
      expect(result.experienceScope).toEqual({
        kind: 'UNKNOWN',
        unknownReason: 'SCOPE_BEYOND_DESTINATION_NOT_AUTHORIZED',
        destinationRelation: 'OUTSIDE',
      });
    },
  );

  it('F: a candidate scope conflicting with an explicit user-selected anchor scope is REJECTED (the anchor is a conjunction, never replaced)', () => {
    const userAnchor: WorkUnitAnchorScope = {
      kind: 'AREA',
      anchorName: 'Old Town',
      geoEntityId: 'geo-old-town',
      geometry: square(10, 45, 0.01),
    };
    const result = validateWith(VALLEY_CANDIDATE, VALLEY_ENTITIES, {
      authorization: ownedAuthorization('route_like', 'AREA_ROUTE_WALK'),
      workUnitScope: userAnchor,
    });
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toEqual(['external_scope_mismatch']);
  });

  it('a user-named regional AREA anchor acts as the Experience scope for a ROUTE_LIKE unit; a WALK unit cannot use it', () => {
    const regionalAnchor: WorkUnitAnchorScope = {
      kind: 'AREA',
      anchorName: 'Fixture Valley',
      geoEntityId: 'geo-valley',
      geometry: FIXTURE_VALLEY_GEOMETRY,
    };
    const candidate = candidateOf('Valley wineries', [
      hint('v1', 'Estate One'),
      hint('v2', 'Estate Two'),
    ]);
    const routeLike = validateWith(candidate, VALLEY_VENUES.slice(0, 2), {
      authorization: ownedAuthorization('route_like', 'AREA_ROUTE_WALK'),
      workUnitScope: regionalAnchor,
    });
    expect(routeLike.accepted).toBe(true);
    expect(routeLike.experienceScope?.provenance).toBe('WORK_UNIT_ANCHOR');

    const walk = validateWith(candidate, VALLEY_VENUES.slice(0, 2), {
      authorization: ownedAuthorization('walk', 'AREA_ROUTE_WALK'),
      workUnitScope: regionalAnchor,
    });
    expect(walk.accepted).toBe(false);
    expect(walk.rejectionReasons).toEqual(['geographic_scope_unknown']);
  });

  it('D (destination-local twin): a DEFAULT candidate fully inside the destination keeps S-d and relation WITHIN', () => {
    const result = validateWith(
      candidateOf('City pair', [hint('a', 'A'), hint('b', 'B')]),
      [venueEntity('a', 45.01, 10.01), venueEntity('b', 44.98, 9.97)],
    );
    expect(result.accepted).toBe(true);
    expect(result.experienceScope?.provenance).toBe('DESTINATION_AREA');
    expect(result.destinationRelation?.relation).toBe('WITHIN_DESTINATION');
  });
});

// --- Case L: the real COLD #11 Uco composition. ---
const CIUDAD_DE_MENDOZA_FIXTURE: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: {
    id: 'osm:relation:4206710',
    name: 'Ciudad de Mendoza',
    osmType: 'relation',
    osmId: 4206710,
    tags: { boundary: 'administrative', admin_level: '6' },
    geometry: square(-68.85, -32.89, 0.05),
  },
};
// Characterized coordinates (Overture/OSM, identity-characterization/overture).
const UCO_VENUES = [
  venueEntity('alfa-crux', -33.8040574593, -69.119154850671),
  venueEntity('superuco', -33.60353978, -69.22870399),
  venueEntity('bodega-azul', -33.46941806, -69.22094381),
];
// FIXTURE polygon of a "Valle de Uco"-class AREA (no real canonical polygon
// exists in current providers).
const UCO_AREA_FIXTURE: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-69.45, -33.95],
      [-68.95, -33.95],
      [-68.95, -33.3],
      [-69.45, -33.3],
      [-69.45, -33.95],
    ],
  ],
};

describe('Part II geographic scope — Uco regression (case L)', () => {
  it('D: Alfa Crux lies > 80 km from the destination centroid -- the deleted circle would have rejected it', () => {
    const alfa = UCO_VENUES[0];
    expect(
      distanceMeters(
        { latitude: -32.89, longitude: -68.85 },
        { latitude: alfa.latitude!, longitude: alfa.longitude! },
      ),
    ).toBeGreaterThan(100_000);
  });

  it('(i) without a source-backed AREA (the real COLD #11 extraction): GEOGRAPHICALLY valid as a source-defined composition IF its identities were verified (fixture coordinates; the real identities are not)', () => {
    const result = validateWith(
      candidateOf('Uco Valley Wine Tasting Itinerary', [
        hint('alfa-crux', 'Alfa Crux'),
        hint('superuco', 'SuperUco'),
        hint('bodega-azul', 'Bodega Azul'),
      ]),
      UCO_VENUES,
      {
        destination: CIUDAD_DE_MENDOZA_FIXTURE,
        authorization: ownedAuthorization('route_like'),
      },
    );
    expect(result.accepted).toBe(true);
    expect(result.experienceScope?.kind).toBe('SOURCE_DEFINED_COMPONENTS');
    expect(result.destinationRelation?.relation).toBe('OUTSIDE_DESTINATION');
  });

  it('(ii) with a verified source-backed AREA (fixture polygon): accepted under S-b, never via a radius', () => {
    const result = validateWith(
      candidateOf('Uco Valley Wine Tasting Itinerary', [
        hint('valle-de-uco', 'Valle de Uco', 'area'),
        hint('alfa-crux', 'Alfa Crux'),
        hint('superuco', 'SuperUco'),
        hint('bodega-azul', 'Bodega Azul'),
      ]),
      [
        areaEntity('valle-de-uco', UCO_AREA_FIXTURE, -33.6, -69.2),
        ...UCO_VENUES,
      ],
      {
        destination: CIUDAD_DE_MENDOZA_FIXTURE,
        authorization: ownedAuthorization('route_like'),
      },
    );
    expect(result.accepted).toBe(true);
    expect(result.experienceScope?.provenance).toBe('CANDIDATE_AREA');
    expect(result.destinationRelation?.relation).toBe('OUTSIDE_DESTINATION');
  });
});

// --- S2: source-backed scope extraction (cases A, B). ---
// The real COLD #11 SolSalute evidence excerpt (unaltered).
const SOLSALUTE_EXCERPT = [
  '### Uco Valley Itinerary',
  '',
  'If I were to plan a wine tasting in Valle de Uco Itinerary for a friend, this is the day I’d schedule for them.',
  '',
  '1. [Alfa Crux](https://www.agostinowinegroup.com/alfa-crux-wines) – 10 am – This winery is the furthest, so start here and work your way back up.',
  '2. [SuperUco](https://superuco.com/) – 12 pm – It will take you 40 minutes to drive here from Alfa Crux so you’ll need to schedule SuperUco for no earlier than noon.',
  '4. [Bodega Azul](https://bodegalaazul.com/) – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here, so sit back and enjoy the meal.',
].join('\n');

const UCO_VENUE_HINTS = [
  {
    key: 'alfa-crux',
    name: 'Alfa Crux',
    role: 'venue',
    expectedKind: 'PLACE',
    evidenceKeys: ['ev-1'],
    supportSpan:
      '1. Alfa Crux – 10 am – This winery is the furthest, so start here and work your way back up.',
  },
  {
    key: 'superuco',
    name: 'SuperUco',
    role: 'venue',
    expectedKind: 'PLACE',
    evidenceKeys: ['ev-1'],
    supportSpan:
      '2. SuperUco – 12 pm – It will take you 40 minutes to drive here from Alfa Crux so you’ll need to schedule SuperUco for no earlier than noon.',
  },
  {
    key: 'bodega-azul',
    name: 'Bodega Azul',
    role: 'venue',
    expectedKind: 'PLACE',
    evidenceKeys: ['ev-1'],
    supportSpan:
      '4. Bodega Azul – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here, so sit back and enjoy the meal.',
  },
];

const extractUco = (areaHint: Record<string, unknown>) =>
  extractExperienceCandidates(
    {
      candidates: [
        {
          name: 'Uco Valley Wine Tasting Itinerary',
          themes: ['wine'],
          traits: [],
          intents: ['route_like'],
          componentHints: [areaHint, ...UCO_VENUE_HINTS],
          evidenceKeys: ['ev-1'],
          shortReason: 'itinerary',
          orderedByEvidence: true,
        },
      ],
    },
    [
      {
        key: 'ev-1',
        title: 'The Best Wineries in Mendoza for 2025',
        text: SOLSALUTE_EXCERPT,
      },
    ],
    8,
  );

describe('Part II geographic scope — source-backed scope extraction (S2)', () => {
  it('A: the real source names "Valle de Uco" for this itinerary -> the AREA hint is emitted and retains its verified source span', () => {
    const result = extractUco({
      key: 'valle-de-uco',
      name: 'Valle de Uco',
      role: 'area',
      expectedKind: 'AREA',
      evidenceKeys: ['ev-1'],
      supportSpan:
        'If I were to plan a wine tasting in Valle de Uco Itinerary for a friend',
    });

    expect(result.candidates).toHaveLength(1);
    expect(
      result.candidates[0].componentHints.find((h) => h.role === 'area'),
    ).toEqual(expect.objectContaining({ name: 'Valle de Uco' }));
    const audit = result.sourceSupportAudits[0].components.find(
      (component) => component.role === 'area',
    );
    expect(audit).toEqual(
      expect.objectContaining({
        status: 'SUPPORTED',
        verifiedSupportSpan: expect.stringContaining('Valle de Uco'),
      }),
    );
  });

  it('B: a span that only lists the venues never authorizes a region -> no AREA authority (SCOPE_NAME_NOT_IN_SUPPORT_SPAN)', () => {
    const result = extractUco({
      key: 'valle-de-uco',
      name: 'Valle de Uco',
      role: 'area',
      expectedKind: 'AREA',
      evidenceKeys: ['ev-1'],
      supportSpan: UCO_VENUE_HINTS[0].supportSpan,
    });

    expect(result.candidates).toHaveLength(0);
    expect(
      result.sourceSupportAudits[0].components.find(
        (component) => component.role === 'area',
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'UNSUPPORTED',
        reason: 'SCOPE_NAME_NOT_IN_SUPPORT_SPAN',
      }),
    );
  });

  it('B: the generated Experience title is not source evidence -> the area hint cannot be verified', () => {
    const result = extractUco({
      key: 'uco-valley',
      name: 'Uco Valley',
      role: 'area',
      expectedKind: 'AREA',
      evidenceKeys: ['ev-1'],
      supportSpan: 'Uco Valley Wine Tasting Itinerary',
    });

    expect(result.candidates).toHaveLength(0);
    expect(
      result.sourceSupportAudits[0].components.find(
        (component) => component.role === 'area',
      )?.status,
    ).toBe('UNSUPPORTED');
  });
});

// --- S2/S3: two-phase resolution and scope-derived identity search. ---
function buildResolver(options: {
  nominatimByQuery: Record<string, any[]>;
  boundary?: any;
  placesByQuery?: Record<string, any[]>;
}) {
  const osmPlaces = {
    lookupPoisWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupBoundaryById: jest
      .fn()
      .mockResolvedValue(
        options.boundary
          ? { status: 'success', value: options.boundary }
          : { status: 'success', value: undefined },
      ),
    lookupHighwaysByName: jest.fn(),
  };
  const catalog = {
    findGeoEntityCandidatesForHint: jest
      .fn()
      .mockResolvedValue({ candidates: [] }),
    rememberVerifiedHintName: jest.fn().mockResolvedValue('REMEMBERED'),
    findGeoEntityIdsByIdentities: jest.fn().mockResolvedValue([]),
    upsertGeoEntityWithIdentities: jest.fn().mockResolvedValue({
      status: 'CREATED',
      geoEntity: { id: 'geo-valley' },
      attachedExternalIds: [],
    }),
    upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-valley' }),
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    persistVerifiedExperience: jest.fn(),
  };
  const nominatim = {
    search: jest.fn(
      async (query: string) => options.nominatimByQuery[query] ?? [],
    ),
  };
  const placesApi = {
    provider: 'geoapify' as const,
    declaresSourceIdentitiesInDetails: false,
    getStatus: jest.fn(),
    searchNearby: jest.fn(),
    searchText: jest.fn(async ({ textQuery }: PlacesSearchTextParams) => ({
      data: options.placesByQuery?.[textQuery] ?? [],
      provenance: {
        provider: 'geoapify',
        cacheStatus: 'miss-live',
        requestedCount: 10,
        receivedCount: 0,
      },
    })),
    getPlaceDetails: jest.fn(),
  };
  const validator = {
    validate: jest
      .fn()
      .mockReturnValue({ accepted: false, rejectionReasons: ['x'] }),
  };
  const service = new ExperienceProposalResolverService(
    osmPlaces as any,
    catalog as any,
    validator as any,
    undefined,
    nominatim as any,
    placesApi as any,
  );
  return { service, nominatim, placesApi, osmPlaces };
}

const VALLEY_BOUNDARY = {
  id: 'osm:relation:900',
  name: 'Fixture Valley',
  osmType: 'relation',
  osmId: 900,
  tags: { boundary: 'administrative', admin_level: '8' },
  geometry: FIXTURE_VALLEY_GEOMETRY,
};
const valleyNominatimResult = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});
const placeAt = (
  id: string,
  name: string,
  latitude: number,
  longitude: number,
) => ({
  id,
  name,
  displayName: { text: name },
  location: { latitude, longitude },
  types: [] as string[],
  featureClass: 'point_of_interest' as const,
});
const resolveValley = (
  service: ExperienceProposalResolverService,
  authorization = ownedAuthorization('route_like'),
) =>
  service.resolve({
    destinationName: 'Fixture City',
    destinationCountryCode: 'FX',
    geographicScope: FIXTURE_CITY,
    candidates: [
      {
        candidate: candidateOf('Fixture Valley itinerary', [
          hint('valley', 'Fixture Valley', 'area'),
          hint('v1', 'Estate One'),
          hint('v2', 'Estate Two'),
        ]),
        geographicAuthorization: authorization,
      },
    ],
    evidence: [
      {
        key: 'ev-1',
        source: 'web',
        title: 'Fixture City wine guide',
        snippet:
          'From Fixture City, explore Fixture Valley: Estate One, then Estate Two.',
      },
    ],
  });

describe('Part II geographic scope — two-phase resolution & identity search (S2/S3)', () => {
  it('A/J: phase 1 resolves the AREA within the COUNTRY (no radius bias); phase 2 searches venues with the AREA-derived window and admits them by AREA membership ~120 km from the destination', async () => {
    const { service, nominatim, placesApi } = buildResolver({
      nominatimByQuery: { 'Fixture Valley': [valleyNominatimResult()] },
      boundary: VALLEY_BOUNDARY,
      placesByQuery: {
        'Estate One': [placeAt('p1', 'Estate One', 43.85, 9.9)],
        'Estate Two': [placeAt('p2', 'Estate Two', 43.95, 10.05)],
      },
    });

    const result = await resolveValley(service);

    // Phase 1: country-bounded, never destination- or radius-biased.
    expect(nominatim.search).toHaveBeenCalledWith('Fixture Valley', {
      countryCode: 'FX',
    });
    const audit = result.entityResolution.forensicAudit[0];
    expect(audit.componentSearchScope).toEqual(
      expect.objectContaining({
        kind: 'AREA',
        provenance: 'CANDIDATE_AREA',
        destinationRelation: 'OUTSIDE',
      }),
    );
    // Phase 2: the provider window covers the verified AREA, not a
    // destination-centered circle.
    const valleyWindow = scopeSearchWindow({
      kind: 'AREA',
      provenance: 'CANDIDATE_AREA',
      geometry: FIXTURE_VALLEY_GEOMETRY,
    })!;
    for (const name of ['Estate One', 'Estate Two']) {
      const call = placesApi.searchText.mock.calls.find(
        ([params]: any[]) => params.textQuery === name,
      )![0];
      expect(call.locationBias).toEqual({
        center: valleyWindow.center,
        radius: valleyWindow.radiusMeters,
      });
    }
    const venueAttempts = audit.componentAudits
      .filter((component) => component.role === 'venue')
      .map((component) =>
        component.attempts.find((attempt) => attempt.strategy === 'PLACES'),
      );
    for (const attempt of venueAttempts) {
      expect(attempt?.placeSearch).toEqual(
        expect.objectContaining({
          viableCount: 1,
          rejected: [],
          searchWindow: {
            provenance: 'CANDIDATE_AREA',
            radiusMeters: valleyWindow.radiusMeters,
          },
        }),
      );
    }
    // The valley component itself resolved (source order restored).
    expect(audit.componentAudits.map((component) => component.hintKey)).toEqual(
      ['valley', 'v1', 'v2'],
    );
    expect(audit.componentAudits[0].finalStatus).toBe('resolved');
  });

  it('J: a Places venue outside the verified AREA and outside the destination is not admitted — Places has no country bound, and proximity to the AREA never admits it', async () => {
    const { service } = buildResolver({
      nominatimByQuery: { 'Fixture Valley': [valleyNominatimResult()] },
      boundary: VALLEY_BOUNDARY,
      placesByQuery: {
        'Estate One': [placeAt('p1', 'Estate One', 44.4, 10.4)],
      },
    });

    const result = await resolveValley(service);
    const attempt = result.entityResolution.forensicAudit[0].componentAudits
      .find((component) => component.hintKey === 'v1')!
      .attempts.find((a) => a.strategy === 'PLACES');
    expect(attempt?.placeSearch?.rejected).toEqual([
      {
        name: 'Estate One',
        reason: 'DESTINATION_INCOMPATIBLE',
        destinationReason: 'OUTSIDE_DESTINATION_BOUNDARY',
      },
    ]);
  });

  it('C: the source names a region the canonical providers cannot resolve (only homonymous streets) -> no scope; Places venues beyond the destination stay unacquired — an IDENTITY blocker, not GEOGRAPHIC_SCOPE_UNKNOWN', async () => {
    const { service, placesApi } = buildResolver({
      // The real "Valle de Uco" Nominatim shape: residential streets only.
      nominatimByQuery: {
        'Fixture Valley': [
          valleyNominatimResult({
            osmType: 'way',
            osmId: 1,
            class: 'highway',
            type: 'residential',
            addresstype: 'road',
            placeRank: 26,
          }),
        ],
      },
      placesByQuery: {
        'Estate One': [placeAt('p1', 'Estate One', 43.85, 9.9)],
        'Estate Two': [placeAt('p2', 'Estate Two', 43.95, 10.05)],
      },
    });

    const result = await resolveValley(service);
    const audit = result.entityResolution.forensicAudit[0];
    expect(audit.componentAudits[0].finalStatus).toBe('unresolved');
    expect(audit.componentSearchScope?.provenance).toBe('DESTINATION_AREA');
    const destinationWindow = geographicScopeSearchWindow(
      FIXTURE_CITY,
      'DESTINATION_AREA',
    )!;
    expect(
      placesApi.searchText.mock.calls.find(
        ([params]: any[]) => params.textQuery === 'Estate One',
      )![0].locationBias,
    ).toEqual({
      center: destinationWindow.center,
      radius: destinationWindow.radiusMeters,
    });
    expect(result.resolved[0].status).toBe('rejected');
    // Per-component identity reasons (nothing resolved); no geographic
    // scope verdict substitutes for the missing identities.
    expect(result.resolved[0].rejectionReasons).toEqual([
      'UNCONFIRMED_MATCH',
      'OSM_QUERY_EMPTY',
    ]);
  });

  it('coarse-AREA guard: an administrative unit coarser than the destination is never one Experience scope', async () => {
    const { service } = buildResolver({
      nominatimByQuery: { 'Fixture Valley': [valleyNominatimResult()] },
      boundary: { ...VALLEY_BOUNDARY, tags: { admin_level: '4' } },
    });

    const result = await resolveValley(service);
    const valley = result.entityResolution.forensicAudit[0].componentAudits[0];
    expect(valley.finalStatus).toBe('unresolved');
    expect(
      valley.attempts.find((a) => a.strategy === 'NOMINATIM')
        ?.destinationCompatibility?.reason,
    ).toBe('CANDIDATE_COARSER_THAN_DESTINATION');
  });

  it('coarse-AREA guard: a state/region-scale result is never area-scale (existing canonical rank band)', async () => {
    const { service } = buildResolver({
      nominatimByQuery: {
        'Fixture Valley': [valleyNominatimResult({ placeRank: 8 })],
      },
      boundary: VALLEY_BOUNDARY,
    });

    const result = await resolveValley(service);
    expect(
      result.entityResolution.forensicAudit[0].componentAudits[0].finalStatus,
    ).toBe('unresolved');
  });

  it('I: a WALK candidate never gets a country-bounded regional AREA search -- the AREA answers to the destination', async () => {
    const { service, nominatim } = buildResolver({
      nominatimByQuery: { 'Fixture Valley': [valleyNominatimResult()] },
      boundary: VALLEY_BOUNDARY,
    });

    const result = await resolveValley(
      service,
      ownedAuthorization('walk', 'AREA_ROUTE_WALK'),
    );
    expect(nominatim.search).toHaveBeenCalledWith(
      'Fixture Valley',
      expect.objectContaining({ bias: expect.any(Object) }),
    );
    const valley = result.entityResolution.forensicAudit[0].componentAudits[0];
    expect(valley.finalStatus).toBe('unresolved');
    expect(
      valley.attempts.find((a) => a.strategy === 'NOMINATIM')
        ?.destinationCompatibility,
    ).toEqual({
      verdict: 'INCOMPATIBLE',
      reason: 'OUTSIDE_DESTINATION_BOUNDARY',
    });
  });
});
