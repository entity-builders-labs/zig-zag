import { GeoEntityKind } from '@prisma/client';
import { ComponentIdentityContext } from '../interfaces/component-identity-context.interface';
import {
  CompetitorPool,
  CompetitorPoolMember,
  EntityCandidate,
} from '../interfaces/experience-resolution.interface';
import { examineCompetitors } from './competitor-examination.policy';

// A simplified square locality: lon -69.2..-68.8, lat -33.4..-33.0.
const LUJAN: ComponentIdentityContext['locality'] = {
  status: 'GROUNDED',
  assertion: {
    locality: 'Lujan de Cuyo',
    evidenceKey: 'ev-1',
    supportSpan: 'Wine and lunch at Ojo de Agua in Lujan de Cuyo',
  },
  boundary: {
    provider: 'openstreetmap',
    externalId: 'osm:relation:1',
    name: 'Departamento Luján de Cuyo',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-69.2, -33.4],
          [-68.8, -33.4],
          [-68.8, -33.0],
          [-69.2, -33.0],
          [-69.2, -33.4],
        ],
      ],
    },
  },
};

const candidate = (
  overrides: Partial<EntityCandidate> = {},
): EntityCandidate => ({
  hintKey: 'hint',
  hintName: 'Ojo de Agua',
  provider: 'openstreetmap',
  externalId: 'osm:node:4797394430',
  canonicalName: 'Ojo de Agua',
  kind: GeoEntityKind.PLACE,
  role: 'venue',
  latitude: -33.13,
  longitude: -68.964,
  nameEvidenceMultiplicity: { exactName: 'UNKNOWN', declaredAlias: 'UNKNOWN' },
  ...overrides,
});

const member = (
  key: string,
  name: string,
  latitude: number,
  longitude: number,
  extra: Partial<CompetitorPoolMember> = {},
): CompetitorPoolMember => ({
  identityKeys: [key],
  name,
  latitude,
  longitude,
  structuralKind: 'POINT_OF_INTEREST',
  ...extra,
});

const RESTAURANT = member(
  'openstreetmap/osm:node:4797394430',
  'Ojo de Agua',
  -33.13,
  -68.964,
);
const CORDOBA_HAMLET = member(
  'openstreetmap/osm:node:198407364',
  'Ojo de Agua',
  -31.217,
  -65.246,
  { structuralKind: 'SETTLEMENT' },
);

const examine = (
  pools: CompetitorPool[],
  options: {
    context?: ComponentIdentityContext;
    entity?: EntityCandidate;
    admits?: (member: CompetitorPoolMember) => boolean;
    expectedKind?: string;
  } = {},
) =>
  examineCompetitors({
    hintName: 'Ojo de Agua',
    expectedKind: options.expectedKind,
    candidate: options.entity ?? candidate(),
    pools,
    context: options.context ?? {},
    admits: options.admits ?? (() => true),
  });

describe('examineCompetitors', () => {
  it('a complete pool holding only the candidate establishes NO_MATERIAL_COMPETITOR', () => {
    expect(
      examine([
        { strategy: 'NOMINATIM', coverage: 'COMPLETE', members: [RESTAURANT] },
      ]),
    ).toEqual({
      type: 'COMPETITOR_EXAMINATION',
      outcome: 'NO_MATERIAL_COMPETITOR',
      examinedStrategies: ['NOMINATIM'],
      competitorCount: 0,
    });
  });

  it('a partial pool holding only the candidate is NO_COMPETITOR_OBSERVED, never uniqueness', () => {
    expect(
      examine([
        { strategy: 'PLACES', coverage: 'PARTIAL', members: [RESTAURANT] },
      ]).outcome,
    ).toBe('NO_COMPETITOR_OBSERVED');
  });

  it('a complete pool that does not hold the candidate cannot establish its uniqueness', () => {
    expect(
      examine([{ strategy: 'NOMINATIM', coverage: 'COMPLETE', members: [] }])
        .outcome,
    ).toBe('NO_COMPETITOR_OBSERVED');
  });

  it('a competitor exposed by ANY pool is known, whichever pool decides next', () => {
    const result = examine([
      {
        strategy: 'NOMINATIM',
        coverage: 'COMPLETE',
        members: [RESTAURANT, CORDOBA_HAMLET],
      },
      { strategy: 'PLACES', coverage: 'PARTIAL', members: [RESTAURANT] },
    ]);
    expect(result).toMatchObject({
      outcome: 'MATERIAL_COMPETITOR_KNOWN',
      competitorCount: 1,
      examinedStrategies: ['NOMINATIM', 'PLACES'],
    });
  });

  it('a partial pool can still expose a competitor', () => {
    expect(
      examine([
        {
          strategy: 'LOCAL_OSM_POOL',
          coverage: 'PARTIAL',
          members: [RESTAURANT, CORDOBA_HAMLET],
        },
      ]).outcome,
    ).toBe('MATERIAL_COMPETITOR_KNOWN');
  });

  it('a member outside the grounded component locality is excluded by the source, not by distance', () => {
    expect(
      examine(
        [
          {
            strategy: 'NOMINATIM',
            coverage: 'COMPLETE',
            members: [RESTAURANT, CORDOBA_HAMLET],
          },
        ],
        { context: { locality: LUJAN } },
      ).outcome,
    ).toBe('NO_MATERIAL_COMPETITOR');
  });

  it('two same-name members inside the grounded locality stay material', () => {
    const agreloHotel = member(
      'openstreetmap/osm:node:2',
      'Ojo de Agua',
      -33.1,
      -68.9,
    );
    expect(
      examine(
        [
          {
            strategy: 'NOMINATIM',
            coverage: 'COMPLETE',
            members: [RESTAURANT, agreloHotel],
          },
        ],
        { context: { locality: LUJAN } },
      ).outcome,
    ).toBe('MATERIAL_COMPETITOR_KNOWN');
  });

  it('a stated kind excludes a structurally contradicting homonym', () => {
    expect(
      examine(
        [
          {
            strategy: 'NOMINATIM',
            coverage: 'COMPLETE',
            members: [RESTAURANT, CORDOBA_HAMLET],
          },
        ],
        {
          context: {
            physicalKind: {
              kind: 'ESTABLISHMENT',
              evidenceKey: 'ev-1',
              supportSpan: 'Wine and lunch at Ojo de Agua',
              term: 'lunch',
            },
          },
        },
      ).outcome,
    ).toBe('NO_MATERIAL_COMPETITOR');
  });

  it('a member the component could never be admitted at is not a competitor (destination-bounded Experience)', () => {
    expect(
      examine(
        [
          {
            strategy: 'NOMINATIM',
            coverage: 'COMPLETE',
            members: [RESTAURANT, CORDOBA_HAMLET],
          },
        ],
        { admits: (m) => m !== CORDOBA_HAMLET },
      ).outcome,
    ).toBe('NO_MATERIAL_COMPETITOR');
  });

  it('records are never merged by name: two records of one dataset are two identities', () => {
    const duplicateNode = member(
      'openstreetmap/osm:way:99',
      'Ojo de Agua',
      -33.13,
      -68.964,
    );
    expect(
      examine([
        {
          strategy: 'NOMINATIM',
          coverage: 'COMPLETE',
          members: [RESTAURANT, duplicateNode],
        },
      ]).outcome,
    ).toBe('MATERIAL_COMPETITOR_KNOWN');
  });

  it('the same physical record seen by two OSM-backed strategies is one identity, not a competitor', () => {
    const placesRecord = candidate({
      provider: 'geoapify',
      externalId: 'geoapify:abc',
      identities: [
        { provider: 'geoapify', externalId: 'geoapify:abc' },
        { provider: 'openstreetmap', externalId: 'osm:node:4797394430' },
      ],
    });
    expect(
      examine(
        [
          {
            strategy: 'NOMINATIM',
            coverage: 'COMPLETE',
            members: [RESTAURANT],
          },
          {
            strategy: 'PLACES',
            coverage: 'PARTIAL',
            members: [
              member('geoapify/geoapify:abc', 'Ojo de Agua', -33.13, -68.964, {
                identityKeys: [
                  'geoapify/geoapify:abc',
                  'openstreetmap/osm:node:4797394430',
                ],
              }),
            ],
          },
        ],
        { entity: placesRecord },
      ).outcome,
    ).toBe('NO_MATERIAL_COMPETITOR');
  });

  it('a lone record of another namespace may be the candidate itself: neither competitor nor proof of absence', () => {
    const undeclaredPlacesRecord = candidate({
      provider: 'geoapify',
      externalId: 'geoapify:abc',
    });
    expect(
      examine(
        [
          {
            strategy: 'NOMINATIM',
            coverage: 'COMPLETE',
            members: [RESTAURANT],
          },
        ],
        { entity: undeclaredPlacesRecord },
      ),
    ).toMatchObject({ outcome: 'NO_COMPETITOR_OBSERVED', competitorCount: 0 });
  });

  it('two records of another namespace: at least one is not the candidate', () => {
    const undeclaredPlacesRecord = candidate({
      provider: 'geoapify',
      externalId: 'geoapify:abc',
    });
    expect(
      examine(
        [
          {
            strategy: 'NOMINATIM',
            coverage: 'COMPLETE',
            members: [RESTAURANT, CORDOBA_HAMLET],
          },
        ],
        { entity: undeclaredPlacesRecord },
      ),
    ).toMatchObject({
      outcome: 'MATERIAL_COMPETITOR_KNOWN',
      competitorCount: 1,
    });
  });

  it("a homonym of the candidate's own name competes even when the hint text differs", () => {
    const farmacia = candidate({
      hintName: 'Farmacia la Estrella',
      externalId: 'osm:node:3348573778',
      canonicalName: 'Farmacia de la Estrella',
    });
    const buenosAires = member(
      'openstreetmap/osm:node:3348573778',
      'Farmacia de la Estrella',
      -34.61,
      -58.372,
    );
    const elsewhere = member(
      'openstreetmap/osm:node:5',
      'Farmacia de la Estrella',
      -31.4,
      -64.18,
    );
    const pools = (members: CompetitorPoolMember[]): CompetitorPool[] => [
      { strategy: 'NOMINATIM', coverage: 'COMPLETE', members },
    ];
    const examineFarmacia = (members: CompetitorPoolMember[]) =>
      examineCompetitors({
        hintName: 'Farmacia la Estrella',
        candidate: farmacia,
        pools: pools(members),
        context: {},
        admits: () => true,
      }).outcome;

    expect(examineFarmacia([buenosAires])).toBe('NO_MATERIAL_COMPETITOR');
    expect(examineFarmacia([buenosAires, elsewhere])).toBe(
      'MATERIAL_COMPETITOR_KNOWN',
    );
  });

  it('a record that merely shares a brand word is not a competitor; one declaring the hint as an alias is', () => {
    const brandSibling = member(
      'openstreetmap/osm:node:6',
      'Ojo de Agua Hotel Boutique',
      -33.1,
      -68.9,
    );
    const aliased = member(
      'openstreetmap/osm:node:7',
      'Bodega X',
      -33.1,
      -68.9,
      {
        declaresHintAlias: true,
      },
    );
    expect(
      examine([
        {
          strategy: 'LOCAL_OSM_POOL',
          coverage: 'COMPLETE',
          members: [RESTAURANT, brandSibling],
        },
      ]).outcome,
    ).toBe('NO_MATERIAL_COMPETITOR');
    expect(
      examine([
        {
          strategy: 'LOCAL_OSM_POOL',
          coverage: 'COMPLETE',
          members: [RESTAURANT, aliased],
        },
      ]).outcome,
    ).toBe('MATERIAL_COMPETITOR_KNOWN');
  });

  describe('structural compatibility gates material competition (any provider)', () => {
    const STOP = member(
      'openstreetmap/osm:node:2',
      'Ojo de Agua',
      -33.131,
      -68.965,
      {
        structuralKind: 'TRANSPORT_STOP',
      },
    );
    const SAME_NAME_VENUE = member(
      'openstreetmap/osm:node:3',
      'Ojo de Agua',
      -33.2,
      -69.0,
    );
    const pool = (members: CompetitorPoolMember[]): CompetitorPool[] => [
      { strategy: 'LOCAL_OSM_POOL', coverage: 'COMPLETE', members },
    ];

    it('a structurally incompatible homonym is not a material competitor of a PLACE hint', () => {
      expect(
        examine(pool([RESTAURANT, STOP]), { expectedKind: 'PLACE' }).outcome,
      ).toBe('NO_MATERIAL_COMPETITOR');
    });

    it('a structurally compatible homonym is a material competitor', () => {
      expect(
        examine(pool([RESTAURANT, STOP, SAME_NAME_VENUE]), {
          expectedKind: 'PLACE',
        }),
      ).toMatchObject({
        outcome: 'MATERIAL_COMPETITOR_KNOWN',
        competitorCount: 1,
      });
    });

    it('a structure of unknown kind is never excluded', () => {
      expect(
        examine(
          pool([RESTAURANT, { ...SAME_NAME_VENUE, structuralKind: 'UNKNOWN' }]),
          { expectedKind: 'PLACE' },
        ).outcome,
      ).toBe('MATERIAL_COMPETITOR_KNOWN');
    });

    it('without an expected kind nothing is excluded structurally', () => {
      expect(examine(pool([RESTAURANT, STOP])).outcome).toBe(
        'MATERIAL_COMPETITOR_KNOWN',
      );
    });
  });
});
