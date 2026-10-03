import { GeoEntityKind } from '@prisma/client';
import {
  ComponentIdentityContext,
  ContextualPoolMember,
} from '../interfaces/component-identity-context.interface';
import { EntityCandidate } from '../interfaces/experience-resolution.interface';
import {
  contextualIdentityEvidence,
  evaluateContextualPool,
  kindCompatibility,
} from './contextual-identity.policy';

// A simplified square locality: lon -69.2..-68.8, lat -33.4..-33.0.
const LOCALITY: ComponentIdentityContext['locality'] = {
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
const ESTABLISHMENT = {
  kind: 'ESTABLISHMENT' as const,
  term: 'winery lunch',
  evidenceKey: 'ev-1',
  supportSpan: 'Ojo de Agua – 1:30 pm for a winery lunch',
};
const inside = { latitude: -33.13, longitude: -68.96 };
const outside = { latitude: -31.21, longitude: -65.24 };
const member = (
  key: string,
  at: { latitude?: number; longitude?: number },
  structuralKind: ContextualPoolMember['structuralKind'] = 'POINT_OF_INTEREST',
): ContextualPoolMember => ({ identityKey: key, ...at, structuralKind });

describe('contextual identity policy', () => {
  describe('kindCompatibility (structural, not a category taxonomy)', () => {
    it.each([
      ['ESTABLISHMENT', 'POINT_OF_INTEREST', 'COMPATIBLE'],
      ['ESTABLISHMENT', 'SETTLEMENT', 'INCOMPATIBLE'],
      ['ESTABLISHMENT', 'ROAD', 'INCOMPATIBLE'],
      ['ESTABLISHMENT', 'UNKNOWN', 'UNKNOWN'],
      ['SETTLEMENT', 'SETTLEMENT', 'COMPATIBLE'],
      ['SETTLEMENT', 'POINT_OF_INTEREST', 'INCOMPATIBLE'],
      [undefined, 'SETTLEMENT', 'NOT_ASSERTED'],
    ] as const)('%s vs %s -> %s', (asserted, candidate, expected) => {
      expect(kindCompatibility(asserted, candidate)).toBe(expected);
    });
  });

  describe('evaluateContextualPool', () => {
    const context = { locality: LOCALITY, physicalKind: ESTABLISHMENT };

    it('is undefined without a grounded locality (no context to compare)', () => {
      expect(
        evaluateContextualPool(
          {},
          [member('a', inside)],
          'PROVIDER_WINDOW_NOT_REACHED',
        ),
      ).toBeUndefined();
      expect(
        evaluateContextualPool(
          {
            locality: {
              status: 'UNGROUNDED',
              assertion: LOCALITY!.assertion,
              reason: 'AMBIGUOUS_BOUNDARY',
            },
          },
          [member('a', inside)],
          'PROVIDER_WINDOW_NOT_REACHED',
        ),
      ).toBeUndefined();
    });

    it('DISTINGUISHED: one compatible member inside, others outside, comparison not cut off', () => {
      expect(
        evaluateContextualPool(
          context,
          [member('cordoba', outside, 'SETTLEMENT'), member('lujan', inside)],
          'PROVIDER_WINDOW_NOT_REACHED',
        ),
      ).toMatchObject({
        outcome: 'DISTINGUISHED',
        consistentIdentityKeys: ['lujan'],
        memberCount: 2,
      });
    });

    it('a settlement inside the locality is not a competitor when the source states an establishment', () => {
      expect(
        evaluateContextualPool(
          context,
          [member('hamlet', inside, 'SETTLEMENT'), member('lujan', inside)],
          'PROVIDER_WINDOW_NOT_REACHED',
        )?.outcome,
      ).toBe('DISTINGUISHED');
    });

    it('AMBIGUOUS: two equally consistent members in the same locality, whatever the coverage', () => {
      for (const coverage of [
        'PROVIDER_WINDOW_NOT_REACHED',
        'NOT_ESTABLISHED',
      ] as const) {
        expect(
          evaluateContextualPool(
            context,
            [
              member('a', inside),
              member('b', { latitude: -33.2, longitude: -69.0 }),
            ],
            coverage,
          )?.outcome,
        ).toBe('AMBIGUOUS');
      }
    });

    it('INCOMPLETE_COMPARISON: a cut-off window, or a member that cannot be placed', () => {
      expect(
        evaluateContextualPool(
          context,
          [member('a', inside)],
          'NOT_ESTABLISHED',
        )?.outcome,
      ).toBe('INCOMPLETE_COMPARISON');
      expect(
        evaluateContextualPool(
          context,
          [member('a', inside), member('nowhere', {})],
          'PROVIDER_WINDOW_NOT_REACHED',
        ),
      ).toMatchObject({
        outcome: 'INCOMPLETE_COMPARISON',
        undeterminedIdentityKeys: ['nowhere'],
      });
    });

    it('KIND_UNESTABLISHED: the only member inside has an unknown structure while the source states a kind', () => {
      expect(
        evaluateContextualPool(
          context,
          [member('a', inside, 'UNKNOWN')],
          'PROVIDER_WINDOW_NOT_REACHED',
        )?.outcome,
      ).toBe('KIND_UNESTABLISHED');
    });

    it('NO_CONSISTENT_MEMBER: every member is outside the asserted locality', () => {
      expect(
        evaluateContextualPool(
          context,
          [member('a', outside), member('b', outside, 'SETTLEMENT')],
          'PROVIDER_WINDOW_NOT_REACHED',
        )?.outcome,
      ).toBe('NO_CONSISTENT_MEMBER');
    });

    it('without a stated kind, a member of unknown structure inside can be distinguished', () => {
      expect(
        evaluateContextualPool(
          { locality: LOCALITY },
          [member('a', inside, 'UNKNOWN')],
          'PROVIDER_WINDOW_NOT_REACHED',
        )?.outcome,
      ).toBe('DISTINGUISHED');
    });
  });

  describe('contextualIdentityEvidence', () => {
    const candidate = (
      at: { latitude: number; longitude: number },
      structuralKind: EntityCandidate['structuralKind'],
      extra: Partial<EntityCandidate> = {},
    ): EntityCandidate => ({
      hintKey: 'h',
      hintName: 'Ojo de Agua',
      provider: 'openstreetmap',
      externalId: 'osm:node:1',
      canonicalName: 'Ojo de Agua',
      kind: GeoEntityKind.PLACE,
      role: 'venue',
      nameEvidenceMultiplicity: {
        exactName: 'MULTIPLE',
        declaredAlias: 'UNKNOWN',
      },
      structuralKind,
      ...at,
      ...extra,
    });

    it('a candidate outside the asserted locality contradicts it, and is not projected as correspondence', () => {
      const evidence = contextualIdentityEvidence(
        { locality: LOCALITY },
        candidate(outside, 'SETTLEMENT', {
          contextualPool: evaluateContextualPool(
            { locality: LOCALITY },
            [member('openstreetmap/osm:node:1', outside, 'SETTLEMENT')],
            'PROVIDER_WINDOW_NOT_REACHED',
          ),
        }),
      );
      expect(evidence).toEqual([
        {
          type: 'IDENTITY_CONTRADICTION',
          fact: 'LOCALITY',
          assertedLocality: 'Lujan de Cuyo',
          boundaryId: 'osm:relation:1',
        },
      ]);
    });

    it('a settlement contradicts a stated establishment', () => {
      expect(
        contextualIdentityEvidence(
          { physicalKind: ESTABLISHMENT },
          candidate(inside, 'SETTLEMENT'),
        ),
      ).toEqual([
        {
          type: 'IDENTITY_CONTRADICTION',
          fact: 'PHYSICAL_KIND',
          assertedKind: 'ESTABLISHMENT',
          candidateKind: 'SETTLEMENT',
        },
      ]);
    });

    it('the distinguished member carries DISTINGUISHED correspondence', () => {
      const pool = evaluateContextualPool(
        { locality: LOCALITY, physicalKind: ESTABLISHMENT },
        [
          member('openstreetmap/osm:node:9', outside, 'SETTLEMENT'),
          member('openstreetmap/osm:node:1', inside),
        ],
        'PROVIDER_WINDOW_NOT_REACHED',
      );
      expect(
        contextualIdentityEvidence(
          { locality: LOCALITY, physicalKind: ESTABLISHMENT },
          candidate(inside, 'POINT_OF_INTEREST', { contextualPool: pool }),
        ),
      ).toEqual([
        {
          type: 'CONTEXTUAL_CORRESPONDENCE',
          assertion: 'LOCALITY',
          locality: 'Lujan de Cuyo',
          coverage: 'PROVIDER_WINDOW_NOT_REACHED',
          memberCount: 2,
          consistentCount: 1,
          outcome: 'DISTINGUISHED',
        },
      ]);
    });
  });
});
