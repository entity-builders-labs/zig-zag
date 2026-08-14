package ai_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
)

// TestOpenAICompatibleChatModel_Chat guards against a regression found via
// live E2E testing against Groq: Groq's chat-completions schema rejects a
// 'role:system' message with empty content ("property 'content' is
// missing"), which broke every caller that passes an empty systemPrompt
// (e.g. Categorizer's GenerateCompletionResponse, used for AI category
// classification during Places crawls) — Nest's own Groq completion path
// never sends a system message at all for this case.
func TestOpenAICompatibleChatModel_Chat(t *testing.T) {
	tests := []struct {
		name             string
		systemPrompt     string
		userPrompt       string
		wantSystemPrompt bool
	}{
		{
			name:             "empty system prompt is omitted from the request entirely",
			systemPrompt:     "",
			userPrompt:       "Classify: museum",
			wantSystemPrompt: false,
		},
		{
			name:             "non-empty system prompt is sent as its own message",
			systemPrompt:     "You are a tour guide.",
			userPrompt:       "Suggest activities near Bariloche.",
			wantSystemPrompt: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotBody struct {
				Messages []struct {
					Role    string `json:"role"`
					Content string `json:"content"`
				} `json:"messages"`
			}

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))
				_ = json.NewEncoder(w).Encode(map[string]any{
					"choices": []map[string]any{
						{"message": map[string]any{"content": "ok"}},
					},
				})
			}))
			defer server.Close()

			model := ai.NewOpenAICompatibleChatModelForTesting(server.URL, "test-model", 0.5)

			got, err := model.Chat(t.Context(), tt.systemPrompt, tt.userPrompt)
			require.NoError(t, err)
			require.Equal(t, "ok", got)

			hasSystem := false
			for _, m := range gotBody.Messages {
				if m.Role == "system" {
					hasSystem = true
					require.NotEmpty(t, m.Content, "system message must never be sent with empty content")
				}
			}
			require.Equal(t, tt.wantSystemPrompt, hasSystem)

			require.Equal(t, "user", gotBody.Messages[len(gotBody.Messages)-1].Role)
			require.Equal(t, tt.userPrompt, gotBody.Messages[len(gotBody.Messages)-1].Content)
		})
	}
}
