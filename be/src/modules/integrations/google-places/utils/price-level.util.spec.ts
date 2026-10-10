import { priceLevelToNumber } from './price-level.util';

describe('priceLevelToNumber', () => {
  it('maps each known Google price level enum to its 1-5 number', () => {
    expect(priceLevelToNumber('PRICE_LEVEL_FREE')).toBe(1);
    expect(priceLevelToNumber('PRICE_LEVEL_INEXPENSIVE')).toBe(2);
    expect(priceLevelToNumber('PRICE_LEVEL_MODERATE')).toBe(3);
    expect(priceLevelToNumber('PRICE_LEVEL_EXPENSIVE')).toBe(4);
    expect(priceLevelToNumber('PRICE_LEVEL_VERY_EXPENSIVE')).toBe(5);
  });

  it('returns undefined for unknown, unspecified, or missing values', () => {
    expect(priceLevelToNumber('PRICE_LEVEL_UNSPECIFIED')).toBeUndefined();
    expect(priceLevelToNumber(undefined)).toBeUndefined();
    expect(priceLevelToNumber(null)).toBeUndefined();
    expect(priceLevelToNumber('')).toBeUndefined();
  });
});
