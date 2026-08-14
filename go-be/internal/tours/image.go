package tours

import (
	"context"
	"fmt"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
)

// GenerateTourCoverImage ports TourImageService.generateTourCoverImage.
func (s *GenerationService) GenerateTourCoverImage(ctx context.Context, tourID string) (string, error) {
	tour, err := s.tours.FindOne(ctx, tourID, nil)
	if err != nil {
		return "", err
	}

	highlights := activityHighlights(tour.Activities)
	description := tour.Name
	if tour.Description != nil && *tour.Description != "" {
		description = *tour.Description
	}

	prompt := fmt.Sprintf(
		"A breathtaking, high-quality travel cover image for a tour named %q.\nDescription: %s.\nKey highlights: %s.\nStyle: Professional travel photography, vibrant, inviting, wide angle, cinematic lighting.\nNo text, no watermarks, no collages, no labels.",
		tour.Name, description, highlights,
	)

	imageURL := s.image.GenerateImage(ctx, prompt, "1024x1024", true)
	if imageURL == "" {
		return "", nil
	}

	if err := s.db.UpdateTourCoverImage(ctx, sqlcgen.UpdateTourCoverImageParams{ID: tourID, CoverImage: &imageURL}); err != nil {
		return "", fmt.Errorf("save cover image: %w", err)
	}
	return imageURL, nil
}

func activityHighlights(activities []domain.TourActivity) string {
	highlights := "scenic locations"
	var names []string
	for i, a := range activities {
		if i >= 3 {
			break
		}
		if a.ActivityName != nil {
			names = append(names, *a.ActivityName)
		}
	}
	if len(names) > 0 {
		highlights = joinComma(names)
	}
	return highlights
}

func joinComma(items []string) string {
	out := items[0]
	for _, s := range items[1:] {
		out += ", " + s
	}
	return out
}
