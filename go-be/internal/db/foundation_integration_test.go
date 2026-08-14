package db_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/db"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// databaseURLForTest returns DATABASE_URL, falling back to the same local
// dev connection string be/'s docker-compose.yml and .env.example use, and
// skips the test outright if nothing is reachable — this validates real
// JSON/array/vector type mapping against Postgres, not a mock, so it needs
// an actual database (e.g. `docker-compose --profile dev up postgres`).
func databaseURLForTest(t *testing.T) string {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@localhost:5432/zigzag"
	}
	return url
}

func TestSqlcTypeMapping(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, databaseURLForTest(t))
	if err != nil {
		t.Skipf("no reachable Postgres for integration test: %v", err)
	}
	defer pool.Close()

	q := sqlcgen.New(pool)
	now := time.Now().UTC()

	t.Run("activity: JSONB metadata and pgvector embedding round-trip", func(t *testing.T) {
		id := uuid.NewString()
		metadata := map[string]any{"tags": []string{"walking", "history"}, "score": 4.5}
		metadataJSON, err := json.Marshal(metadata)
		require.NoError(t, err)

		embedding := make([]float32, 256)
		for i := range embedding {
			embedding[i] = float32(i) / 256
		}
		vec := pgvector.NewVector(embedding)

		_, err = pool.Exec(ctx, `
			INSERT INTO "activity" ("id", "name", "metadata", "embedding", "createdAt", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $5)
		`, id, "Integration Test Activity", metadataJSON, vec, now)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM "activity" WHERE "id" = $1`, id)
		})

		row, err := q.GetActivityByID(ctx, id)
		require.NoError(t, err)
		require.Equal(t, "Integration Test Activity", row.Name)

		var gotMetadata map[string]any
		require.NoError(t, json.Unmarshal(row.Metadata, &gotMetadata))
		require.Equal(t, float64(4.5), gotMetadata["score"])

		require.NotNil(t, row.Embedding)
		require.Len(t, row.Embedding.Slice(), 256)
		require.InDelta(t, embedding[128], row.Embedding.Slice()[128], 1e-6)
	})

	t.Run("activity: cosine distance query orders nearest-first", func(t *testing.T) {
		near := make([]float32, 256)
		far := make([]float32, 256)
		query := make([]float32, 256)
		for i := range query {
			query[i] = 1
			near[i] = 1
			far[i] = -1
		}
		near[0] = 0.9 // slightly off-axis so it's not a literal duplicate of query

		nearID, farID := uuid.NewString(), uuid.NewString()
		insert := func(id, name string, vals []float32) {
			_, err := pool.Exec(ctx, `
				INSERT INTO "activity" ("id", "name", "embedding", "createdAt", "updatedAt")
				VALUES ($1, $2, $3, $4, $4)
			`, id, name, pgvector.NewVector(vals), now)
			require.NoError(t, err)
		}
		insert(nearID, "Near", near)
		insert(farID, "Far", far)
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM "activity" WHERE "id" IN ($1, $2)`, nearID, farID)
		})

		vec := pgvector.NewVector(query)
		rows, err := q.FindSimilarActivities(ctx, sqlcgen.FindSimilarActivitiesParams{
			Embedding: &vec,
			Limit:     10,
		})
		require.NoError(t, err)
		require.NotEmpty(t, rows)

		var sawNearBeforeFar, sawNear, sawFar bool
		for _, r := range rows {
			if r.ID == nearID {
				sawNear = true
			}
			if r.ID == farID {
				if sawNear {
					sawNearBeforeFar = true
				}
				sawFar = true
			}
		}
		require.True(t, sawNear && sawFar, "expected both seeded rows in results")
		require.True(t, sawNearBeforeFar, "expected the cosine-nearest row to sort before the farthest one")
	})

	t.Run("tour: native array columns and JSONB metadata round-trip", func(t *testing.T) {
		id := uuid.NewString()
		metadata := map[string]any{"generationStatus": "completed"}
		metadataJSON, err := json.Marshal(metadata)
		require.NoError(t, err)

		_, err = pool.Exec(ctx, `
			INSERT INTO "tour" ("id", "name", "startDates", "categories", "metadata", "createdAt", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6, $6)
		`, id, "Integration Test Tour",
			[]time.Time{now, now.Add(24 * time.Hour)},
			[]string{"walking", "food"},
			metadataJSON, now)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM "tour" WHERE "id" = $1`, id)
		})

		row, err := q.GetTourByID(ctx, id)
		require.NoError(t, err)
		require.Equal(t, []string{"walking", "food"}, row.Categories)
		require.Len(t, row.StartDates, 2)

		var gotMetadata map[string]any
		require.NoError(t, json.Unmarshal(row.Metadata, &gotMetadata))
		require.Equal(t, "completed", gotMetadata["generationStatus"])
	})
}
