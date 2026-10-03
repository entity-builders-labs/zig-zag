// Google's New Places API returns price as a string enum, not the old
// numeric 0-4 scale. CreateActivityDto.priceLevel is validated 1-5, so FREE
// maps to 1 (not 0) to stay within that range.
const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 2,
  PRICE_LEVEL_MODERATE: 3,
  PRICE_LEVEL_EXPENSIVE: 4,
  PRICE_LEVEL_VERY_EXPENSIVE: 5,
};

export function priceLevelToNumber(
  priceLevel: string | undefined | null,
): number | undefined {
  if (!priceLevel) return undefined;
  return PRICE_LEVEL_MAP[priceLevel];
}
