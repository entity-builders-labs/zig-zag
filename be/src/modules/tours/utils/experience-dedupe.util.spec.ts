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
   * OPEN FINDING -- Stage 5 RW1 (spikes/stage5-rw1-final-verification-2026-09-25).
   * Characterizes CURRENT behavior; this is NOT the intended design. The
   * 2026-09-22 amendment says a GeoEntity may be shared by a source-backed
   * composite and an independently discovered standalone Experience, but
   * `setOverlap` divides by the larger set, so a single-venue Experience and
   * a 2-stop composite containing it score componentOverlap = 1/2 = 0.5 --
   * exactly the AMBIGUOUS cutoff -- and whichever is persisted second fails
   * closed. A 3-stop composite scores 1/3 and is unaffected: the outcome
   * depends on stop count and catalog order, not identity. Live: COLD 1 lost
   * the standalone "Plaza Dorrego"; COLD 4 lost the complete, geo-accepted
   * 2-stop walk "San Telmo Walking Tour" (Plaza Dorrego + Mercado). Flip
   * these expectations when the Experience-dedupe policy decision is made.
   */
  describe('OPEN FINDING: single-venue vs 2-stop composite sharing a GeoEntity', () => {
    const plazaDorrego = { geoEntityId: 'geo-plaza-dorrego', role: 'venue' };
    const mercado = { geoEntityId: 'geo-mercado', role: 'venue' };
    const lezama = { geoEntityId: 'geo-parque-lezama', role: 'venue' };
    const single = (
      id: string | undefined,
      component: typeof plazaDorrego,
      name: string,
    ) => ({
      ...(id ? { id } : {}),
      canonicalName: name,
      latitude: -34.6212,
      longitude: -58.3731,
      components: [component],
    });
    const walk = (
      id: string | undefined,
      components: Array<typeof plazaDorrego>,
    ) => ({
      ...(id ? { id } : {}),
      canonicalName: 'San Telmo Walking Tour',
      latitude: -34.6212,
      longitude: -58.3731,
      components,
    });

    it('COLD 1 order: the composite exists, the standalone venue fails closed', () => {
      const decision = decideExperienceDedupe(
        single(undefined, plazaDorrego, 'Plaza Dorrego'),
        [walk('exp-walk', [lezama, plazaDorrego])],
      );
      expect(decision.decision).toBe('AMBIGUOUS');
      expect(decision.evidence.componentOverlap).toBe(0.5);
    });

    it('COLD 4 order: the standalone venues exist, the complete composite fails closed', () => {
      const decision = decideExperienceDedupe(
        walk(undefined, [plazaDorrego, mercado]),
        [
          single('exp-plaza', plazaDorrego, 'Plaza Dorrego'),
          single('exp-mercado', mercado, 'Mercado San Telmo'),
        ],
      );
      expect(decision.decision).toBe('AMBIGUOUS');
    });

    it('a 3-stop composite over the same venue is not affected (cardinality artifact)', () => {
      const decision = decideExperienceDedupe(
        walk(undefined, [plazaDorrego, mercado, lezama]),
        [single('exp-plaza', plazaDorrego, 'Plaza Dorrego')],
      );
      expect(decision.decision).toBe('NEW');
    });
  });
});
