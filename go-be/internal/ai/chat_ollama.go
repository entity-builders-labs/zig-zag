package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// OllamaChatModel talks to Ollama's /api/chat endpoint directly over raw
// HTTP rather than a client library — pulling in Ollama's own Go module
// drags in its entire server codebase (and forces a newer Go toolchain)
// for what is, in practice, two simple JSON endpoints. Nest's own Ollama
// embeddings code (AiEmbeddingService) already takes the same approach.
type OllamaChatModel struct {
	baseURL string
	model   string
	apiKey  string
	client  *http.Client
}

func NewOllamaChatModel(baseURL, model, apiKey string, timeout time.Duration) *OllamaChatModel {
	return &OllamaChatModel{
		baseURL: baseURL,
		model:   model,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: timeout},
	}
}

type ollamaChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaChatRequest struct {
	Model    string              `json:"model"`
	Messages []ollamaChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
}

type ollamaChatResponse struct {
	Message ollamaChatMessage `json:"message"`
}

func (m *OllamaChatModel) Chat(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	body, err := json.Marshal(ollamaChatRequest{
		Model: m.model,
		Messages: []ollamaChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Stream: false,
	})
	if err != nil {
		return "", fmt.Errorf("marshal ollama chat request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.baseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build ollama chat request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if m.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+m.apiKey)
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama chat request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama chat error: status %d", resp.StatusCode)
	}

	var out ollamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode ollama chat response: %w", err)
	}
	return out.Message.Content, nil
}
