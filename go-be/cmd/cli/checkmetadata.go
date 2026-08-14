package main

import (
	"context"
	"time"

	appactivities "github.com/juanobrach/zig-zag/go-be/internal/activities"
)

// runCheckMetadata ports MetadataCheckerCommand (check-metadata).
//
// Faithful-port note: like the Nest original, this GENERATES metadata via
// the AI but never persists it — ActivitiesService.generateMetadata(id)
// (be/.../activities.service.ts) calls findOne then
// metadataService.generateMetadata(activity) and returns the result
// without ever writing it back to the database, so this command's
// "Updated: N" summary has always been reporting successful *generation*,
// not successful *persistence*. That's an existing gap in the source, not
// something this port silently introduced or should silently fix.
func runCheckMetadata(ctx context.Context, env cliEnv) error {
	rows, err := env.queries.ListActivitiesWithID(ctx)
	if err != nil {
		return err
	}
	printf("Found %d activities to process", len(rows))

	var updated, skipped, failed int
	for _, row := range rows {
		printf("Processing activity %s: %s", row.ID, row.Name)

		metadata, err := env.metadata.GenerateMetadata(ctx, appactivities.ActivityInfo{Name: row.Name})
		if err != nil {
			failed++
			printf("Error processing activity %s: %v", row.ID, err)
			continue
		}
		if len(metadata) > 0 {
			updated++
			printf("Successfully generated metadata for activity %s", row.ID)
		} else {
			skipped++
			printf("No metadata generated for activity %s", row.ID)
		}

		time.Sleep(time.Second)
	}

	printf("Summary:")
	printf("  Total activities: %d", len(rows))
	printf("  Updated: %d", updated)
	printf("  Skipped: %d", skipped)
	printf("  Failed: %d", failed)
	return nil
}
