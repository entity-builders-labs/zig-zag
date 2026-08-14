package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// runAuditImages ports ImageAuditCommand (audit-images): reports tours
// without a cover image and activities without photos, optionally
// generating and persisting them with --fix.
func runAuditImages(ctx context.Context, env cliEnv, args []string) error {
	fs := flag.NewFlagSet("audit-images", flag.ExitOnError)
	fix := fs.Bool("fix", false, "attempt to generate missing images")
	if err := fs.Parse(args); err != nil {
		return err
	}

	printf("Starting image audit...")
	printf("Fix mode: %v", *fix)

	tours, err := env.queries.ListToursWithoutCoverImage(ctx)
	if err != nil {
		return err
	}
	printf("Found %d tours without cover image.", len(tours))
	for i, t := range tours {
		if i >= 20 {
			printf("...and %d more tours.", len(tours)-20)
			break
		}
		printf("- Tour [%s]: %s", t.ID, t.Name)
	}

	activities, err := env.queries.ListActivitiesWithoutPhotos(ctx)
	if err != nil {
		return err
	}
	printf("Found %d activities without photos.", len(activities))
	for i, a := range activities {
		if i >= 10 {
			printf("...and %d more.", len(activities)-10)
			break
		}
		printf("- Activity [%s]: %s (showing first 10)", a.ID, a.Name)
	}

	if !*fix {
		if len(tours) > 0 || len(activities) > 0 {
			printf("\nTo fix these issues, run: cli audit-images --fix")
		} else {
			printf("All clean! No missing images found.")
		}
		return nil
	}

	printf("Fix mode enabled - starting image generation...")

	toursFixed, toursFailed := 0, 0
	for _, t := range tours {
		url := env.image.GenerateImage(ctx, fmt.Sprintf("A breathtaking, high-quality travel cover image for a tour named %q.", t.Name), "1024x1024", true)
		if url == "" {
			toursFailed++
			printf("Failed to generate (empty result) for Tour %s", t.ID)
			continue
		}
		if err := env.queries.UpdateTourCoverImage(ctx, sqlcgen.UpdateTourCoverImageParams{ID: t.ID, CoverImage: &url}); err != nil {
			toursFailed++
			printf("Error saving cover image for Tour %s: %v", t.ID, err)
			continue
		}
		toursFixed++
		printf("Generated cover image for Tour %s", t.ID)
	}
	printf("Tour images: %d fixed, %d failed", toursFixed, toursFailed)

	activitiesFixed, activitiesFailed := 0, 0
	for _, a := range activities {
		activityType, description := "", ""
		if a.Type != nil {
			activityType = *a.Type
		}
		if a.Description != nil {
			description = *a.Description
		}

		url := env.metadata.GenerateImage(ctx, a.Name, activityType, description)
		if url == "" {
			activitiesFailed++
			printf("Failed to generate (empty result) for Activity %s (%s)", a.ID, a.Name)
			continue
		}

		photosJSON, _ := json.Marshal([]string{url})
		if err := env.queries.SetActivityPhotos(ctx, sqlcgen.SetActivityPhotosParams{ID: a.ID, Photos: photosJSON}); err != nil {
			activitiesFailed++
			printf("Error saving image for Activity %s: %v", a.ID, err)
			continue
		}
		activitiesFixed++
		printf("Saved image for Activity %s (%s)", a.ID, a.Name)
	}
	printf("Activity images: %d fixed, %d failed", activitiesFixed, activitiesFailed)

	printf("\n=== Summary ===")
	printf("Tours processed: %d", len(tours))
	printf("Activities processed: %d", len(activities))
	return nil
}
