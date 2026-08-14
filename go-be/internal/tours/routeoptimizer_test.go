package tours_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/tours"
)

type namedPoint struct {
	Name      string
	Latitude  float64
	Longitude float64
}

func (p namedPoint) Coords() tours.Coordinates {
	return tours.Coordinates{Latitude: p.Latitude, Longitude: p.Longitude}
}

func TestOptimizeActivityOrder(t *testing.T) {
	t.Run("0 or 1 points pass through unchanged", func(t *testing.T) {
		require.Empty(t, tours.OptimizeActivityOrder(tours.Coordinates{}, []namedPoint{}))
		one := []namedPoint{{Name: "A", Latitude: 1, Longitude: 1}}
		require.Equal(t, one, tours.OptimizeActivityOrder(tours.Coordinates{}, one))
	})

	t.Run("visits points nearest-first from the origin, not input order", func(t *testing.T) {
		origin := tours.Coordinates{Latitude: 0, Longitude: 0}
		// Deliberately listed far-to-near so a naive pass-through would fail this assertion.
		points := []namedPoint{
			{Name: "Far", Latitude: 10, Longitude: 10},
			{Name: "Near", Latitude: 0.01, Longitude: 0.01},
			{Name: "Middle", Latitude: 1, Longitude: 1},
		}

		result := tours.OptimizeActivityOrder(origin, points)
		require.Len(t, result, 3)
		require.Equal(t, "Near", result[0].Name)
	})

	t.Run("un-zigzags a route where naive listing order would backtrack", func(t *testing.T) {
		origin := tours.Coordinates{Latitude: 0, Longitude: 0}
		// Points laid out on a line at x=1,2,3 but listed as 1,3,2 — the
		// optimizer should still produce a monotonic 1,2,3 walk, not
		// backtrack from 3 to 2.
		points := []namedPoint{
			{Name: "P1", Latitude: 0, Longitude: 1},
			{Name: "P3", Latitude: 0, Longitude: 3},
			{Name: "P2", Latitude: 0, Longitude: 2},
		}

		result := tours.OptimizeActivityOrder(origin, points)
		names := []string{result[0].Name, result[1].Name, result[2].Name}
		require.Equal(t, []string{"P1", "P2", "P3"}, names)
	})
}
