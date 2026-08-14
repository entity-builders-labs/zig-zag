package places

// priceLevelMap: Google's New Places API returns price as a string enum,
// not the old numeric 0-4 scale. Activity.priceLevel is validated 1-5, so
// FREE maps to 1 (not 0) to stay within that range.
var priceLevelMap = map[string]int{
	"PRICE_LEVEL_FREE":           1,
	"PRICE_LEVEL_INEXPENSIVE":    2,
	"PRICE_LEVEL_MODERATE":       3,
	"PRICE_LEVEL_EXPENSIVE":      4,
	"PRICE_LEVEL_VERY_EXPENSIVE": 5,
}

// PriceLevelToNumber ports priceLevelToNumber (utils/price-level.util.ts).
func PriceLevelToNumber(priceLevel string) (int, bool) {
	if priceLevel == "" {
		return 0, false
	}
	v, ok := priceLevelMap[priceLevel]
	return v, ok
}
