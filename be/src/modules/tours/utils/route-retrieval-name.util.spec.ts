import { routeRetrievalQueryVariants } from './route-retrieval-name.util';

describe('routeRetrievalQueryVariants', () => {
  it('drops a trailing generic English designator ("Defensa Street" -> "Defensa")', () => {
    expect(routeRetrievalQueryVariants('Defensa Street')).toEqual([
      { variant: 'RAW', name: 'Defensa Street' },
      { variant: 'DESIGNATOR_NORMALIZED', name: 'Defensa' },
    ]);
  });

  it('drops a leading generic Spanish designator ("Pasaje San Lorenzo" -> "San Lorenzo")', () => {
    expect(routeRetrievalQueryVariants('Pasaje San Lorenzo')).toEqual([
      { variant: 'RAW', name: 'Pasaje San Lorenzo' },
      { variant: 'DESIGNATOR_NORMALIZED', name: 'San Lorenzo' },
    ]);
  });

  it('handles an English "Passage" gloss the same way', () => {
    expect(routeRetrievalQueryVariants('San Lorenzo Passage')).toEqual([
      { variant: 'RAW', name: 'San Lorenzo Passage' },
      { variant: 'DESIGNATOR_NORMALIZED', name: 'San Lorenzo' },
    ]);
  });

  it('matches designators case/accent-insensitively but keeps the remaining text verbatim', () => {
    expect(routeRetrievalQueryVariants('CALLEJÓN de Ibáñez')).toEqual([
      { variant: 'RAW', name: 'CALLEJÓN de Ibáñez' },
      { variant: 'DESIGNATOR_NORMALIZED', name: 'de Ibáñez' },
    ]);
  });

  it('accepts an abbreviated designator with a trailing dot ("Av. Corrientes")', () => {
    expect(routeRetrievalQueryVariants('Av. Corrientes')).toEqual([
      { variant: 'RAW', name: 'Av. Corrientes' },
      { variant: 'DESIGNATOR_NORMALIZED', name: 'Corrientes' },
    ]);
  });

  it('returns only the raw variant when there is no designator', () => {
    expect(routeRetrievalQueryVariants('Defensa')).toEqual([
      { variant: 'RAW', name: 'Defensa' },
    ]);
  });

  it('never strips a designator that is the whole name', () => {
    expect(routeRetrievalQueryVariants('Caminito')).toEqual([
      { variant: 'RAW', name: 'Caminito' },
    ]);
    expect(routeRetrievalQueryVariants('Pasaje')).toEqual([
      { variant: 'RAW', name: 'Pasaje' },
    ]);
  });

  it('removes at most one leading and one trailing designator, never more', () => {
    expect(routeRetrievalQueryVariants('Calle Paseo Street')).toEqual([
      { variant: 'RAW', name: 'Calle Paseo Street' },
      { variant: 'DESIGNATOR_NORMALIZED', name: 'Paseo' },
    ]);
  });

  it('does not treat a designator word in the middle of the name as a designator', () => {
    expect(routeRetrievalQueryVariants('Plaza Calle Mayor')).toEqual([
      { variant: 'RAW', name: 'Plaza Calle Mayor' },
    ]);
  });

  it('collapses internal whitespace and trims the raw name', () => {
    expect(routeRetrievalQueryVariants('  Defensa   Street ')).toEqual([
      { variant: 'RAW', name: 'Defensa Street' },
      { variant: 'DESIGNATOR_NORMALIZED', name: 'Defensa' },
    ]);
  });

  it('returns no variants for a blank name', () => {
    expect(routeRetrievalQueryVariants('   ')).toEqual([]);
  });
});
