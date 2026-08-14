package ai

import (
	"context"
	"fmt"

	openai "github.com/sashabaranov/go-openai"
)

// OpenAICompatibleChatModel talks to any OpenAI-compatible chat completions
// endpoint. Used for both AI_PROVIDER=openai and AI_PROVIDER=groq — Groq's
// API is OpenAI-compatible, reached via a custom base URL, which is a
// cleaner integration than LangChainService's hand-rolled fetch for the
// Groq case on the Nest side (be/src/shared/ai/langchain.service.ts).
type OpenAICompatibleChatModel struct {
	client      *openai.Client
	model       string
	temperature float32
}

// NewOpenAIChatModel builds a chat model against the real OpenAI API.
func NewOpenAIChatModel(apiKey, model string, temperature float64) *OpenAICompatibleChatModel {
	return &OpenAICompatibleChatModel{
		client:      openai.NewClient(apiKey),
		model:       model,
		temperature: float32(temperature),
	}
}

// NewGroqChatModel points the OpenAI client at Groq's OpenAI-compatible
// endpoint instead — this is the provider actually configured in this
// project's .env (AI_PROVIDER=groq).
func NewGroqChatModel(apiKey, model string, temperature float64) *OpenAICompatibleChatModel {
	cfg := openai.DefaultConfig(apiKey)
	cfg.BaseURL = "https://api.groq.com/openai/v1"
	return &OpenAICompatibleChatModel{
		client:      openai.NewClientWithConfig(cfg),
		model:       model,
		temperature: float32(temperature),
	}
}

// NewOpenAICompatibleChatModelForTesting points the client at an arbitrary
// base URL (e.g. an httptest.Server) so tests can assert on the exact
// request shape sent to an OpenAI-compatible endpoint.
func NewOpenAICompatibleChatModelForTesting(baseURL, model string, temperature float64) *OpenAICompatibleChatModel {
	cfg := openai.DefaultConfig("test-key")
	cfg.BaseURL = baseURL
	return &OpenAICompatibleChatModel{
		client:      openai.NewClientWithConfig(cfg),
		model:       model,
		temperature: float32(temperature),
	}
}

func (m *OpenAICompatibleChatModel) Chat(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	messages := make([]openai.ChatCompletionMessage, 0, 2)
	if systemPrompt != "" {
		messages = append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleSystem, Content: systemPrompt})
	}
	messages = append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: userPrompt})

	resp, err := m.client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:       m.model,
		Temperature: m.temperature,
		Messages:    messages,
	})
	if err != nil {
		return "", fmt.Errorf("chat completion: %w", err)
	}
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("chat completion: no choices returned")
	}
	return resp.Choices[0].Message.Content, nil
}
