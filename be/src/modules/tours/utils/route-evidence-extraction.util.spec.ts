import { extractRouteHints } from './route-evidence-extraction.util';

describe('extractRouteHints', () => {
  it('identifies a route candidate from a text block', () => {
    const hints = extractRouteHints({
      evidence: [],
      textBlocks: [
        {
          text: 'One of the original grid axes, Calle Caseros preserves deep colonial character.',
          evidenceKeys: ['ev-1'],
        },
      ],
    });

    expect(hints).toEqual([
      expect.objectContaining({
        name: 'Calle Caseros',
        role: 'route',
        expectedType: 'street',
        required: true,
        evidenceKeys: ['ev-1'],
      }),
    ]);
  });

  it('identifies multiple route candidates from an evidence snippet', () => {
    const hints = extractRouteHints({
      evidence: [
        {
          key: 'ev-3',
          source: 'reference',
          snippet:
            'The Jesuit Block sits at the intersection of Calle Obispo Trejo and Calle Caseros.',
        },
      ],
    });

    const names = hints.map((h) => h.name).sort();
    expect(names).toEqual(['Calle Caseros', 'Calle Obispo Trejo']);
    expect(hints.every((h) => h.evidenceKeys.includes('ev-3'))).toBe(true);
  });

  it('scans evidence.title in addition to evidence.snippet', () => {
    const hints = extractRouteHints({
      evidence: [
        {
          key: 'ev-5',
          source: 'reference',
          title: 'Avenida Hipólito Yrigoyen — Nueva Córdoba gateway',
          snippet:
            'A wide avenue connecting the historic grid to Nueva Córdoba.',
        },
      ],
    });

    expect(hints).toEqual([
      expect.objectContaining({
        name: 'Avenida Hipólito Yrigoyen',
        expectedType: 'avenue',
        evidenceKeys: ['ev-5'],
      }),
    ]);
  });

  it('deduplicates repeated mentions of the same route across blocks and evidence into one hint', () => {
    const hints = extractRouteHints({
      evidence: [
        {
          key: 'ev-9',
          source: 'reference',
          snippet: 'Address: Calle Caseros 141, Cordoba.',
        },
      ],
      textBlocks: [
        {
          text: 'Calle Caseros flanks the colonial civic power center.',
          evidenceKeys: ['ev-2'],
        },
        {
          text: 'Intersecting directly with Obispo Trejo, Calle Caseros continues south.',
          evidenceKeys: ['ev-4'],
        },
      ],
    });

    const caserosHints = hints.filter((h) => h.name === 'Calle Caseros');
    expect(caserosHints).toHaveLength(1);
    expect(caserosHints[0].evidenceKeys.sort()).toEqual([
      'ev-2',
      'ev-4',
      'ev-9',
    ]);
  });

  it('yields no hint for a purely conceptual/descriptive corridor with no real named street', () => {
    const hints = extractRouteHints({
      evidence: [
        {
          key: 'ev-1',
          source: 'reference',
          snippet: 'Explore the historic civic axis of downtown Córdoba.',
        },
      ],
      textBlocks: [
        {
          text: 'The historic civic axis of downtown Córdoba blends colonial and modern architecture.',
          evidenceKeys: ['ev-1'],
        },
      ],
    });

    expect(hints).toEqual([]);
  });

  it('returns an empty array when there is no evidence or text blocks', () => {
    expect(extractRouteHints({ evidence: [] })).toEqual([]);
  });
});
