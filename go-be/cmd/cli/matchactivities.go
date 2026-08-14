package main

import (
	"context"
	"flag"
)

// runMatchActivities ports EmbeddingCheckerCommand (match-activities):
// rebuilds pgvector embeddings for every activity, then runs a test
// similarity search to sanity-check the result.
func runMatchActivities(ctx context.Context, env cliEnv, args []string) error {
	fs := flag.NewFlagSet("match-activities", flag.ExitOnError)
	searchPrompt := fs.String("search-prompt", "outdoor activities", "test search prompt to run after rebuilding")
	if err := fs.Parse(args); err != nil {
		return err
	}

	succeeded, total, err := env.vectorStore.RebuildVectorStore(ctx)
	if err != nil {
		return err
	}
	printf("Rebuilt embeddings for %d/%d activities", succeeded, total)

	printf(`Performing test search: "%s"...`, *searchPrompt)
	results, err := env.vectorStore.FindSimilarActivities(ctx, *searchPrompt, 5)
	if err != nil {
		return err
	}
	printf("Test search found %d results", len(results))
	for i, r := range results {
		printf("  %d. %v (distance: %v)", i+1, r.Metadata["activityName"], r.Metadata["distance"])
	}

	printf("")
	printf("Usage:")
	printf("  cli match-activities                          # rebuild all embeddings")
	printf(`  cli match-activities --search-prompt "museums" # rebuild, then test-search with a custom prompt`)
	return nil
}
