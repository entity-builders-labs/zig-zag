package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Embedder is the minimal capability VectorStore needs: text in, a
// fixed-width embedding vector out. Mirrors the subset of LangChain's
// Embeddings interface AiEmbeddingService actually exposes (embedQuery /
// embedDocuments).
type Embedder interface {
	EmbedQuery(ctx context.Context, text string) ([]float64, error)
	EmbedDocuments(ctx context.Context, texts []string) ([][]float64, error)
}

// OllamaEmbedder ports AiEmbeddingService's Ollama adapter — the provider
// actually configured in this project's .env (EMBEDDING_PROVIDER=ollama) —
// via raw HTTP against /api/embed, same as the TS version (no LangChain
// abstraction involved there either), with the same truncate+renormalize
// step applied to fit the fixed-width pgvector column.
type OllamaEmbedder struct {
	baseURL   string
	model     string
	apiKey    string
	targetDim int
	client    *http.Client
}

func NewOllamaEmbedder(baseURL, model, apiKey string, targetDim int, timeout time.Duration) *OllamaEmbedder {
	return &OllamaEmbedder{
		baseURL:   baseURL,
		model:     model,
		apiKey:    apiKey,
		targetDim: targetDim,
		client:    &http.Client{Timeout: timeout},
	}
}

type ollamaEmbedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type ollamaEmbedResponse struct {
	// Ollama's /api/embed returns {embeddings: [[...]]} (plural, one vector
	// per input) even for a single input — matches the TS comment on the
	// exact same gotcha in ai-embedding.service.ts.
	Embeddings [][]float64 `json:"embeddings"`
}

func (e *OllamaEmbedder) embed(ctx context.Context, text string) ([]float64, error) {
	body, err := json.Marshal(ollamaEmbedRequest{Model: e.model, Input: text})
	if err != nil {
		return nil, fmt.Errorf("marshal ollama embed request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+"/api/embed", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build ollama embed request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if e.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.apiKey)
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama embed request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama embeddings error: status %d", resp.StatusCode)
	}

	var out ollamaEmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode ollama embed response: %w", err)
	}
	if len(out.Embeddings) == 0 {
		return nil, fmt.Errorf("ollama embeddings response had no vectors")
	}

	return TruncateAndRenormalize(out.Embeddings[0], e.targetDim), nil
}

func (e *OllamaEmbedder) EmbedQuery(ctx context.Context, text string) ([]float64, error) {
	return e.embed(ctx, text)
}

func (e *OllamaEmbedder) EmbedDocuments(ctx context.Context, texts []string) ([][]float64, error) {
	out := make([][]float64, len(texts))
	for i, text := range texts {
		vec, err := e.embed(ctx, text)
		if err != nil {
			return nil, fmt.Errorf("embed document %d: %w", i, err)
		}
		out[i] = vec
	}
	return out, nil
}
