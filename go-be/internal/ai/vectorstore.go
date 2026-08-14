package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pgvector/pgvector-go"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// activityMetadata mirrors the ActivityMetadata interface in
// be/src/shared/ai/services/vector-store.service.ts — only the fields
// buildRichActivityText actually reads.
type activityMetadata struct {
	TimeOfDayPreference []string `json:"timeOfDayPreference"`
	PhysicalIntensity   *int     `json:"physicalIntensity"`
	EnhancedDescription string   `json:"enhancedDescription"`
	TargetAudience      string   `json:"targetAudience"`
	BestTimeToVisit     string   `json:"bestTimeToVisit"`
	Tags                []string `json:"tags"`
}

// SimilarActivityResult mirrors SimilarActivityResult from the same file.
type SimilarActivityResult struct {
	PageContent string
	Metadata    map[string]any
}

// VectorQuerier is the narrow slice of sqlcgen.Queries VectorStore actually
// calls — defined here, the consumer, rather than depending on the full
// *sqlcgen.Queries type, so unit tests can mock just this. VectorStore is
// intentionally persistence-adjacent (it IS the vector storage component,
// same as VectorStoreService talks to Prisma directly on the Nest side),
// so depending on generated query-layer types here is a deliberate
// exception to routing everything through internal/domain.
type VectorQuerier interface {
	UpdateActivityEmbedding(ctx context.Context, arg sqlcgen.UpdateActivityEmbeddingParams) error
	ResetVectorStore(ctx context.Context) error
	CountEmbeddedActivities(ctx context.Context) (int64, error)
	FindSimilarActivitiesFull(ctx context.Context, arg sqlcgen.FindSimilarActivitiesFullParams) ([]sqlcgen.FindSimilarActivitiesFullRow, error)
	ListActivitiesWithMetadata(ctx context.Context) ([]sqlcgen.ListActivitiesWithMetadataRow, error)
}

// VectorStore ports VectorStoreService: builds embeddable text from an
// activity's fields, stores/queries embeddings via pgvector, and formats
// similarity results the same shape the tour-generation prompt builder expects.
type VectorStore struct {
	db       VectorQuerier
	embedder Embedder
}

func NewVectorStore(db VectorQuerier, embedder Embedder) *VectorStore {
	return &VectorStore{db: db, embedder: embedder}
}

// buildActivityPageContent mirrors buildActivityPageContent: a short,
// consistent summary used both when storing an embedding's source text and
// when formatting a similarity search result's pageContent.
func buildActivityPageContent(name string, description *string, metadata []byte) string {
	desc := "null"
	if description != nil {
		desc = *description
	}
	meta := "null"
	if len(metadata) > 0 {
		meta = string(metadata)
	}
	return fmt.Sprintf("Name: %s. Description: %s. Metadata: %s", name, desc, meta)
}

// buildRichActivityText mirrors buildRichActivityText: a fuller natural
// -language description used as the embedding source for
// AddActivityToVectorStore, richer than the page-content summary above.
func buildRichActivityText(name string, description, activityType *string, metadataJSON []byte) string {
	var meta activityMetadata
	if len(metadataJSON) > 0 {
		_ = json.Unmarshal(metadataJSON, &meta) // best-effort, same as the TS try/catch defaulting to {}
	}

	intensity := 3
	if meta.PhysicalIntensity != nil {
		intensity = *meta.PhysicalIntensity
	}
	desc := "No description available"
	if description != nil && *description != "" {
		desc = *description
	}
	timeOfDay := "any time of day"
	if len(meta.TimeOfDayPreference) > 0 {
		timeOfDay = strings.Join(meta.TimeOfDayPreference, ", ")
	}
	targetAudience := meta.TargetAudience
	if targetAudience == "" {
		targetAudience = "all audiences"
	}
	bestTime := meta.BestTimeToVisit
	if bestTime == "" {
		bestTime = "any time"
	}
	typ := ""
	if activityType != nil {
		typ = *activityType
	}

	return fmt.Sprintf(
		"Activity Details:\n%s is a %d intensity activity.\nAbout this activity: %s\n%s\nThis activity is ideal for %s and is best experienced %s.\nIt can be done during %s.\nActivity type: %s.\nKeywords: %s.\n",
		name, intensity, desc, meta.EnhancedDescription, targetAudience, bestTime, timeOfDay, typ, strings.Join(meta.Tags, ", "),
	)
}

// AddActivityToVectorStore embeds one activity's rich text and stores it.
func (v *VectorStore) AddActivityToVectorStore(ctx context.Context, id, name string, description, activityType *string, metadataJSON []byte) error {
	text := buildRichActivityText(name, description, activityType, metadataJSON)
	vec, err := v.embedder.EmbedQuery(ctx, text)
	if err != nil {
		return fmt.Errorf("embed activity %s: %w", id, err)
	}

	pgvec := pgvector.NewVector(ToFloat32(vec))
	if err := v.db.UpdateActivityEmbedding(ctx, sqlcgen.UpdateActivityEmbeddingParams{ID: id, Embedding: &pgvec}); err != nil {
		return fmt.Errorf("save embedding for activity %s: %w", id, err)
	}
	return nil
}

// FindSimilarActivities embeds prompt and returns the k nearest activities
// by cosine distance, formatted the same way LangChain-style consumers
// (the tour-generation prompt builder) expect.
func (v *VectorStore) FindSimilarActivities(ctx context.Context, prompt string, k int) ([]SimilarActivityResult, error) {
	queryVec, err := v.embedder.EmbedQuery(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}
	pgvec := pgvector.NewVector(ToFloat32(queryVec))

	rows, err := v.db.FindSimilarActivitiesFull(ctx, sqlcgen.FindSimilarActivitiesFullParams{
		Embedding: &pgvec,
		Limit:     int32(k),
	})
	if err != nil {
		return nil, fmt.Errorf("find similar activities: %w", err)
	}

	results := make([]SimilarActivityResult, 0, len(rows))
	for _, row := range rows {
		metadata := map[string]any{
			"activityId":   row.ID,
			"activityName": row.Name,
			"distance":     row.Distance,
		}
		if row.Type != nil {
			metadata["activityType"] = *row.Type
		}
		if len(row.Metadata) > 0 {
			var extra map[string]any
			if err := json.Unmarshal(row.Metadata, &extra); err == nil {
				for k, v := range extra {
					metadata[k] = v
				}
			}
		}

		results = append(results, SimilarActivityResult{
			PageContent: buildActivityPageContent(row.Name, row.Description, row.Metadata),
			Metadata:    metadata,
		})
	}
	return results, nil
}

// ResetVectorStore clears every stored embedding without touching Activity
// rows themselves.
func (v *VectorStore) ResetVectorStore(ctx context.Context) error {
	return v.db.ResetVectorStore(ctx)
}

// RebuildVectorStore re-embeds every activity that has enrichment metadata,
// mirroring rebuildVectorStore's best-effort per-activity behavior (one
// failure doesn't abort the whole run).
func (v *VectorStore) RebuildVectorStore(ctx context.Context) (succeeded, total int, err error) {
	activities, err := v.db.ListActivitiesWithMetadata(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("list activities: %w", err)
	}

	for _, a := range activities {
		if err := v.AddActivityToVectorStore(ctx, a.ID, a.Name, a.Description, a.Type, a.Metadata); err != nil {
			continue
		}
		succeeded++
	}
	return succeeded, len(activities), nil
}
