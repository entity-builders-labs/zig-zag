package ai

import "math"

// TruncateAndRenormalize ports AiEmbeddingService.truncateAndRenormalize
// (be/src/shared/ai/services/ai-embedding.service.ts) exactly, including
// operating in float64 throughout (matching JS number semantics) rather
// than float32 — the caller narrows to float32 only when handing the
// result to pgvector-go for storage, so this computation doesn't pick up
// extra rounding error the original TS never had.
//
// Ollama's `nomic-embed-text` tag resolves to nomic-embed-text-v1.5, which
// is trained with Matryoshka Representation Learning specifically so its
// output can be shrunk to match our fixed-width pgvector column. Nomic's
// documented procedure is layer-norm -> truncate -> L2-normalize, in that
// order — skipping the layer-norm step produces *a* vector but not the one
// the model was actually trained to produce at reduced width.
func TruncateAndRenormalize(vector []float64, targetDim int) []float64 {
	if len(vector) <= targetDim {
		return vector
	}

	n := float64(len(vector))
	var sum float64
	for _, v := range vector {
		sum += v
	}
	mean := sum / n

	var varianceSum float64
	for _, v := range vector {
		d := v - mean
		varianceSum += d * d
	}
	variance := varianceSum / n
	denom := math.Sqrt(variance + 1e-5)

	layerNormed := make([]float64, len(vector))
	for i, v := range vector {
		layerNormed[i] = (v - mean) / denom
	}

	truncated := make([]float64, targetDim)
	copy(truncated, layerNormed[:targetDim])

	var normSq float64
	for _, v := range truncated {
		normSq += v * v
	}
	norm := math.Sqrt(normSq)

	if norm > 0 {
		for i, v := range truncated {
			truncated[i] = v / norm
		}
	}
	return truncated
}

// ToFloat32 narrows a []float64 embedding to []float32 for pgvector-go,
// which stores vector(N) columns as float32. Kept as a separate step (not
// folded into TruncateAndRenormalize) so the renormalization math itself
// stays at full float64 precision.
func ToFloat32(vector []float64) []float32 {
	out := make([]float32, len(vector))
	for i, v := range vector {
		out[i] = float32(v)
	}
	return out
}
