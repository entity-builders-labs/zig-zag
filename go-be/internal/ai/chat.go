package ai

import "context"

// ChatModel is the minimal capability the rest of the AI layer needs from
// an LLM provider: a system prompt and an already-interpolated user prompt
// in, raw text out. Kept narrow (not mirroring LangChain's much larger
// surface) since this exact shape is what gets mocked for tour/activity
// generation tests.
type ChatModel interface {
	Chat(ctx context.Context, systemPrompt, userPrompt string) (string, error)
}
