import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';
import {
  GeographicScope,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { WorkUnitAnchorScope } from '../interfaces/experience-geographic-scope.interface';
import { GeographicValidationAuthorization } from '../interfaces/geographic-validation-authorization.interface';
import { ownedAuthorization } from '../fixtures/geographic-authorization.fixture';
import {
  admitComponentLocation,
  mayExtendBeyondDestination,
  scopeMembershipSemantics,
} from '../utils/experience-geographic-scope.policy';
import { evaluateSourceCompositionSupport } from '../utils/source-composition-support.policy';
import { extractExperienceCandidates } from '../utils/experience-candidate-extraction.util';

/**
 * Spec 2026-10-02 Part II §P2-18 — source-grounded tourism geography.
 * Scenario matrix A–K (RW4 strict-scope revision), deterministic.
 *
 * Every scenario runs over two unrelated synthetic worlds (K: generic
 * portability — different hemisphere, country, region shape and POI
 * category). No production code may know either world.
 *
 * Questions kept apart: IDENTITY (resolver + IdentityVerifier), SOURCE
 * COMPOSITION (one supporting record), GEOGRAPHIC DESCRIPTION (facts),
 * STRICT CONSTRAINT (user anchor / destination ceiling), TRIP FEASIBILITY
 * (not judged here).
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

interface World {
  label: string;
  countryCode: string;
  countryName: string;
  theme: string;
  destinationName: string;
  destination: GeographicScope;
  destinationCenter: { latitude: number; longitude: number };
  /** A user-selectable neighbourhood INSIDE the destination. */
  oldQuarter: GeoJsonGeometry;
  regionName: string;
  region: GeoJsonGeometry;
  regionCenter: { latitude: number; longitude: number };
  /** Three points inside the region (beyond the destination). */
  inside: Array<{ latitude: number; longitude: number }>;
  /** ~200 m and ~1.1 km south of the region's southern edge. */
  justOutside200m: { latitude: number; longitude: number };
  justOutside1km: { latitude: number; longitude: number };
  /** Far outside the region, two very different distances (no cliff). */
  farOutside: Array<{ latitude: number; longitude: number }>;
  poiNames: [string, string, string];
}

const worldOf = (input: {
  label: string;
  countryCode: string;
  countryName: string;
  theme: string;
  destinationName: string;
  destinationCenter: [number, number];
  regionName: string;
  regionCenter: [number, number];
  poiNames: [string, string, string];
}): World => {
  const [dLat, dLng] = input.destinationCenter;
  const [rLat, rLng] = input.regionCenter;
  const half = 0.25;
  return {
    label: input.label,
    countryCode: input.countryCode,
    countryName: input.countryName,
    theme: input.theme,
    destinationName: input.destinationName,
    destination: {
      kind: 'AREA_BOUNDARY',
      boundary: {
        id: `osm:relation:${input.countryCode}-1`,
        name: input.destinationName,
        osmType: 'relation',
        osmId: 1,
        tags: { boundary: 'administrative', admin_level: '8' },
        geometry: square(dLng, dLat, 0.05),
      },
    },
    destinationCenter: { latitude: dLat, longitude: dLng },
    oldQuarter: square(dLng, dLat, 0.01),
    regionName: input.regionName,
    region: square(rLng, rLat, half),
    regionCenter: { latitude: rLat, longitude: rLng },
    inside: [
      { latitude: rLat - 0.07, longitude: rLng - 0.1 },
      { latitude: rLat + 0.03, longitude: rLng + 0.05 },
      { latitude: rLat + 0.13, longitude: rLng + 0.1 },
    ],
    justOutside200m: { latitude: rLat - half - 0.0018, longitude: rLng },
    justOutside1km: { latitude: rLat - half - 0.01, longitude: rLng },
    farOutside: [
      { latitude: rLat - 2.5, longitude: rLng + 2 },
      { latitude: rLat - 9, longitude: rLng + 7 },
    ],
    poiNames: input.poiNames,
  };
};

const WORLDS: World[] = [
  worldOf({
    label: 'Fixtureland valley estates',
    countryCode: 'FX',
    countryName: 'Fixtureland',
    theme: 'wine',
    destinationName: 'Fixture City',
    destinationCenter: [45, 10],
    regionName: 'Fixture Valley',
    regionCenter: [43.92, 10],
    poiNames: ['Estate One', 'Estate Two', 'Estate Three'],
  }),
  worldOf({
    label: 'Harborland coastal lighthouses',
    countryCode: 'HB',
    countryName: 'Harborland',
    theme: 'nature',
    destinationName: 'Harbor Town',
    destinationCenter: [-20, -120],
    regionName: 'Cliff Coast',
    regionCenter: [-21.2, -121],
    poiNames: ['North Light', 'Gull Point Light', 'Seal Rock Light'],
  }),
];

const hint = (
  key: string,
  name: string,
  role: 'area' | 'venue' | 'waypoint' | 'route' = 'venue',
  evidenceKeys: string[] = ['ev-1'],
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
  evidenceKeys,
});

const candidateOf = (
  world: World,
  componentHints: ReturnType<typeof hint>[],
): ExperienceCandidate => ({
  name: `${world.regionName} itinerary`,
  themes: [world.theme],
  traits: [],
  intents: ['route_like'],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed itinerary',
  componentHints,
});

const venue = (
  key: string,
  at: { latitude: number; longitude: number },
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
  latitude: at.latitude,
  longitude: at.longitude,
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' },
  ...(adminContext ? { adminContext } : {}),
});

const regionEntity = (world: World): ResolvedGeoEntity => ({
  hintKey: 'region',
  hintName: world.regionName,
  canonicalName: world.regionName,
  provider: 'openstreetmap',
  externalId: 'osm:relation:region',
  geoEntityId: 'geo-region',
  role: 'area',
  kind: GeoEntityKind.AREA,
  status: 'resolved',
  latitude: world.regionCenter.latitude,
  longitude: world.regionCenter.longitude,
  geometry: world.region,
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' },
});

const validate = (
  world: World,
  candidate: ExperienceCandidate,
  entities: ResolvedGeoEntity[],
  options: {
    authorization?: GeographicValidationAuthorization;
    workUnitScope?: WorkUnitAnchorScope;
  } = {},
) =>
  new CompositeGeographicValidationService().validate(
    {
      candidate,
      status: 'accepted',
      resolvedEntities: entities,
      rejectionReasons: [],
    },
    world.destination.kind === 'AREA_BOUNDARY'
      ? world.destination.boundary
      : undefined,
    options.workUnitScope,
    options.authorization ?? ownedAuthorization('route_like'),
    world.destination,
  );

/** A source-named region + the three POIs; positions per test. */
const regionalComposition = (world: World) =>
  candidateOf(world, [
    hint('region', world.regionName, 'area'),
    hint('a', world.poiNames[0]),
    hint('b', world.poiNames[1]),
    hint('c', world.poiNames[2]),
  ]);
/** The same POIs with NO area hint (no enclosing canonical geometry). */
const plainComposition = (world: World) =>
  candidateOf(world, [
    hint('a', world.poiNames[0]),
    hint('b', world.poiNames[1]),
    hint('c', world.poiNames[2]),
  ]);

describe.each(WORLDS)('§P2-18 source-grounded geography — $label', (world) => {
  const [p1, p2, p3] = world.inside;

  it('A: descriptive region, every component inside it: accepted with verified source composition and identities', () => {
    const result = validate(world, regionalComposition(world), [
      regionEntity(world),
      venue('a', p1),
      venue('b', p2),
      venue('c', p3),
    ]);
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('canonical_area');
    expect(result.experienceScope).toEqual(
      expect.objectContaining({
        provenance: 'CANDIDATE_AREA',
        membership: 'DESCRIPTIVE',
      }),
    );
    expect(result.experienceScope?.outsideScopeComponentKeys).toBeUndefined();
  });

  it.each([
    ['~200 m', 'justOutside200m'],
    ['~1 km', 'justOutside1km'],
  ] as const)(
    'B: descriptive region, a component %s outside its polygon: NOT rejected for the polygon mismatch — recorded as a fact',
    (_label, key) => {
      const result = validate(world, regionalComposition(world), [
        regionEntity(world),
        venue('a', p1),
        venue('b', p2),
        venue('c', world[key]),
      ]);
      expect(result.accepted).toBe(true);
      expect(result.experienceScope?.outsideScopeComponentKeys).toEqual(['c']);
      expect(result.rejectionReasons).toEqual([]);
    },
  );

  describe('C: descriptive region, a component substantially outside it', () => {
    it('is not decided by a numeric cutoff: with one supporting record and no contradiction, two very different distances give the SAME verdict (fact recorded)', () => {
      const verdicts = world.farOutside.map((far) =>
        validate(world, regionalComposition(world), [
          regionEntity(world),
          venue('a', p1),
          venue('b', p2),
          venue('c', far),
        ]),
      );
      for (const result of verdicts) {
        expect(result.accepted).toBe(true);
        expect(result.experienceScope?.outsideScopeComponentKeys).toEqual([
          'c',
        ]);
      }
    });

    it('is REJECTED when authoritative evidence contradicts the source claim: its verified region differs from the region the members inside the AREA establish (REGION_CONFLICT)', () => {
      const admin = (region: string) => ({
        country: world.countryName,
        region,
      });
      const result = validate(world, regionalComposition(world), [
        regionEntity(world),
        venue('a', p1, admin('Valley Province')),
        venue('b', p2, admin('Valley Province')),
        venue('c', world.farOutside[0], admin('Another Province')),
      ]);
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['geographic_incoherence']);
      expect(
        result.decisionEntities?.find((entity) => entity.hintKey === 'c'),
      ).toEqual(
        expect.objectContaining({
          relation: 'offending',
          decisionReason: 'REGION_CONFLICT',
        }),
      );
    });

    it('is REJECTED when it lies in another country (COUNTRY_CONFLICT)', () => {
      const result = validate(world, regionalComposition(world), [
        regionEntity(world),
        venue('a', p1, { country: world.countryName }),
        venue('b', p2, { country: world.countryName }),
        venue('c', world.farOutside[0], { country: 'Elsewhere' }),
      ]);
      expect(result.accepted).toBe(false);
      expect(
        result.decisionEntities?.find(
          (entity) => entity.relation === 'offending',
        )?.decisionReason,
      ).toBe('COUNTRY_CONFLICT');
    });

    it('is REJECTED when the same far member is supported only by a different source record (unsupported union)', () => {
      const candidate = candidateOf(world, [
        hint('region', world.regionName, 'area'),
        hint('a', world.poiNames[0]),
        hint('b', world.poiNames[1]),
        hint('c', world.poiNames[2], 'venue', ['ev-2']),
      ]);
      const result = validate(world, candidate, [
        regionEntity(world),
        venue('a', p1),
        venue('b', p2),
        venue('c', world.farOutside[0]),
      ]);
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual([
        'source_composition_unsupported',
      ]);
    });
  });

  describe('D: an explicit STRICT boundary', () => {
    it('a user-named regional AREA anchor (ROUTE_LIKE unit) rejects a component ~1 km outside it — strict containment, boundary distance recorded as evidence only', () => {
      const anchor: WorkUnitAnchorScope = {
        kind: 'AREA',
        anchorName: world.regionName,
        geoEntityId: 'geo-region',
        geometry: world.region,
      };
      const result = validate(
        world,
        plainComposition(world),
        [venue('a', p1), venue('b', p2), venue('c', world.justOutside1km)],
        {
          authorization: ownedAuthorization('route_like', 'AREA_ROUTE_WALK'),
          workUnitScope: anchor,
        },
      );
      expect(result.accepted).toBe(false);
      expect(result.experienceScope).toEqual(
        expect.objectContaining({
          provenance: 'WORK_UNIT_ANCHOR',
          membership: 'STRICT',
        }),
      );
      const offending = result.decisionEntities?.find(
        (entity) => entity.hintKey === 'c',
      );
      expect(offending?.decisionReason).toBe('OUTSIDE_CANONICAL_AREA_BOUNDARY');
      expect(offending?.distanceToBoundaryMeters).toBeGreaterThan(0);
    });

    it('a user-named in-destination AREA anchor (DEFAULT containment) rejects a component outside it even though it is inside the destination', () => {
      const anchor: WorkUnitAnchorScope = {
        kind: 'AREA',
        anchorName: 'Old Quarter',
        geoEntityId: 'geo-old-quarter',
        geometry: world.oldQuarter,
      };
      const center = world.destinationCenter;
      const insideQuarter = center;
      const result = validate(
        world,
        candidateOf(world, [hint('a', 'Quarter A'), hint('b', 'Quarter B')]),
        [
          venue('a', insideQuarter),
          // Inside the destination, outside the user-selected quarter.
          venue('b', {
            latitude: center.latitude + 0.04,
            longitude: center.longitude - 0.04,
          }),
        ],
        { authorization: { kind: 'DEFAULT' }, workUnitScope: anchor },
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['external_scope_mismatch']);
    });
  });

  it('E: source-defined composition with NO AREA polygon: geographically valid on its verified component geography; nothing masquerades as a polygon', () => {
    const result = validate(world, plainComposition(world), [
      venue('a', p1),
      venue('b', p2),
      venue('c', world.justOutside1km),
    ]);
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('source_defined_components');
    expect(result.experienceScope).toEqual({
      kind: 'SOURCE_DEFINED_COMPONENTS',
      provenance: 'SOURCE_COMPOSITION',
      membership: 'DESCRIPTIVE',
      supportingEvidenceKeys: ['ev-1'],
    });
    expect(result.experienceScope).not.toHaveProperty('geoEntityId');
    expect(result.destinationRelation?.relation).toBe('OUTSIDE_DESTINATION');
  });

  describe('F: fake compositions stay rejected', () => {
    it('different source records (variants) joined into one candidate: rejected, however close the stops are', () => {
      const candidate = candidateOf(world, [
        hint('a', world.poiNames[0], 'venue', ['ev-1']),
        hint('b', world.poiNames[1], 'venue', ['ev-2']),
      ]);
      expect(evaluateSourceCompositionSupport(candidate)).toEqual({
        supported: false,
        reason: 'NO_SINGLE_SOURCE_RECORD_SUPPORTS_ALL_MEMBERS',
      });
      const result = validate(world, candidate, [
        venue('a', p1),
        venue('b', p2),
      ]);
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual([
        'source_composition_unsupported',
      ]);
    });

    it('a component the extractor joined without source support never reaches the composition (deterministic source-support gate)', () => {
      const extraction = extractExperienceCandidates(
        {
          candidates: [
            {
              name: `${world.regionName} itinerary`,
              themes: [world.theme],
              traits: [],
              intents: ['route_like'],
              evidenceKeys: ['ev-1'],
              shortReason: 'itinerary',
              orderedByEvidence: false,
              componentHints: [
                {
                  ...hint('a', world.poiNames[0]),
                  supportSpan: `Start at ${world.poiNames[0]}`,
                },
                {
                  ...hint('b', world.poiNames[1]),
                  supportSpan: `then ${world.poiNames[1]}`,
                },
                {
                  // Not in the evidence: an LLM-added stop.
                  ...hint('c', world.poiNames[2]),
                  supportSpan: `and finally ${world.poiNames[2]}`,
                },
              ],
            },
          ],
        },
        [
          {
            key: 'ev-1',
            title: `${world.regionName} day`,
            text: `Start at ${world.poiNames[0]}, then ${world.poiNames[1]}.`,
          },
        ],
        4,
      );
      const names = (extraction.candidates[0]?.componentHints ?? []).map(
        (component) => component.name,
      );
      expect(names).not.toContain(world.poiNames[2]);
    });

    it('an unresolved member keeps the whole composition unpersisted, source-defined or not (identity is a separate blocker)', () => {
      const result = validate(world, plainComposition(world), [
        venue('a', p1),
        venue('b', p2),
      ]);
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual([
        'incomplete_source_composition',
      ]);
    });
  });

  describe('H: work-unit authorization is never bypassed by source-defined composition', () => {
    it('a WALK candidate (no anchor) cannot extend beyond the destination — destination ceiling', () => {
      const result = validate(
        world,
        plainComposition(world),
        [venue('a', p1), venue('b', p2), venue('c', p3)],
        { authorization: ownedAuthorization('walk') },
      );
      expect(result.accepted).toBe(false);
      expect(
        result.decisionEntities?.find(
          (entity) => entity.relation === 'offending',
        )?.decisionReason,
      ).toBe('OUTSIDE_DESTINATION_BOUNDARY');
    });

    it('a DEFAULT candidate cannot either', () => {
      const result = validate(
        world,
        plainComposition(world),
        [venue('a', p1), venue('b', p2), venue('c', p3)],
        { authorization: { kind: 'DEFAULT' } },
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['destination_mismatch']);
    });

    it('a ROUTE_LIKE unit bound by a STRICT in-destination user anchor cannot extend beyond the destination either (anchored, then destination-bounded)', () => {
      const anchor: WorkUnitAnchorScope = {
        kind: 'AREA',
        anchorName: 'Old Quarter',
        geoEntityId: 'geo-old-quarter',
        geometry: world.oldQuarter,
      };
      const quarterCenter = world.destinationCenter;
      const result = validate(
        world,
        candidateOf(world, [hint('a', 'Quarter A'), hint('c', 'Far stop')]),
        [venue('a', quarterCenter), venue('c', p3)],
        {
          authorization: ownedAuthorization('route_like', 'AREA_ROUTE_WALK'),
          workUnitScope: anchor,
        },
      );
      expect(result.accepted).toBe(false);
      expect(
        result.decisionEntities?.find((entity) => entity.hintKey === 'c')
          ?.decisionReason,
      ).toBe('OUTSIDE_DESTINATION_BOUNDARY');
      expect(
        mayExtendBeyondDestination(ownedAuthorization('route_like'), anchor),
      ).toBe(false);
      expect(
        mayExtendBeyondDestination(ownedAuthorization('route_like'), undefined),
      ).toBe(true);
      expect(
        mayExtendBeyondDestination(ownedAuthorization('walk'), undefined),
      ).toBe(false);
    });
  });

  describe('I: a real physical ROUTE — admission and validation use the same authorities', () => {
    const routeLine = (): GeoJsonGeometry => ({
      type: 'LineString',
      coordinates: [
        [world.destinationCenter.longitude, world.destinationCenter.latitude],
        [world.regionCenter.longitude, world.regionCenter.latitude],
      ],
    });
    const routeEntity = (): ResolvedGeoEntity => ({
      hintKey: 'road',
      hintName: 'Coast Road',
      canonicalName: 'Coast Road',
      provider: 'openstreetmap',
      externalId: 'osm:way:road',
      geoEntityId: 'geo-road',
      role: 'route',
      kind: GeoEntityKind.ROUTE,
      status: 'resolved',
      latitude: world.regionCenter.latitude,
      longitude: world.regionCenter.longitude,
      geometry: routeLine(),
      nameEvidenceMultiplicity: {
        exactName: 'SINGLE',
        declaredAlias: 'UNKNOWN',
      },
    });
    const routeScope = () => ({
      kind: 'ROUTE' as const,
      provenance: 'CANDIDATE_ROUTE' as const,
      geoEntityId: 'geo-road',
      geometry: routeLine(),
    });
    const candidate = () =>
      candidateOf(world, [
        hint('road', 'Coast Road', 'route'),
        hint('a', world.poiNames[0]),
      ]);

    it('ROUTE_LIKE: a stop beyond the destination is admissible from a country-bounded provider query and accepted by validation; a provider without a country bound cannot admit it', () => {
      const admitted = admitComponentLocation(
        routeScope(),
        p1,
        world.destination,
        {
          countryBounded: mayExtendBeyondDestination(
            ownedAuthorization('route_like'),
            undefined,
          ),
        },
      );
      const placesLike = admitComponentLocation(
        routeScope(),
        p1,
        world.destination,
      );
      expect(admitted.admitted).toBe(true);
      expect(placesLike).toEqual(
        expect.objectContaining({
          admitted: false,
          reason: 'DESTINATION_INCOMPATIBLE',
        }),
      );
      const result = validate(world, candidate(), [
        routeEntity(),
        venue('a', p1),
      ]);
      expect(result.accepted).toBe(true);
      expect(result.strategy).toBe('canonical_geometry');
      expect(result.experienceScope).toEqual(
        expect.objectContaining({
          provenance: 'CANDIDATE_ROUTE',
          membership: 'DESCRIPTIVE',
        }),
      );
    });

    it('DEFAULT: neither admission nor validation accepts that stop (destination ceiling on both sides)', () => {
      const admitted = admitComponentLocation(
        routeScope(),
        p1,
        world.destination,
        {
          countryBounded: mayExtendBeyondDestination(
            { kind: 'DEFAULT' },
            undefined,
          ),
        },
      );
      expect(admitted.admitted).toBe(false);
      const result = validate(
        world,
        candidate(),
        [routeEntity(), venue('a', p1)],
        {
          authorization: { kind: 'DEFAULT' },
        },
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['destination_mismatch']);
    });

    it('membership semantics are decided by who established the scope, never by distance', () => {
      expect(scopeMembershipSemantics(routeScope(), false)).toBe('DESCRIPTIVE');
      expect(
        scopeMembershipSemantics(
          {
            kind: 'AREA',
            provenance: 'WORK_UNIT_ANCHOR',
            geometry: world.region,
          },
          true,
        ),
      ).toBe('STRICT');
      const destinationScope = {
        kind: 'AREA' as const,
        provenance: 'DESTINATION_AREA' as const,
        geometry: world.region,
      };
      expect(scopeMembershipSemantics(destinationScope, false)).toBe('STRICT');
      expect(scopeMembershipSemantics(destinationScope, true)).toBe(
        'DESCRIPTIVE',
      );
    });
  });

  describe('G: identity acquisition without an enclosing AREA stays bounded and fail-closed', () => {
    const nominatimPlace = (
      name: string,
      at: { latitude: number; longitude: number },
      osmId: number,
    ) => ({
      osmType: 'node',
      osmId,
      addresstype: 'tourism',
      placeRank: 30,
      class: 'tourism',
      type: 'attraction',
      displayName: `${name}, ${world.regionName}, ${world.countryName}`,
      importance: 0.2,
      latitude: at.latitude,
      longitude: at.longitude,
      address: { country: world.countryName },
    });
    const build = (nominatimByQuery: Record<string, unknown[]>) => {
      const nominatim = {
        search: jest.fn(async (query: string) => nominatimByQuery[query] ?? []),
      };
      // Grounds any source-stated locality in the fixture region polygon.
      const localityGrounder = {
        groundLocality: jest.fn(async (assertion: any) => ({
          status: 'GROUNDED' as const,
          assertion,
          boundary: {
            provider: 'openstreetmap' as const,
            externalId: `osm:relation:${world.countryCode}-region`,
            name: world.regionName,
            geometry: world.region,
          },
        })),
      };
      const service = new ExperienceProposalResolverService(
        {
          lookupPoisWithin: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupPoisNear: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupBoundaryById: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: undefined }),
          lookupHighwaysByName: jest.fn(),
        } as any,
        {
          findGeoEntityCandidatesForHint: jest
            .fn()
            .mockResolvedValue({ candidates: [] }),
          rememberVerifiedHintName: jest.fn().mockResolvedValue('REMEMBERED'),
          findGeoEntityIdsByIdentities: jest.fn().mockResolvedValue([]),
          upsertGeoEntityWithIdentities: jest.fn(async (input: any) => ({
            status: 'CREATED',
            geoEntity: { id: `geo-${input.externalId ?? input.name}` },
            attachedExternalIds: [] as string[],
          })),
          upsertGeoEntity: jest.fn(async (input: any) => ({
            id: `geo-${input.externalId ?? input.name}`,
          })),
          resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
          persistVerifiedExperience: jest.fn(),
        } as any,
        {
          validate: jest
            .fn()
            .mockReturnValue({ accepted: false, rejectionReasons: ['x'] }),
        } as any,
        undefined,
        nominatim as any,
        undefined,
        undefined,
        undefined,
        localityGrounder,
      );
      return { service, nominatim };
    };
    // A component the source places "in <region>" (a grounded locality).
    const inRegion = (component: ReturnType<typeof hint>) => ({
      ...component,
      localityAssertion: {
        locality: world.regionName,
        evidenceKey: 'ev-1',
        supportSpan: `${component.name} in ${world.regionName}`,
      },
    });
    const resolve = (
      service: ExperienceProposalResolverService,
      authorization: GeographicValidationAuthorization,
      hints: Array<ReturnType<typeof hint>> = [
        hint('a', world.poiNames[0]),
        hint('b', world.poiNames[1]),
      ],
    ) =>
      service.resolve({
        destinationName: world.destinationName,
        destinationCountryCode: world.countryCode,
        geographicScope: world.destination,
        candidates: [
          {
            candidate: candidateOf(world, hints),
            geographicAuthorization: authorization,
          },
        ],
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            title: `${world.destinationName} day trips`,
            snippet: `From ${world.destinationName}: ${world.poiNames[0]} in ${world.regionName}, then ${world.poiNames[1]} in ${world.regionName}.`,
          },
        ],
      });
    const audit = (result: any, key: string) =>
      result.entityResolution.forensicAudit[0].componentAudits.find(
        (component: any) => component.hintKey === key,
      );

    // Superseded 2026-10-03 (RW4-ID-CORRESPONDENCE-1). This test asserted
    // that a lone exact-name record in the country-bounded response is
    // identity for a component beyond the destination. Country-wide
    // uniqueness is dataset-relative: when the dataset lacks the source's
    // place, its lone record is a homonym (real: Overture's only AR "Ojo de
    // Agua" is a Neuquén cabin; OSM lacks Alfa Crux and SuperUco). The
    // record is still acquired from a country-bounded query; it is not
    // identity without a grounded source geography.
    it('ROUTE_LIKE: a unique exact-name match from the COUNTRY-bounded query beyond the destination is acquired but not identity without a grounded source geography; the query is never global or radius-bounded', async () => {
      const { service, nominatim } = build({
        [world.poiNames[0]]: [nominatimPlace(world.poiNames[0], p1, 1)],
        [world.poiNames[1]]: [nominatimPlace(world.poiNames[1], p2, 2)],
      });
      const result = await resolve(service, ownedAuthorization('route_like'));
      for (const name of world.poiNames.slice(0, 2)) {
        expect(nominatim.search).toHaveBeenCalledWith(
          name,
          expect.objectContaining({ countryCode: world.countryCode }),
        );
      }
      const attempt = audit(result, 'a').attempts.find(
        (candidate: any) => candidate.strategy === 'NOMINATIM',
      );
      expect(attempt.selectedCandidate.externalId).toBe('osm:node:1');
      expect(attempt.identityEvidence).toEqual(
        expect.arrayContaining([
          { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
          {
            type: 'GEOGRAPHIC_CORRESPONDENCE',
            basis: 'ADMISSION_SCOPE_ONLY',
          },
        ]),
      );
      expect(attempt.verificationDecision).toBe('INSUFFICIENT_EVIDENCE');
      expect(audit(result, 'a').finalStatus).toBe('unresolved');
      expect(audit(result, 'b').finalStatus).toBe('unresolved');
      expect(result.resolved[0].status).toBe('rejected');
    });

    it('ROUTE_LIKE: the same match beyond the destination verifies when the source places it in a grounded locality that contains it', async () => {
      const { service } = build({
        [world.poiNames[0]]: [nominatimPlace(world.poiNames[0], p1, 1)],
        [world.poiNames[1]]: [nominatimPlace(world.poiNames[1], p2, 2)],
      });
      const result = await resolve(service, ownedAuthorization('route_like'), [
        inRegion(hint('a', world.poiNames[0])),
        inRegion(hint('b', world.poiNames[1])),
      ]);
      const attempt = audit(result, 'a').attempts.find(
        (candidate: any) => candidate.strategy === 'NOMINATIM',
      );
      expect(attempt.identityEvidence).toContainEqual({
        type: 'GEOGRAPHIC_CORRESPONDENCE',
        basis: 'SOURCE_LOCALITY',
      });
      expect(attempt.verificationDecision).toBe('VERIFIED');
      expect(audit(result, 'a').finalStatus).toBe('resolved');
      expect(audit(result, 'b').finalStatus).toBe('resolved');
    });

    it("ROUTE_LIKE: a lone country-wide match outside the source's grounded locality is REJECTED, never admitted as the component", async () => {
      const { service } = build({
        [world.poiNames[0]]: [
          nominatimPlace(world.poiNames[0], world.farOutside[0], 1),
        ],
        [world.poiNames[1]]: [nominatimPlace(world.poiNames[1], p2, 2)],
      });
      const result = await resolve(service, ownedAuthorization('route_like'), [
        inRegion(hint('a', world.poiNames[0])),
        inRegion(hint('b', world.poiNames[1])),
      ]);
      const attempt = audit(result, 'a').attempts.find(
        (candidate: any) => candidate.strategy === 'NOMINATIM',
      );
      expect(attempt.identityEvidence).toContainEqual(
        expect.objectContaining({
          type: 'IDENTITY_CONTRADICTION',
          fact: 'LOCALITY',
        }),
      );
      expect(attempt.verificationDecision).toBe('REJECTED');
      expect(audit(result, 'a').finalStatus).toBe('unresolved');
    });

    it('DEFAULT: the same country-bounded match beyond the destination is never admitted (authorization ceiling)', async () => {
      const { service } = build({
        [world.poiNames[0]]: [nominatimPlace(world.poiNames[0], p1, 1)],
        [world.poiNames[1]]: [nominatimPlace(world.poiNames[1], p2, 2)],
      });
      const result = await resolve(service, { kind: 'DEFAULT' });
      expect(audit(result, 'a').finalStatus).toBe('unresolved');
      expect(result.resolved[0].status).toBe('rejected');
    });

    it('two same-name homonyms in the country: the source naming the venue is not identity — the component stays unresolved and the composition unpersisted', async () => {
      const { service } = build({
        [world.poiNames[0]]: [
          nominatimPlace(world.poiNames[0], p1, 1),
          nominatimPlace(world.poiNames[0], world.farOutside[1], 11),
        ],
        [world.poiNames[1]]: [nominatimPlace(world.poiNames[1], p2, 2)],
      });
      // b is placed in a grounded locality and verifies; a names two
      // homonyms with nothing stated to tell them apart.
      const result = await resolve(service, ownedAuthorization('route_like'), [
        hint('a', world.poiNames[0]),
        inRegion(hint('b', world.poiNames[1])),
      ]);
      expect(audit(result, 'a').finalStatus).toBe('unresolved');
      expect(audit(result, 'b').finalStatus).toBe('resolved');
      expect(result.resolved[0].status).toBe('rejected');
      expect(result.resolved[0].rejectionReasons).toEqual([
        'INCOMPLETE_SOURCE_COMPOSITION',
      ]);
    });

    it('a provider hit whose name does not match exactly is never identity by itself', async () => {
      const { service } = build({
        [world.poiNames[0]]: [
          nominatimPlace(`${world.poiNames[0]} Visitor Annex`, p1, 1),
        ],
        [world.poiNames[1]]: [nominatimPlace(world.poiNames[1], p2, 2)],
      });
      const result = await resolve(service, ownedAuthorization('route_like'));
      expect(audit(result, 'a').finalStatus).toBe('unresolved');
      expect(result.resolved[0].status).toBe('rejected');
    });
  });
});
