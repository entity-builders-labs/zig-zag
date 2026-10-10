import { decideExperienceDedupe } from './experience-dedupe.util';

describe('decideExperienceDedupe', () => {
  const base = {
    canonicalName: 'Ruta del vino de Luján de Cuyo',
    latitude: -33.038,
    longitude: -68.879,
    provenance: ['official-tourism'],
  };

  it('returns SAME only for strong role-aware structural identity', () => {
    const decision = decideExperienceDedupe(
      {
        ...base,
        components: [
          { geoEntityId: 'bodega-a', role: 'winery' },
          { geoEntityId: 'bodega-b', role: 'winery' },
        ],
      },
      [
        {
          id: 'canonical',
          ...base,
          components: [
            { geoEntityId: 'bodega-a', role: 'winery' },
            { geoEntityId: 'bodega-b', role: 'winery' },
          ],
        },
      ],
    );

    expect(decision.decision).toBe('SAME');
    if (decision.decision === 'SAME') {
      expect(decision.canonicalExperienceId).toBe('canonical');
      expect(decision.evidence.roleAwareComponentOverlap).toBe(1);
    }
  });

  it('does not merge false friends merely because they share one component', () => {
    const decision = decideExperienceDedupe(
      {
        ...base,
        canonicalName: 'Ruta del vino premium de Luján de Cuyo',
        components: [
          { geoEntityId: 'bodega-a', role: 'winery' },
          { geoEntityId: 'restaurant-x', role: 'lunch' },
          { geoEntityId: 'bodega-z', role: 'winery' },
        ],
      },
      [
        {
          id: 'classic-route',
          ...base,
          components: [
            { geoEntityId: 'bodega-a', role: 'winery' },
            { geoEntityId: 'bodega-b', role: 'winery' },
            { geoEntityId: 'bodega-c', role: 'winery' },
          ],
        },
      ],
    );

    expect(decision.decision).toBe('AMBIGUOUS');
  });

  it('returns NEW when identity signals do not overlap', () => {
    const decision = decideExperienceDedupe(
      {
        canonicalName: 'Clase de cocina mendocina vegana',
        latitude: -32.89,
        longitude: -68.84,
        provenance: ['provider-a'],
        components: [{ geoEntityId: 'kitchen-1', role: 'venue' }],
      },
      [
        {
          id: 'existing',
          ...base,
          components: [{ geoEntityId: 'bodega-a', role: 'winery' }],
        },
      ],
    );

    expect(decision.decision).toBe('NEW');
  });

  /**
   * Stage 5 RW1 regression: a standalone Experience and a source-backed
   * composite may legitimately share the same GeoEntity. That membership is
   * expected catalog structure (amendment §16), not Experience identity.
   *
   * The structural overlap values remain evidence for audit/ranking. The
   * policy correction is narrower: for standalone-vs-composite comparisons,
   * shared membership alone must not trigger SAME or AMBIGUOUS. Independent
   * identity signals (for example, the same canonical name) may still make
   * the comparison ambiguous.
   */
  describe('standalone vs composite shared membership', () => {
    const plazaDorrego = { geoEntityId: 'geo-plaza-dorrego', role: 'venue' };
    const mercado = { geoEntityId: 'geo-mercado', role: 'venue' };
    const lezama = { geoEntityId: 'geo-parque-lezama', role: 'venue' };
    const single = (
      id: string | undefined,
      component: typeof plazaDorrego,
      name = 'Visit Plaza Dorrego',
    ) => ({
      ...(id ? { id } : {}),
      canonicalName: name,
      components: [component],
    });
    const walk = (
      id: string | undefined,
      components: Array<typeof plazaDorrego>,
      name = 'San Telmo Historical Walk',
    ) => ({
      ...(id ? { id } : {}),
      canonicalName: name,
      components,
    });

    it('[A] then [A,B]: shared membership alone preserves both Experiences', () => {
      const decision = decideExperienceDedupe(
        walk(undefined, [plazaDorrego, mercado]),
        [single('exp-plaza', plazaDorrego)],
      );

      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.componentOverlap).toBe(0.5);
      expect(decision.evidence.roleAwareComponentOverlap).toBe(0.5);
    });

    it('[A,B] then [A]: persistence order does not change the identity result', () => {
      const decision = decideExperienceDedupe(single(undefined, plazaDorrego), [
        walk('exp-walk', [plazaDorrego, mercado]),
      ]);

      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.componentOverlap).toBe(0.5);
      expect(decision.evidence.roleAwareComponentOverlap).toBe(0.5);
    });

    it('[A] vs [A,B,C]: the same standalone/composite semantics are cardinality-independent', () => {
      const decision = decideExperienceDedupe(
        walk(undefined, [plazaDorrego, mercado, lezama]),
        [single('exp-plaza', plazaDorrego)],
      );

      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.componentOverlap).toBeCloseTo(1 / 3);
    });

    it('same [A] vs same [A] preserves exact duplicate behavior', () => {
      const decision = decideExperienceDedupe(single(undefined, plazaDorrego), [
        single('exp-plaza', plazaDorrego),
      ]);

      expect(decision.decision).toBe('SAME');
      if (decision.decision === 'SAME') {
        expect(decision.canonicalExperienceId).toBe('exp-plaza');
      }
    });

    it('same [A,B] vs same [A,B] preserves exact composite duplicate behavior', () => {
      const decision = decideExperienceDedupe(
        walk(undefined, [plazaDorrego, mercado]),
        [walk('exp-walk', [plazaDorrego, mercado])],
      );

      expect(decision.decision).toBe('SAME');
      if (decision.decision === 'SAME') {
        expect(decision.canonicalExperienceId).toBe('exp-walk');
      }
    });

    it('partial overlap between two genuine composites preserves AMBIGUOUS policy', () => {
      const decision = decideExperienceDedupe(
        {
          canonicalName: 'Harbor Circuit',
          components: [plazaDorrego, mercado],
        },
        [
          {
            id: 'other-composite',
            canonicalName: 'Mountain Passage',
            components: [plazaDorrego, lezama],
          },
        ],
      );

      expect(decision.decision).toBe('AMBIGUOUS');
      expect(decision.evidence.componentOverlap).toBe(0.5);
      expect(decision.evidence.roleAwareComponentOverlap).toBe(0.5);
    });

    it('independent identity evidence can still make standalone-vs-composite AMBIGUOUS', () => {
      const decision = decideExperienceDedupe(
        walk(undefined, [plazaDorrego, mercado], 'Plaza Dorrego Experience'),
        [single('exp-plaza', plazaDorrego, 'Plaza Dorrego Experience')],
      );

      expect(decision.decision).toBe('AMBIGUOUS');
    });
  });
});
