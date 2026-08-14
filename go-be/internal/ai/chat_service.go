package ai

import (
	"context"
	"fmt"
	"strings"
)

// ChatService ports LangChainService.generateChatResponse
// (be/src/shared/ai/langchain.service.ts): a cache lookup keyed on the raw
// prompt *templates* (not the interpolated prompt actually sent to the
// model), simple {variable} substitution into the user prompt, then a call
// through to the underlying ChatModel and a cache write of the result.
type ChatService struct {
	model ChatModel
	cache *Cache
}

func NewChatService(model ChatModel, cache *Cache) *ChatService {
	return &ChatService{model: model, cache: cache}
}

// GenerateChatResponse mirrors generateChatResponse(systemPrompt, userPrompt, variables).
// LangChain's ChatPromptTemplate.fromMessages([SystemMessagePromptTemplate,
// HumanMessagePromptTemplate]) treats BOTH messages as templates — so both
// systemPromptTemplate and userPromptTemplate get {name}-style substitution
// here too (a simplified stand-in for LangChain's PromptTemplate.format,
// sufficient for the substitution this codebase's prompts actually rely
// on). Some callers (e.g. activity metadata generation) put their only
// placeholder in the system template and pass an empty user prompt — that
// only works correctly if the system template is interpolated too.
// The cache key uses the raw (pre-interpolation) templates, matching
// Nest's cache key exactly (built from the original DTO-level strings, not
// the template-formatted ones).
func (s *ChatService) GenerateChatResponse(ctx context.Context, systemPromptTemplate, userPromptTemplate string, variables map[string]string) (string, error) {
	cachePrompt := systemPromptTemplate + "|" + userPromptTemplate
	cacheOptions := map[string]any{"type": "chat", "variables": variables}

	if cached, ok, err := s.cache.Get(cachePrompt, cacheOptions); err == nil && ok {
		return cached, nil
	}

	response, err := s.model.Chat(ctx, interpolate(systemPromptTemplate, variables), interpolate(userPromptTemplate, variables))
	if err != nil {
		return "", fmt.Errorf("generate chat response: %w", err)
	}

	_ = s.cache.Set(cachePrompt, cacheOptions, response)
	return response, nil
}

// GenerateCompletionResponse mirrors LangChainService.generateCompletionResponse:
// a plain (no system prompt) completion call, cached under a distinct
// "completion" options bucket kept separate from GenerateChatResponse's
// "chat" bucket — matching Nest's cache key exactly so the two never collide.
// On Groq (the actually-configured provider), a "completion" is just a chat
// call with no system message: Groq only serves models through
// /v1/chat/completions, so that's what both paths hit either way.
func (s *ChatService) GenerateCompletionResponse(ctx context.Context, promptTemplate string, variables map[string]string) (string, error) {
	cacheOptions := map[string]any{"type": "completion", "variables": variables}

	if cached, ok, err := s.cache.Get(promptTemplate, cacheOptions); err == nil && ok {
		return cached, nil
	}

	response, err := s.model.Chat(ctx, "", interpolate(promptTemplate, variables))
	if err != nil {
		return "", fmt.Errorf("generate completion response: %w", err)
	}

	_ = s.cache.Set(promptTemplate, cacheOptions, response)
	return response, nil
}

// interpolate replaces {key} tokens in template with their value from vars.
func interpolate(template string, vars map[string]string) string {
	if len(vars) == 0 {
		return template
	}
	result := template
	for k, v := range vars {
		result = strings.ReplaceAll(result, "{"+k+"}", v)
	}
	return result
}
