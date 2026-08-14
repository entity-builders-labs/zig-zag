package places_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/places"
)

func TestPriceLevelToNumber(t *testing.T) {
	tests := []struct {
		name       string
		priceLevel string
		want       int
		wantOK     bool
	}{
		{name: "free maps to 1, not 0, to stay within the 1-5 validated range", priceLevel: "PRICE_LEVEL_FREE", want: 1, wantOK: true},
		{name: "inexpensive", priceLevel: "PRICE_LEVEL_INEXPENSIVE", want: 2, wantOK: true},
		{name: "moderate", priceLevel: "PRICE_LEVEL_MODERATE", want: 3, wantOK: true},
		{name: "expensive", priceLevel: "PRICE_LEVEL_EXPENSIVE", want: 4, wantOK: true},
		{name: "very expensive", priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE", want: 5, wantOK: true},
		{name: "empty string (Geoapify never reports price)", priceLevel: "", wantOK: false},
		{name: "unrecognized value", priceLevel: "SOMETHING_ELSE", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := places.PriceLevelToNumber(tt.priceLevel)
			require.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				require.Equal(t, tt.want, got)
			}
		})
	}
}
