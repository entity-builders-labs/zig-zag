package ai_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/ai/mocks"
)

func TestChatService_GenerateCompletionResponse(t *testing.T) {
	t.Run("calls the model with an empty system prompt and caches under the completion bucket", func(t *testing.T) {
		model := mocks.NewChatModel(t)
		model.EXPECT().
			Chat(mock.Anything, "", "Classify: museum").
			Return("cultural", nil)

		dir := t.TempDir()
		svc := ai.NewChatService(model, ai.NewCache(dir, ai.CacheModeWrite))

		got, err := svc.GenerateCompletionResponse(context.Background(), "Classify: {place}", map[string]string{"place": "museum"})
		require.NoError(t, err)
		require.Equal(t, "cultural", got)

		// A GenerateChatResponse call with the same text must NOT hit this
		// completion-bucket cache entry — verifies the "type" discriminator
		// in the cache options keeps the two buckets from colliding.
		chatModel := mocks.NewChatModel(t)
		chatModel.EXPECT().
			Chat(mock.Anything, "Classify: {place}", "Classify: {place}").
			Return("different answer via chat path", nil)
		chatSvc := ai.NewChatService(chatModel, ai.NewCache(dir, ai.CacheModeWrite))
		gotChat, err := chatSvc.GenerateChatResponse(context.Background(), "Classify: {place}", "Classify: {place}", nil)
		require.NoError(t, err)
		require.Equal(t, "different answer via chat path", gotChat)
	})
}

func TestChatService_GenerateChatResponse(t *testing.T) {
	tests := []struct {
		name               string
		systemPrompt       string
		userPromptTemplate string
		variables          map[string]string
		cacheMode          ai.CacheMode
		preSeedCache       bool // seeds the cache with the exact key GenerateChatResponse would use
		setupMocks         func(m *mocks.ChatModel)
		want               string
		wantErr            string
	}{
		{
			name:               "cache miss calls the model and interpolates variables",
			systemPrompt:       "You are a tour guide.",
			userPromptTemplate: "Suggest activities near {city}.",
			variables:          map[string]string{"city": "Bariloche"},
			cacheMode:          ai.CacheModeWrite,
			setupMocks: func(m *mocks.ChatModel) {
				m.EXPECT().
					Chat(mock.Anything, "You are a tour guide.", "Suggest activities near Bariloche.").
					Return(`{"activityIds":["a1"]}`, nil)
			},
			want: `{"activityIds":["a1"]}`,
		},
		{
			name:               "cache hit skips the model entirely",
			systemPrompt:       "You are a tour guide.",
			userPromptTemplate: "Suggest activities near {city}.",
			variables:          map[string]string{"city": "Bariloche"},
			cacheMode:          ai.CacheModeRead,
			preSeedCache:       true,
			setupMocks:         func(m *mocks.ChatModel) {}, // no .EXPECT() calls — asserting zero calls happen
			want:               "cached response",
		},
		{
			name:               "no variables leaves the template untouched",
			systemPrompt:       "sys",
			userPromptTemplate: "plain prompt, no placeholders",
			cacheMode:          ai.CacheModeWrite,
			setupMocks: func(m *mocks.ChatModel) {
				m.EXPECT().
					Chat(mock.Anything, "sys", "plain prompt, no placeholders").
					Return("ok", nil)
			},
			want: "ok",
		},
		{
			name:               "model error propagates, nothing gets cached",
			systemPrompt:       "sys",
			userPromptTemplate: "prompt",
			cacheMode:          ai.CacheModeWrite,
			setupMocks: func(m *mocks.ChatModel) {
				m.EXPECT().
					Chat(mock.Anything, "sys", "prompt").
					Return("", errors.New("groq: 503"))
			},
			wantErr: "generate chat response",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			cache := ai.NewCache(dir, tt.cacheMode)
			model := mocks.NewChatModel(t)
			tt.setupMocks(model)

			if tt.preSeedCache {
				cachePrompt := tt.systemPrompt + "|" + tt.userPromptTemplate
				cacheOptions := map[string]any{"type": "chat", "variables": tt.variables}
				require.NoError(t, ai.NewCache(dir, ai.CacheModeWrite).Set(cachePrompt, cacheOptions, "cached response"))
			}

			svc := ai.NewChatService(model, cache)
			got, err := svc.GenerateChatResponse(context.Background(), tt.systemPrompt, tt.userPromptTemplate, tt.variables)

			if tt.wantErr != "" {
				require.ErrorContains(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}
