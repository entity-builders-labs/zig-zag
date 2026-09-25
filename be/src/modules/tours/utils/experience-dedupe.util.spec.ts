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
});
