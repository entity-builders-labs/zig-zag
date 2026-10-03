import { assertNoConcretePlaceHints } from './discovery-live.helper';

const result = (candidates: any[]) => ({
  provider: 'ollama',
  model: 'test-model',
  rawOutput: '{}',
  validationErrors: [] as string[],
  candidates,
});

describe('assertNoConcretePlaceHints (generic-entity fixture semantics)', () => {
  it('A. passes when componentHints are AREA only', () => {
    expect(() =>
      assertNoConcretePlaceHints(
        result([
          {
            name: 'Palermo coffee and beer walk',
            componentHints: [
              { name: 'Palermo Soho', role: 'area', expectedKind: 'AREA' },
              {
                name: 'Palermo Hollywood',
                role: 'area',
                expectedKind: 'AREA',
              },
            ],
          },
        ]),
      ),
    ).not.toThrow();
  });

  it('B. passes when there are no candidates at all', () => {
    expect(() => assertNoConcretePlaceHints(result([]))).not.toThrow();
  });

  it('C. fails on a PLACE named after a bare category', () => {
    expect(() =>
      assertNoConcretePlaceHints(
        result([
          {
            name: 'Specialty Coffee Walk',
            componentHints: [
              {
                name: 'Specialty Coffee Shop',
                role: 'venue',
                expectedKind: 'PLACE',
              },
            ],
          },
        ]),
      ),
    ).toThrow(/PLACE componentHints/);
  });

  it('D. fails on a PLACE whose name is NOT in any banned list (no exact-string dependency)', () => {
    expect(() =>
      assertNoConcretePlaceHints(
        result([
          {
            name: 'Palermo roastery crawl',
            componentHints: [
              { name: 'Palermo Soho', role: 'area', expectedKind: 'AREA' },
              {
                name: 'Independent Neighborhood Coffee Roastery',
                role: 'venue',
                expectedKind: 'PLACE',
              },
            ],
          },
        ]),
      ),
    ).toThrow(/Independent Neighborhood Coffee Roastery/);
  });
});
