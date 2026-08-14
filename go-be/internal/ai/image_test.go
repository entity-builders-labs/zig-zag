package ai_test

import (
	"context"
	"testing"

	openai "github.com/sashabaranov/go-openai"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/ai/mocks"
)

func TestImageGenerator_GenerateImage(t *testing.T) {
	tests := []struct {
		name       string
		bypass     bool
		enabled    bool
		nilClient  bool
		setupMocks func(m *mocks.ImageClient)
		want       string
	}{
		{
			name:       "bypass=true is a no-op, matching Nest's default-true param",
			bypass:     true,
			enabled:    true,
			setupMocks: func(m *mocks.ImageClient) {}, // expects zero calls
			want:       "",
		},
		{
			name:       "AI disabled is a no-op",
			bypass:     false,
			enabled:    false,
			setupMocks: func(m *mocks.ImageClient) {},
			want:       "",
		},
		{
			name:       "nil client (no API key) is a no-op",
			bypass:     false,
			enabled:    true,
			nilClient:  true,
			setupMocks: func(m *mocks.ImageClient) {},
			want:       "",
		},
		{
			name:    "dall-e-3 succeeds, no fallback needed",
			bypass:  false,
			enabled: true,
			setupMocks: func(m *mocks.ImageClient) {
				m.EXPECT().
					CreateImage(mock.Anything, mock.MatchedBy(func(r openai.ImageRequest) bool {
						return r.Model == openai.CreateImageModelDallE3 && r.Size == "1024x1024"
					})).
					Return(openai.ImageResponse{Data: []openai.ImageResponseDataInner{{URL: "https://example.com/cover.png"}}}, nil)
			},
			want: "https://example.com/cover.png",
		},
		{
			name:    "dall-e-3 model_not_found falls back to dall-e-2",
			bypass:  false,
			enabled: true,
			setupMocks: func(m *mocks.ImageClient) {
				m.EXPECT().
					CreateImage(mock.Anything, mock.MatchedBy(func(r openai.ImageRequest) bool {
						return r.Model == openai.CreateImageModelDallE3
					})).
					Return(openai.ImageResponse{}, &openai.APIError{Code: "model_not_found", HTTPStatusCode: 404})
				m.EXPECT().
					CreateImage(mock.Anything, mock.MatchedBy(func(r openai.ImageRequest) bool {
						return r.Model == openai.CreateImageModelDallE2 && r.Size == "512x512"
					})).
					Return(openai.ImageResponse{Data: []openai.ImageResponseDataInner{{URL: "https://example.com/fallback.png"}}}, nil)
			},
			want: "https://example.com/fallback.png",
		},
		{
			name:    "dall-e-3 400 falls back to dall-e-2",
			bypass:  false,
			enabled: true,
			setupMocks: func(m *mocks.ImageClient) {
				m.EXPECT().
					CreateImage(mock.Anything, mock.MatchedBy(func(r openai.ImageRequest) bool {
						return r.Model == openai.CreateImageModelDallE3
					})).
					Return(openai.ImageResponse{}, &openai.APIError{HTTPStatusCode: 400})
				m.EXPECT().
					CreateImage(mock.Anything, mock.MatchedBy(func(r openai.ImageRequest) bool {
						return r.Model == openai.CreateImageModelDallE2
					})).
					Return(openai.ImageResponse{Data: []openai.ImageResponseDataInner{{URL: "https://example.com/fallback.png"}}}, nil)
			},
			want: "https://example.com/fallback.png",
		},
		{
			name:    "non-fallback-eligible error returns empty, no dall-e-2 attempt",
			bypass:  false,
			enabled: true,
			setupMocks: func(m *mocks.ImageClient) {
				m.EXPECT().
					CreateImage(mock.Anything, mock.Anything).
					Return(openai.ImageResponse{}, &openai.APIError{HTTPStatusCode: 500})
			},
			want: "",
		},
		{
			name:    "dall-e-2 fallback itself failing returns empty, not an error",
			bypass:  false,
			enabled: true,
			setupMocks: func(m *mocks.ImageClient) {
				m.EXPECT().
					CreateImage(mock.Anything, mock.MatchedBy(func(r openai.ImageRequest) bool {
						return r.Model == openai.CreateImageModelDallE3
					})).
					Return(openai.ImageResponse{}, &openai.APIError{HTTPStatusCode: 400})
				m.EXPECT().
					CreateImage(mock.Anything, mock.MatchedBy(func(r openai.ImageRequest) bool {
						return r.Model == openai.CreateImageModelDallE2
					})).
					Return(openai.ImageResponse{}, &openai.APIError{HTTPStatusCode: 500})
			},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := mocks.NewImageClient(t)
			tt.setupMocks(client)

			var gen *ai.ImageGenerator
			if tt.nilClient {
				gen = ai.NewImageGenerator(nil, tt.enabled)
			} else {
				gen = ai.NewImageGenerator(client, tt.enabled)
			}

			got := gen.GenerateImage(context.Background(), "a scenic mountain cover", "512x512", tt.bypass)
			require.Equal(t, tt.want, got)
		})
	}
}
