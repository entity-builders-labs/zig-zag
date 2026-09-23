import {
  buildExperienceSemanticDocument,
  EXPERIENCE_SEMANTIC_DOCUMENT_VERSION,
} from './experience-semantic-document.util';

describe('buildExperienceSemanticDocument', () => {
  it('builds a stable semantic document from business fields instead of arbitrary metadata', () => {
    const document = buildExperienceSemanticDocument({
      canonicalName: 'Ruta del vino de Luján de Cuyo',
      description: 'Recorrido por bodegas con degustación.',
      durationMinutes: 360,
      price: 85,
      themes: ['wine', 'gastronomy', 'wine'],
      traits: [
        { dimension: 'diet', key: 'vegan-friendly', label: 'vegan friendly' },
        { dimension: 'mobility', key: 'walking', label: 'walking' },
      ],
      intents: ['route-like', 'food-focused'],
      components: [
        {
          role: 'winery',
          geoEntity: {
            name: 'Bodega A',
            kind: 'PLACE',
            address: 'Luján de Cuyo, Mendoza',
          },
        },
        {
          role: 'area',
          geoEntity: {
            name: 'Luján de Cuyo',
            kind: 'AREA',
          },
        },
      ],
    });

    expect(EXPERIENCE_SEMANTIC_DOCUMENT_VERSION).toBeGreaterThan(1);
    expect(document).toContain('name: Ruta del vino de Luján de Cuyo');
    expect(document).toContain('themes: wine, gastronomy');
    expect(document).toContain('diet:vegan-friendly');
    expect(document).toContain('intents: route-like, food-focused');
    expect(document).toContain(
      'component: role=winery | kind=PLACE | Bodega A',
    );
    expect(document).not.toContain('{"');
  });

  /**
   * Stage 2 cutover (component-resolution-and-partial-composite-recovery-
   * plan.md, embedding migration): `required` is no longer an LLM-authored
   * geographic-truth fact, so it must not leak into the canonical semantic
   * document either -- see amendment §18 and EXPERIENCE_EMBEDDING_DOCUMENT_VERSION.
   */
  it('never serializes a required/optional component token (Stage 2 embedding cutover)', () => {
    const document = buildExperienceSemanticDocument({
      canonicalName: 'San Telmo Historic Walk',
      components: [
        { role: 'venue', geoEntity: { name: 'Plaza Dorrego', kind: 'PLACE' } },
        { role: 'route', geoEntity: { name: 'Calle Defensa', kind: 'ROUTE' } },
      ],
    });

    expect(document).toContain('component: role=venue | kind=PLACE');
    expect(document).not.toMatch(/\brequired\b/);
    expect(document).not.toMatch(/\boptional\b/);
  });
});
