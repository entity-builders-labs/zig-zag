// Package wiring holds construction logic shared between cmd/api and
// cmd/cli — both binaries need the same AI-provider selection (matching
// config to a concrete ai.ChatModel/Embedder/ImageClient), so it lives
// here once rather than being duplicated in two separate main packages
// (Go doesn't allow importing between two `main` packages directly).
package wiring

import (
	"time"

	openai "github.com/sashabaranov/go-openai"

	appai "github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
)

// ChatModel picks the chat provider per AI_PROVIDER, matching
// LangChainService.initializeModels' switch. This project's actual .env
// has AI_PROVIDER=groq.
func ChatModel(cfg config.AIConfig) appai.ChatModel {
	switch cfg.Provider {
	case config.AIProviderGroq:
		return appai.NewGroqChatModel(cfg.GroqAPIKey, cfg.DefaultModel, cfg.Temperature)
	case config.AIProviderOllama:
		return appai.NewOllamaChatModel(cfg.OllamaBaseURL, cfg.DefaultModel, cfg.OllamaAPIKey, time.Duration(cfg.OllamaTimeoutMS)*time.Millisecond)
	default:
		return appai.NewOpenAIChatModel(cfg.OpenAIAPIKey, cfg.DefaultModel, cfg.Temperature)
	}
}

// Embedder picks the embedding provider per EMBEDDING_PROVIDER. This
// project's actual .env has EMBEDDING_PROVIDER=ollama; OpenAI/Bedrock
// adapters aren't ported yet (see the migration plan) since they're not
// what's actually configured — Ollama is fully implemented.
func Embedder(cfg config.AIConfig) appai.Embedder {
	timeout := time.Duration(cfg.OllamaTimeoutMS) * time.Millisecond
	return appai.NewOllamaEmbedder(cfg.OllamaBaseURL, cfg.EmbeddingsModel, cfg.OllamaAPIKey, cfg.EmbeddingDimensions, timeout)
}

// ImageClient returns nil (the untyped interface nil, not a nil
// *openai.Client boxed in a non-nil interface — a classic Go footgun) when
// no API key is configured, so ai.ImageGenerator's `client == nil` check
// works correctly and image generation becomes a clean no-op.
func ImageClient(cfg config.AIConfig) appai.ImageClient {
	if cfg.OpenAIAPIKey == "" {
		return nil
	}
	return openai.NewClient(cfg.OpenAIAPIKey)
}
