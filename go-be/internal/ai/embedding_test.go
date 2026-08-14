package ai_test

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
)

// TestTruncateAndRenormalize checks the Go port against ground truth
// computed by actually running the original TS algorithm (node -e) for
// each case — see embedding_fixtures_test.go for the 768->256 fixture,
// generated the same way. This is the highest-precision-risk port in the
// whole migration (see the migration plan), so parity is checked to a
// tight epsilon rather than eyeballed.
func TestTruncateAndRenormalize(t *testing.T) {
	const epsilon = 1e-9

	t.Run("8 -> 4 dims, hand-verifiable case", func(t *testing.T) {
		input := []float64{0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8}
		want := []float64{
			0.2785430072655778, -0.27854300726557774,
			0.6499336836196814, -0.6499336836196814,
		}
		got := ai.TruncateAndRenormalize(input, 4)
		requireCloseSlice(t, want, got, epsilon)
	})

	t.Run("768 -> 256 dims, real nomic-embed-text shape", func(t *testing.T) {
		got := ai.TruncateAndRenormalize(fixtureEmbeddingInput768, 256)
		requireCloseSlice(t, fixtureEmbeddingOutput256, got, epsilon)

		var normSq float64
		for _, v := range got {
			normSq += v * v
		}
		require.InDelta(t, 1.0, math.Sqrt(normSq), epsilon, "output must be L2-normalized")
	})

	t.Run("all-zero vector: variance is zero, norm guard avoids NaN", func(t *testing.T) {
		got := ai.TruncateAndRenormalize(make([]float64, 8), 4)
		requireCloseSlice(t, []float64{0, 0, 0, 0}, got, epsilon)
	})

	t.Run("vector already at or below target dim passes through unchanged", func(t *testing.T) {
		input := []float64{1, 2, 3}
		got := ai.TruncateAndRenormalize(input, 8)
		requireCloseSlice(t, input, got, epsilon)
	})
}

func TestToFloat32(t *testing.T) {
	got := ai.ToFloat32([]float64{0.5, -0.25, 1.0})
	require.Equal(t, []float32{0.5, -0.25, 1.0}, got)
}

func requireCloseSlice(t *testing.T, want, got []float64, epsilon float64) {
	t.Helper()
	require.Len(t, got, len(want))
	for i := range want {
		require.InDelta(t, want[i], got[i], epsilon, "index %d", i)
	}
}
