// Package config loads runtime configuration from environment variables,
// mirroring be/src/core/config and be/src/shared/ai/ai.config.ts so the Go
// backend reads the same .env as the NestJS one during the migration.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type AIProvider string

const (
	AIProviderOpenAI AIProvider = "openai"
	AIProviderGroq   AIProvider = "groq"
	AIProviderOllama AIProvider = "ollama"
)

type EmbeddingProvider string

const (
	EmbeddingProviderOpenAI  EmbeddingProvider = "openai"
	EmbeddingProviderOllama  EmbeddingProvider = "ollama"
	EmbeddingProviderBedrock EmbeddingProvider = "bedrock"
)

type AICacheMode string

const (
	AICacheModeOff   AICacheMode = "off"
	AICacheModeRead  AICacheMode = "read"
	AICacheModeWrite AICacheMode = "write"
)

type Config struct {
	App      AppConfig
	CORS     CORSConfig
	Swagger  SwaggerConfig
	Database DatabaseConfig
	Auth     AuthConfig
	AI       AIConfig
	Places   PlacesConfig
	// StoragePath is STORAGE_PATH (default "<cwd>/storage") — the shared
	// root both the AI cache (storage/ai-cache/) and the maps cache
	// (storage/maps-cache/) live under.
	StoragePath string
}

type AppConfig struct {
	Port        int
	Environment string
	Name        string
}

func (a AppConfig) IsProduction() bool { return a.Environment == "production" }

type CORSConfig struct {
	// Raw CORS_ORIGIN value: "*" or a comma-separated origin list.
	Origin string
}

// AllowAny mirrors main.ts's special case: the literal string "*" enables
// reflecting any Origin, which is NOT the same as passing ["*"] to a
// same-origin allowlist check.
func (c CORSConfig) AllowAny() bool { return c.Origin == "*" }

// AllowedOrigins returns the parsed allowlist. Only meaningful when AllowAny() is false.
func (c CORSConfig) AllowedOrigins() []string { return splitCSV(c.Origin) }

type SwaggerConfig struct {
	Enabled bool
	Path    string
}

type DatabaseConfig struct {
	URL       string
	DirectURL string
}

type AuthConfig struct {
	JWTAccessSecret        string
	JWTAccessExpiresIn     string
	JWTRefreshSecret       string
	JWTRefreshExpiresIn    string
	GoogleClientIDs        []string
	AppleClientIDs         []string
	EmailOTPTTLMinutes     int
	EmailOTPMaxAttempts    int
	EmailOTPResendCooldown int
	SMTPHost               string
	SMTPPort               int
	SMTPSecure             bool
	SMTPUser               string
	SMTPPass               string
	SMTPFrom               string
}

type AIConfig struct {
	Enabled             bool
	Provider            AIProvider
	DefaultModel        string
	Temperature         float64
	TimeoutMS           int
	OllamaTimeoutMS     int
	OpenAIAPIKey        string
	GroqAPIKey          string
	OllamaBaseURL       string
	OllamaAPIKey        string
	OllamaNumCtx        int
	EmbeddingsModel     string
	EmbeddingProvider   EmbeddingProvider
	EmbeddingDimensions int
	AWSRegion           string
	CacheMode           AICacheMode
	// CacheDir is StoragePath/ai-cache, matching AiCacheService's cacheDir.
	CacheDir string
}

type PlacesConfig struct {
	Provider         string // google | geoapify
	GoogleMapsAPIKey string
	GeoapifyAPIKey   string
	UseMockMaps      bool
	MockMapsMode     string
	AllowAPIFallback bool
}

// Load reads and validates configuration from the process environment.
// It returns an error instead of panicking so callers (main, tests) decide
// how to fail — mirroring main.ts's production-only required-var checks.
func Load() (*Config, error) {
	isProduction := os.Getenv("NODE_ENV") == "production"

	corsOrigin := os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		if isProduction {
			return nil, fmt.Errorf("CORS_ORIGIN must be set in production (comma-separated origins, or \"*\" to allow any)")
		}
		corsOrigin = "*"
	}

	accessSecret := os.Getenv("JWT_ACCESS_SECRET")
	refreshSecret := os.Getenv("JWT_REFRESH_SECRET")
	if accessSecret == "" || refreshSecret == "" {
		if isProduction {
			return nil, fmt.Errorf("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production")
		}
		if accessSecret == "" {
			accessSecret = "dev-insecure-access-secret"
		}
		if refreshSecret == "" {
			refreshSecret = "dev-insecure-refresh-secret"
		}
	}

	provider := AIProvider(getenvDefault("AI_PROVIDER", string(AIProviderOpenAI)))

	defaultModel := os.Getenv("AI_MODEL")
	if defaultModel == "" {
		if provider == AIProviderOpenAI {
			defaultModel = getenvDefault("OPENAI_DEFAULT_MODEL", "gpt-3.5-turbo")
		} else {
			defaultModel = "llama3.2"
		}
	}

	baseTimeout := getenvInt("OPENAI_TIMEOUT", 60000)

	embeddingProvider := EmbeddingProvider(os.Getenv("EMBEDDING_PROVIDER"))
	if embeddingProvider == "" {
		if isProduction {
			embeddingProvider = EmbeddingProviderOpenAI
		} else {
			embeddingProvider = EmbeddingProviderOllama
		}
	}

	embeddingsModel := os.Getenv("EMBEDDINGS_MODEL")
	if embeddingsModel == "" {
		if embeddingProvider == EmbeddingProviderBedrock {
			embeddingsModel = "amazon.titan-embed-text-v2:0"
		} else {
			embeddingsModel = "nomic-embed-text"
		}
	}

	embeddingDimensions := getenvInt("EMBEDDING_DIMENSIONS", 256)
	if embeddingDimensions != 256 && embeddingDimensions != 512 && embeddingDimensions != 1024 {
		embeddingDimensions = 256
	}

	storagePath := os.Getenv("STORAGE_PATH")
	if storagePath == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("resolve default STORAGE_PATH: %w", err)
		}
		storagePath = filepath.Join(cwd, "storage")
	}

	cfg := &Config{
		App: AppConfig{
			Port:        getenvInt("PORT", 3000),
			Environment: getenvDefault("NODE_ENV", "development"),
			Name:        getenvDefault("APP_NAME", "ZigZag API"),
		},
		CORS: CORSConfig{Origin: corsOrigin},
		Swagger: SwaggerConfig{
			Enabled: os.Getenv("SWAGGER_ENABLED") == "true",
			Path:    "api/docs",
		},
		Database: DatabaseConfig{
			URL:       os.Getenv("DATABASE_URL"),
			DirectURL: os.Getenv("DIRECT_URL"),
		},
		Auth: AuthConfig{
			JWTAccessSecret:        accessSecret,
			JWTAccessExpiresIn:     getenvDefault("JWT_ACCESS_EXPIRES_IN", "15m"),
			JWTRefreshSecret:       refreshSecret,
			JWTRefreshExpiresIn:    getenvDefault("JWT_REFRESH_EXPIRES_IN", "30d"),
			GoogleClientIDs:        splitCSV(os.Getenv("GOOGLE_CLIENT_IDS")),
			AppleClientIDs:         splitCSV(os.Getenv("APPLE_CLIENT_IDS")),
			EmailOTPTTLMinutes:     getenvInt("EMAIL_OTP_TTL_MINUTES", 10),
			EmailOTPMaxAttempts:    getenvInt("EMAIL_OTP_MAX_ATTEMPTS", 5),
			EmailOTPResendCooldown: getenvInt("EMAIL_OTP_RESEND_COOLDOWN_SECONDS", 60),
			SMTPHost:               os.Getenv("SMTP_HOST"),
			SMTPPort:               getenvInt("SMTP_PORT", 587),
			SMTPSecure:             os.Getenv("SMTP_SECURE") == "true",
			SMTPUser:               os.Getenv("SMTP_USER"),
			SMTPPass:               os.Getenv("SMTP_PASS"),
			SMTPFrom:               getenvDefault("SMTP_FROM", "Zig-Zag <no-reply@zigzag.app>"),
		},
		AI: AIConfig{
			// Nest: enableAi = process.env.ENABLE_AI !== 'false' (default true).
			Enabled:             os.Getenv("ENABLE_AI") != "false",
			Provider:            provider,
			DefaultModel:        defaultModel,
			Temperature:         getenvFloat("OPENAI_TEMPERATURE", 0.7),
			TimeoutMS:           baseTimeout,
			OllamaTimeoutMS:     getenvInt("OLLAMA_TIMEOUT", baseTimeout*4),
			OpenAIAPIKey:        os.Getenv("OPENAI_API_KEY"),
			GroqAPIKey:          os.Getenv("GROQ_API_KEY"),
			OllamaBaseURL:       getenvDefault("OLLAMA_BASE_URL", "http://localhost:11434"),
			OllamaAPIKey:        os.Getenv("OLLAMA_API_KEY"),
			OllamaNumCtx:        getenvInt("OLLAMA_NUM_CTX", 4096),
			EmbeddingsModel:     embeddingsModel,
			EmbeddingProvider:   embeddingProvider,
			EmbeddingDimensions: embeddingDimensions,
			AWSRegion:           getenvDefault("AWS_REGION", "us-east-1"),
			CacheMode:           AICacheMode(getenvDefault("AI_CACHE_MODE", string(AICacheModeOff))),
			CacheDir:            filepath.Join(storagePath, "ai-cache"),
		},
		Places: PlacesConfig{
			Provider:         getenvDefault("PLACES_PROVIDER", "geoapify"),
			GoogleMapsAPIKey: os.Getenv("GOOGLE_MAPS_API_KEY"),
			GeoapifyAPIKey:   os.Getenv("GEOAPIFY_API_KEY"),
			UseMockMaps:      os.Getenv("USE_MOCK_MAPS") == "true",
			MockMapsMode:     getenvDefault("MOCK_MAPS_MODE", "read"),
			AllowAPIFallback: os.Getenv("ALLOW_API_FALLBACK") == "true",
		},
		StoragePath: storagePath,
	}

	return cfg, nil
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func getenvFloat(key string, def float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
