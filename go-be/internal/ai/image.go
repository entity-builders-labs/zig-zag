package ai

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	openai "github.com/sashabaranov/go-openai"
)

// ImageClient is the narrow slice of *openai.Client ImageGenerator needs —
// defined here, the consumer, so tests can mock it instead of hitting the
// real OpenAI API.
type ImageClient interface {
	CreateImage(ctx context.Context, request openai.ImageRequest) (openai.ImageResponse, error)
}

// ImageGenerator ports ImageGenerationService
// (be/src/shared/ai/image-generation.service.ts): DALL-E 3 first, falling
// back to DALL-E 2 on a model-not-found or 400 error, disabled entirely
// when AI is off or no API key is configured.
type ImageGenerator struct {
	client  ImageClient
	enabled bool
}

// NewImageGenerator builds a generator. client is nil-able: a nil client
// (no OpenAI API key configured) makes GenerateImage a no-op, same as
// ImageGenerationService's constructor leaving `this.openai` unset.
func NewImageGenerator(client ImageClient, enableAI bool) *ImageGenerator {
	return &ImageGenerator{client: client, enabled: enableAI}
}

// GenerateImage returns a generated image URL, or "" if generation was
// skipped or failed — mirroring the original's "never block tour creation
// on a failed cover image" behavior: failures are logged, not returned as
// errors. bypass defaults to true upstream in Nest (callers must opt in),
// so callers here should do the same rather than assuming false.
func (g *ImageGenerator) GenerateImage(ctx context.Context, prompt string, size string, bypass bool) string {
	if bypass || !g.enabled || g.client == nil {
		return ""
	}

	url, err := g.createImage(ctx, prompt, openai.CreateImageModelDallE3, "1024x1024", openai.CreateImageQualityStandard)
	if err == nil {
		return url
	}
	slog.Warn("dall-e-3 image generation failed", "error", err)

	if !isModelUnavailable(err) {
		return ""
	}

	url, err = g.createImage(ctx, prompt, openai.CreateImageModelDallE2, size, "")
	if err != nil {
		slog.Warn("dall-e-2 fallback image generation failed", "error", err)
		return ""
	}
	return url
}

func (g *ImageGenerator) createImage(ctx context.Context, prompt, model, size, quality string) (string, error) {
	resp, err := g.client.CreateImage(ctx, openai.ImageRequest{
		Model:          model,
		Prompt:         prompt,
		N:              1,
		Size:           size,
		Quality:        quality,
		ResponseFormat: openai.CreateImageResponseFormatURL,
	})
	if err != nil {
		return "", err
	}
	if len(resp.Data) == 0 || resp.Data[0].URL == "" {
		return "", fmt.Errorf("no image URL returned")
	}
	return resp.Data[0].URL, nil
}

// isModelUnavailable mirrors the Nest fallback condition:
// error.code === 'model_not_found' || error.status === 400.
func isModelUnavailable(err error) bool {
	var apiErr *openai.APIError
	if errors.As(err, &apiErr) {
		if code, ok := apiErr.Code.(string); ok && code == "model_not_found" {
			return true
		}
		if apiErr.HTTPStatusCode == 400 {
			return true
		}
	}
	return false
}
