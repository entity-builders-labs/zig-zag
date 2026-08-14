package config_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/config"
)

// clearAllEnv resets every env var config.Load reads to "", so each table
// case starts from a clean slate regardless of the host shell's
// environment — config.Load's helpers treat an empty string as "unset".
func clearAllEnv(t *testing.T) {
	t.Helper()
	vars := []string{
		"NODE_ENV", "PORT", "APP_NAME", "CORS_ORIGIN", "SWAGGER_ENABLED",
		"DATABASE_URL", "DIRECT_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET",
		"JWT_ACCESS_EXPIRES_IN", "JWT_REFRESH_EXPIRES_IN", "GOOGLE_CLIENT_IDS",
		"APPLE_CLIENT_IDS", "EMAIL_OTP_TTL_MINUTES", "EMAIL_OTP_MAX_ATTEMPTS",
		"EMAIL_OTP_RESEND_COOLDOWN_SECONDS", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
		"SMTP_USER", "SMTP_PASS", "SMTP_FROM", "ENABLE_AI", "AI_PROVIDER", "AI_MODEL",
		"OPENAI_DEFAULT_MODEL", "OPENAI_TEMPERATURE", "OPENAI_TIMEOUT", "OLLAMA_TIMEOUT",
		"OPENAI_API_KEY", "GROQ_API_KEY", "OLLAMA_BASE_URL", "OLLAMA_API_KEY",
		"OLLAMA_NUM_CTX", "EMBEDDINGS_MODEL", "EMBEDDING_PROVIDER", "EMBEDDING_DIMENSIONS",
		"AWS_REGION", "AI_CACHE_MODE", "STORAGE_PATH", "PLACES_PROVIDER",
		"GOOGLE_MAPS_API_KEY", "GEOAPIFY_API_KEY", "USE_MOCK_MAPS", "MOCK_MAPS_MODE",
		"ALLOW_API_FALLBACK",
	}
	for _, v := range vars {
		t.Setenv(v, "")
	}
}

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		check   func(t *testing.T, cfg *config.Config)
		wantErr string
	}{
		{
			name: "dev defaults: wildcard CORS, insecure JWT secrets, ollama embeddings",
			env:  map[string]string{"NODE_ENV": "development"},
			check: func(t *testing.T, cfg *config.Config) {
				require.Equal(t, 3000, cfg.App.Port)
				require.True(t, cfg.CORS.AllowAny())
				require.Equal(t, "dev-insecure-access-secret", cfg.Auth.JWTAccessSecret)
				require.Equal(t, config.EmbeddingProviderOllama, cfg.AI.EmbeddingProvider)
				require.Equal(t, "nomic-embed-text", cfg.AI.EmbeddingsModel)
			},
		},
		{
			name:    "prod requires CORS_ORIGIN",
			env:     map[string]string{"NODE_ENV": "production"},
			wantErr: "CORS_ORIGIN must be set",
		},
		{
			name: "prod requires JWT secrets",
			env: map[string]string{
				"NODE_ENV":    "production",
				"CORS_ORIGIN": "https://zigzag.app",
			},
			wantErr: "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set",
		},
		{
			name: "prod defaults embedding provider to openai",
			env: map[string]string{
				"NODE_ENV":           "production",
				"CORS_ORIGIN":        "https://zigzag.app",
				"JWT_ACCESS_SECRET":  "s1",
				"JWT_REFRESH_SECRET": "s2",
			},
			check: func(t *testing.T, cfg *config.Config) {
				require.Equal(t, config.EmbeddingProviderOpenAI, cfg.AI.EmbeddingProvider)
			},
		},
		{
			name: "explicit groq/ollama split, matching the project's actual .env",
			env: map[string]string{
				"NODE_ENV":           "development",
				"AI_PROVIDER":        "groq",
				"EMBEDDING_PROVIDER": "ollama",
			},
			check: func(t *testing.T, cfg *config.Config) {
				require.Equal(t, config.AIProviderGroq, cfg.AI.Provider)
				require.Equal(t, config.EmbeddingProviderOllama, cfg.AI.EmbeddingProvider)
			},
		},
		{
			name: "bedrock embedding provider defaults the model to titan",
			env: map[string]string{
				"NODE_ENV":           "development",
				"EMBEDDING_PROVIDER": "bedrock",
			},
			check: func(t *testing.T, cfg *config.Config) {
				require.Equal(t, "amazon.titan-embed-text-v2:0", cfg.AI.EmbeddingsModel)
			},
		},
		{
			name: "invalid embedding dimensions falls back to 256",
			env: map[string]string{
				"NODE_ENV":             "development",
				"EMBEDDING_DIMENSIONS": "999",
			},
			check: func(t *testing.T, cfg *config.Config) {
				require.Equal(t, 256, cfg.AI.EmbeddingDimensions)
			},
		},
		{
			name: "ENABLE_AI defaults true unless explicitly false",
			env:  map[string]string{"NODE_ENV": "development", "ENABLE_AI": "nonsense"},
			check: func(t *testing.T, cfg *config.Config) {
				require.True(t, cfg.AI.Enabled)
			},
		},
		{
			name: "ENABLE_AI=false disables it",
			env:  map[string]string{"NODE_ENV": "development", "ENABLE_AI": "false"},
			check: func(t *testing.T, cfg *config.Config) {
				require.False(t, cfg.AI.Enabled)
			},
		},
		{
			name: "CORS allowlist parses comma-separated origins and trims whitespace",
			env: map[string]string{
				"NODE_ENV":    "development",
				"CORS_ORIGIN": "https://a.example.com, https://b.example.com",
			},
			check: func(t *testing.T, cfg *config.Config) {
				require.False(t, cfg.CORS.AllowAny())
				require.Equal(t, []string{"https://a.example.com", "https://b.example.com"}, cfg.CORS.AllowedOrigins())
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearAllEnv(t)
			for k, v := range tt.env {
				t.Setenv(k, v)
			}

			cfg, err := config.Load()
			if tt.wantErr != "" {
				require.ErrorContains(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			tt.check(t, cfg)
		})
	}
}
