package ai_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/ai/mocks"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

func strPtr(s string) *string { return &s }

func TestVectorStore_FindSimilarActivities(t *testing.T) {
	tests := []struct {
		name       string
		prompt     string
		k          int
		setupMocks func(embedder *mocks.Embedder, db *mocks.VectorQuerier)
		want       []ai.SimilarActivityResult
		wantErr    string
	}{
		{
			name:   "embeds the prompt and formats rows into results",
			prompt: "walking tours in Bariloche",
			k:      5,
			setupMocks: func(embedder *mocks.Embedder, db *mocks.VectorQuerier) {
				embedder.EXPECT().
					EmbedQuery(mock.Anything, "walking tours in Bariloche").
					Return([]float64{0.1, 0.2, 0.3}, nil)

				db.EXPECT().
					FindSimilarActivitiesFull(mock.Anything, mock.MatchedBy(func(p sqlcgen.FindSimilarActivitiesFullParams) bool {
						return p.Limit == 5 && p.Embedding != nil
					})).
					Return([]sqlcgen.FindSimilarActivitiesFullRow{
						{
							ID:          "a1",
							Name:        "Cerro Catedral hike",
							Description: strPtr("A scenic hike"),
							Type:        strPtr("hiking"),
							Metadata:    []byte(`{"tags":["scenic"]}`),
							Distance:    0.12,
						},
					}, nil)
			},
			want: []ai.SimilarActivityResult{
				{
					PageContent: `Name: Cerro Catedral hike. Description: A scenic hike. Metadata: {"tags":["scenic"]}`,
					Metadata: map[string]any{
						"activityId":   "a1",
						"activityName": "Cerro Catedral hike",
						"activityType": "hiking",
						"distance":     0.12,
						"tags":         []any{"scenic"},
					},
				},
			},
		},
		{
			name:   "embedder failure short-circuits before querying the DB",
			prompt: "anything",
			k:      5,
			setupMocks: func(embedder *mocks.Embedder, db *mocks.VectorQuerier) {
				embedder.EXPECT().
					EmbedQuery(mock.Anything, "anything").
					Return(nil, errors.New("ollama: connection refused"))
			},
			wantErr: "embed query",
		},
		{
			name:   "db failure propagates",
			prompt: "anything",
			k:      5,
			setupMocks: func(embedder *mocks.Embedder, db *mocks.VectorQuerier) {
				embedder.EXPECT().
					EmbedQuery(mock.Anything, "anything").
					Return([]float64{0.1}, nil)
				db.EXPECT().
					FindSimilarActivitiesFull(mock.Anything, mock.Anything).
					Return(nil, errors.New("pgx: connection refused"))
			},
			wantErr: "find similar activities",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			embedder := mocks.NewEmbedder(t)
			db := mocks.NewVectorQuerier(t)
			tt.setupMocks(embedder, db)

			store := ai.NewVectorStore(db, embedder)
			got, err := store.FindSimilarActivities(context.Background(), tt.prompt, tt.k)

			if tt.wantErr != "" {
				require.ErrorContains(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestVectorStore_AddActivityToVectorStore(t *testing.T) {
	embedder := mocks.NewEmbedder(t)
	db := mocks.NewVectorQuerier(t)

	embedder.EXPECT().
		EmbedQuery(mock.Anything, mock.MatchedBy(func(text string) bool {
			return len(text) > 0
		})).
		Return([]float64{0.5, -0.5}, nil)

	db.EXPECT().
		UpdateActivityEmbedding(mock.Anything, mock.MatchedBy(func(p sqlcgen.UpdateActivityEmbeddingParams) bool {
			return p.ID == "a1" && p.Embedding != nil && p.Embedding.Slice()[0] == float32(0.5)
		})).
		Return(nil)

	store := ai.NewVectorStore(db, embedder)
	err := store.AddActivityToVectorStore(context.Background(), "a1", "Cerro Catedral hike", strPtr("desc"), strPtr("hiking"), []byte(`{"tags":["scenic"]}`))
	require.NoError(t, err)
}

func TestVectorStore_ResetVectorStore(t *testing.T) {
	db := mocks.NewVectorQuerier(t)
	db.EXPECT().ResetVectorStore(mock.Anything).Return(nil)

	store := ai.NewVectorStore(db, mocks.NewEmbedder(t))
	require.NoError(t, store.ResetVectorStore(context.Background()))
}

func TestVectorStore_RebuildVectorStore(t *testing.T) {
	embedder := mocks.NewEmbedder(t)
	db := mocks.NewVectorQuerier(t)

	db.EXPECT().ListActivitiesWithMetadata(mock.Anything).Return([]sqlcgen.ListActivitiesWithMetadataRow{
		{ID: "a1", Name: "Ok Activity", Metadata: []byte(`{}`)},
		{ID: "a2", Name: "Broken Activity", Metadata: []byte(`{}`)},
	}, nil)

	embedder.EXPECT().EmbedQuery(mock.Anything, mock.Anything).Return([]float64{0.1}, nil).Once()
	embedder.EXPECT().EmbedQuery(mock.Anything, mock.Anything).Return(nil, errors.New("timeout")).Once()

	db.EXPECT().UpdateActivityEmbedding(mock.Anything, mock.MatchedBy(func(p sqlcgen.UpdateActivityEmbeddingParams) bool {
		return p.ID == "a1"
	})).Return(nil)

	store := ai.NewVectorStore(db, embedder)
	succeeded, total, err := store.RebuildVectorStore(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, succeeded, "one activity's embed call failed and should be skipped, not abort the run")
	require.Equal(t, 2, total)
}
