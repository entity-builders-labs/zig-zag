package activities_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/activities"
	"github.com/juanobrach/zig-zag/go-be/internal/activities/mocks"
	"github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

func strP(s string) *string     { return &s }
func floatP(f float64) *float64 { return &f }

func ts() pgtype.Timestamp { return pgtype.Timestamp{Valid: true} }

func TestService_FindAll(t *testing.T) {
	// Buenos Aires area, radius covers "near" but excludes "far".
	near := sqlcgen.Activity{
		ID: "near", Name: "Near Activity", Latitude: floatP(-34.5748341), Longitude: floatP(-58.4084219),
		Rating: floatP(4.8), RatingCount: int32P(500), KnownActivityTypeName: strP("cultural"),
		CreatedAt: ts(), UpdatedAt: ts(),
	}
	far := sqlcgen.Activity{
		ID: "far", Name: "Far Activity", Latitude: floatP(10), Longitude: floatP(10),
		Rating: floatP(5.0), RatingCount: int32P(1000), KnownActivityTypeName: strP("cultural"),
		CreatedAt: ts(), UpdatedAt: ts(),
	}
	lowRated := sqlcgen.Activity{
		ID: "low-rated", Name: "Mediocre Activity", Latitude: floatP(-34.575), Longitude: floatP(-58.409),
		Rating: floatP(2.0), RatingCount: int32P(5), KnownActivityTypeName: strP("food"),
		CreatedAt: ts(), UpdatedAt: ts(),
	}

	t.Run("filters out-of-radius rows and sorts by weighted score", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().FindActivitiesInBoundingBox(mock.Anything, mock.Anything).
			Return([]sqlcgen.Activity{near, far, lowRated}, nil)

		svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
		results, err := svc.FindAll(context.Background(), "-34.5748341", "-58.4084219", 50000, 100, nil)
		require.NoError(t, err)

		ids := make([]string, len(results))
		for i, r := range results {
			ids[i] = r.ID
		}
		// "far" is outside the 50km radius entirely; "near" has a much
		// higher rating count so its Bayesian-weighted score beats "low-rated".
		require.Equal(t, []string{"near", "low-rated"}, ids)
	})

	t.Run("types filter is case-insensitive and applied before scoring", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().FindActivitiesInBoundingBox(mock.Anything, mock.Anything).
			Return([]sqlcgen.Activity{near, lowRated}, nil)

		svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
		results, err := svc.FindAll(context.Background(), "-34.5748341", "-58.4084219", 50000, 100, []string{"FOOD"})
		require.NoError(t, err)
		require.Len(t, results, 1)
		require.Equal(t, "low-rated", results[0].ID)
	})

	t.Run("invalid coordinates are rejected before hitting the DB", func(t *testing.T) {
		svc := activities.NewService(mocks.NewQuerier(t), nil, mocks.NewVectorFinder(t))
		_, err := svc.FindAll(context.Background(), "not-a-number", "-58", 1000, 10, nil)
		require.ErrorIs(t, err, activities.ErrInvalidCoordinates)
	})

	t.Run("comma decimal separator is normalized, matching the Nest coordinate parsing", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().FindActivitiesInBoundingBox(mock.Anything, mock.Anything).Return(nil, nil)

		svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
		_, err := svc.FindAll(context.Background(), "-34,5748341", "-58,4084219", 1000, 10, nil)
		require.NoError(t, err)
	})
}

func int32P(i int32) *int32 { return &i }

func TestService_FindOne(t *testing.T) {
	t.Run("not found maps to the sentinel error", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().GetActivity(mock.Anything, "missing").Return(sqlcgen.Activity{}, pgx.ErrNoRows)

		svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
		_, err := svc.FindOne(context.Background(), "missing")
		require.ErrorIs(t, err, activities.ErrActivityNotFound)
	})

	t.Run("found returns the mapped domain activity", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().GetActivity(mock.Anything, "a1").Return(sqlcgen.Activity{ID: "a1", Name: "Museo", CreatedAt: ts(), UpdatedAt: ts()}, nil)

		svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
		got, err := svc.FindOne(context.Background(), "a1")
		require.NoError(t, err)
		require.Equal(t, "Museo", got.Name)
	})
}

func TestService_Update_OnlyAppliesProvidedFields(t *testing.T) {
	db := mocks.NewQuerier(t)
	existing := sqlcgen.Activity{
		ID: "a1", Name: "Old Name", Description: strP("old desc"), Type: strP("museum"),
		CreatedAt: ts(), UpdatedAt: ts(),
	}
	db.EXPECT().GetActivity(mock.Anything, "a1").Return(existing, nil)
	db.EXPECT().UpdateActivity(mock.Anything, mock.MatchedBy(func(p sqlcgen.UpdateActivityParams) bool {
		// Name is the only field in the update input — Description/Type
		// must survive unchanged from the existing row, not get zeroed out.
		return p.Name == "New Name" &&
			p.Description != nil && *p.Description == "old desc" &&
			p.Type != nil && *p.Type == "museum"
	})).Return(sqlcgen.Activity{ID: "a1", Name: "New Name", Description: strP("old desc"), Type: strP("museum"), CreatedAt: ts(), UpdatedAt: ts()}, nil)

	svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
	got, err := svc.Update(context.Background(), "a1", activities.ActivityInput{Name: strP("New Name")})
	require.NoError(t, err)
	require.Equal(t, "New Name", got.Name)
}

func TestService_Remove(t *testing.T) {
	t.Run("not found short-circuits before any delete call", func(t *testing.T) {
		db := mocks.NewQuerier(t) // no DeleteActivity expectation registered
		db.EXPECT().GetActivity(mock.Anything, "missing").Return(sqlcgen.Activity{}, pgx.ErrNoRows)

		svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
		_, err := svc.Remove(context.Background(), "missing")
		require.ErrorIs(t, err, activities.ErrActivityNotFound)
	})

	t.Run("existing activity gets deleted", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().GetActivity(mock.Anything, "a1").Return(sqlcgen.Activity{ID: "a1", Name: "x", CreatedAt: ts(), UpdatedAt: ts()}, nil)
		db.EXPECT().DeleteActivity(mock.Anything, "a1").Return(sqlcgen.Activity{ID: "a1", Name: "x", CreatedAt: ts(), UpdatedAt: ts()}, nil)

		svc := activities.NewService(db, nil, mocks.NewVectorFinder(t))
		got, err := svc.Remove(context.Background(), "a1")
		require.NoError(t, err)
		require.Equal(t, "a1", got.ID)
	})
}

func TestService_FindSimilar(t *testing.T) {
	db := mocks.NewQuerier(t)
	vectors := mocks.NewVectorFinder(t)

	db.EXPECT().GetActivity(mock.Anything, "a1").Return(sqlcgen.Activity{ID: "a1", Name: "Museo", CreatedAt: ts(), UpdatedAt: ts()}, nil)
	vectors.EXPECT().FindSimilarActivities(mock.Anything, mock.Anything, 3).Return([]ai.SimilarActivityResult{
		{Metadata: map[string]any{"activityId": "a1"}}, // self — must be excluded
		{Metadata: map[string]any{"activityId": "a2"}},
		{Metadata: map[string]any{"activityId": "a3"}},
	}, nil)
	db.EXPECT().GetActivitiesByIDs(mock.Anything, []string{"a2", "a3"}).Return([]sqlcgen.Activity{
		{ID: "a3", Name: "Third", CreatedAt: ts(), UpdatedAt: ts()},
		{ID: "a2", Name: "Second", CreatedAt: ts(), UpdatedAt: ts()},
	}, nil)

	svc := activities.NewService(db, nil, vectors)
	got, err := svc.FindSimilar(context.Background(), "a1", 2)
	require.NoError(t, err)
	require.Len(t, got, 2)
	// Must come back in similarity order (a2 before a3), not DB return order.
	require.Equal(t, []string{"a2", "a3"}, []string{got[0].ID, got[1].ID})
}

func TestService_Create_DedupsBySourceAndExternalID(t *testing.T) {
	db := mocks.NewQuerier(t)
	sourceID, externalID := "src-1", "ext-1"
	db.EXPECT().GetActivityBySourceExternalID(mock.Anything, sqlcgen.GetActivityBySourceExternalIDParams{
		SourceId: &sourceID, ExternalId: &externalID,
	}).Return(sqlcgen.Activity{ID: "existing", Name: "Already Exists", CreatedAt: ts(), UpdatedAt: ts()}, nil)

	svc := activities.NewService(db, nil, mocks.NewVectorFinder(t)) // no CreateActivity expectation — must not be called
	got, err := svc.Create(context.Background(), activities.ActivityInput{
		Name: strP("Duplicate Attempt"), SourceID: &sourceID, ExternalID: &externalID,
	})
	require.NoError(t, err)
	require.Equal(t, "existing", got.ID)
}
