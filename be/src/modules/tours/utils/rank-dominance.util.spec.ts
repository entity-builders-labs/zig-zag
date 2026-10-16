import { preservesRankPositions } from './rank-dominance.util';

describe('preservesRankPositions', () => {
  it('accepts a trial that improves or keeps every occupied position', () => {
    expect(preservesRankPositions([1, 2, 5], [1, 3, 5])).toBe(true);
    expect(preservesRankPositions([1, 3, 5], [1, 3, 5])).toBe(true);
  });

  it('rejects a worse rank at one position even if another position improves', () => {
    expect(preservesRankPositions([1, 4, 4], [1, 3, 5])).toBe(false);
  });

  it('allows extra lower-ranked trial positions when the existing prefix holds', () => {
    expect(preservesRankPositions([1, 3, 5, 9], [1, 3, 5])).toBe(true);
  });

  it('rejects a trial that schedules fewer candidates', () => {
    expect(preservesRankPositions([1, 2], [1, 3, 5])).toBe(false);
  });

  it('compares sorted positions, independent of input order', () => {
    expect(preservesRankPositions([5, 1, 2], [3, 5, 1])).toBe(true);
  });
});
