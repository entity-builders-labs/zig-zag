package places_test

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/places"
	"github.com/juanobrach/zig-zag/go-be/internal/places/mocks"
)

func strP(s string) *string { return &s }

func TestService_EnsureKnownActivityTypes(t *testing.T) {
	t.Run("creates every type when none exist yet", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().GetKnownActivityTypeByName(mock.Anything, mock.Anything).
			Return(sqlcgen.KnownActivityType{}, pgx.ErrNoRows).Times(5) // 5 canonical categories
		db.EXPECT().CreateKnownActivityType(mock.Anything, mock.Anything).
			Return(sqlcgen.KnownActivityType{}, nil).Times(5)

		svc := places.NewService(db, mocks.NewProvider(t), nil, mocks.NewActivityCreator(t), mocks.NewEmbeddingSaver(t), "geoapify")
		require.NoError(t, svc.EnsureKnownActivityTypes(context.Background()))
	})

	t.Run("leaves a type alone when it already matches", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().GetKnownActivityTypeByName(mock.Anything, "cultural").Return(sqlcgen.KnownActivityType{
			ID: "kt-1", Icon: strP("\U0001F3DB"), Description: strP("Cultural and historical activities"), Category: strP("cultural"),
		}, nil)
		// The other 4 categories: not this test's concern — stub something
		// generic and allow (but don't require) an update for them, so the
		// assertion stays focused on "cultural" specifically not being touched.
		db.EXPECT().GetKnownActivityTypeByName(mock.Anything, mock.Anything).Return(sqlcgen.KnownActivityType{
			ID: "kt-x", Icon: strP("x"), Description: strP("x"), Category: strP("x"),
		}, nil).Maybe()
		// Allowed for any OTHER category's id — deliberately excludes "kt-1"
		// (cultural's id) so a spurious update for it fails the test with an
		// "unexpected call" instead of silently matching mock.Anything.
		db.EXPECT().UpdateKnownActivityType(mock.Anything, mock.MatchedBy(func(p sqlcgen.UpdateKnownActivityTypeParams) bool {
			return p.ID != "kt-1"
		})).Return(nil).Maybe()

		svc := places.NewService(db, mocks.NewProvider(t), nil, mocks.NewActivityCreator(t), mocks.NewEmbeddingSaver(t), "geoapify")
		require.NoError(t, svc.EnsureKnownActivityTypes(context.Background()))
	})

	t.Run("updates a type whose stored fields have drifted", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().GetKnownActivityTypeByName(mock.Anything, "cultural").Return(sqlcgen.KnownActivityType{
			ID: "kt-1", Icon: strP("stale-icon"), Description: strP("stale desc"), Category: strP("cultural"),
		}, nil)
		db.EXPECT().UpdateKnownActivityType(mock.Anything, mock.MatchedBy(func(p sqlcgen.UpdateKnownActivityTypeParams) bool {
			return p.ID == "kt-1"
		})).Return(nil)
		db.EXPECT().GetKnownActivityTypeByName(mock.Anything, mock.Anything).Return(sqlcgen.KnownActivityType{
			ID: "kt-x", Icon: strP("x"), Description: strP("x"), Category: strP("x"),
		}, nil).Maybe()
		db.EXPECT().UpdateKnownActivityType(mock.Anything, mock.MatchedBy(func(p sqlcgen.UpdateKnownActivityTypeParams) bool {
			return p.ID == "kt-x"
		})).Return(nil).Maybe()

		svc := places.NewService(db, mocks.NewProvider(t), nil, mocks.NewActivityCreator(t), mocks.NewEmbeddingSaver(t), "geoapify")
		require.NoError(t, svc.EnsureKnownActivityTypes(context.Background()))
	})
}

func TestService_SearchNearbyPlaces(t *testing.T) {
	tests := []struct {
		name       string
		search     string // just the type, rest of searchDef is fixed below via helper
		setupMocks func(p *mocks.Provider)
	}{
		{
			name:   "supported type routes through SearchNearby",
			search: "museum",
			setupMocks: func(p *mocks.Provider) {
				p.EXPECT().SearchNearby(mock.Anything, mock.MatchedBy(func(params places.SearchNearbyParams) bool {
					return len(params.IncludedTypes) == 1 && params.IncludedTypes[0] == "museum"
				})).Return([]places.PlaceData{{ID: "p1"}}, nil)
			},
		},
		{
			name:   "unsupported type (point_of_interest) routes through SearchText",
			search: "point_of_interest",
			setupMocks: func(p *mocks.Provider) {
				p.EXPECT().SearchText(mock.Anything, mock.MatchedBy(func(params places.SearchTextParams) bool {
					return params.TextQuery != ""
				})).Return([]places.PlaceData{{ID: "p2"}}, nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := mocks.NewProvider(t)
			tt.setupMocks(provider)

			svc := places.NewService(mocks.NewQuerier(t), provider, nil, mocks.NewActivityCreator(t), mocks.NewEmbeddingSaver(t), "geoapify")
			results, err := svc.SearchNearbyPlaces(context.Background(), 1, 2, 0, testSearchDef(tt.search))
			require.NoError(t, err)
			require.Len(t, results, 1)
		})
	}
}

func TestService_SearchNearbyPlaces_FiltersByMinRating(t *testing.T) {
	rated := 3.0
	provider := mocks.NewProvider(t)
	provider.EXPECT().SearchNearby(mock.Anything, mock.Anything).Return([]places.PlaceData{
		{ID: "below-threshold", Rating: &rated},
		{ID: "no-rating-reported"}, // Rating nil: Geoapify never returns it — must NOT be filtered out
	}, nil)

	svc := places.NewService(mocks.NewQuerier(t), provider, nil, mocks.NewActivityCreator(t), mocks.NewEmbeddingSaver(t), "geoapify")
	results, err := svc.SearchNearbyPlaces(context.Background(), 1, 2, 0, testSearchDef("museum"))
	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Equal(t, "no-rating-reported", results[0].ID)
}

func testSearchDef(searchType string) places.SearchDef {
	return places.SearchDef{Type: searchType, Keyword: "keyword", MinRating: 4.0, PreferredTime: "day"}
}

func TestService_CrawlAndSaveActivities(t *testing.T) {
	t.Run("creates newly-seen places and skips ones already crawled", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		provider := mocks.NewProvider(t)
		creator := mocks.NewActivityCreator(t)
		embeddings := mocks.NewEmbeddingSaver(t)

		db.EXPECT().GetKnownActivityTypeByName(mock.Anything, mock.Anything).
			Return(sqlcgen.KnownActivityType{}, pgx.ErrNoRows).Maybe()
		db.EXPECT().CreateKnownActivityType(mock.Anything, mock.Anything).
			Return(sqlcgen.KnownActivityType{}, nil).Maybe()
		db.EXPECT().GetSourceByName(mock.Anything, "geoapify").Return(sqlcgen.Source{}, pgx.ErrNoRows)
		db.EXPECT().CreateSource(mock.Anything, mock.Anything).Return(sqlcgen.Source{ID: "src-1"}, nil)

		// Only the very first provider call across the whole crawl returns a
		// place; every other search comes back empty — keeps this test to
		// exactly one real place flowing through the loop regardless of how
		// many searches placesToSearch's config actually has.
		var served atomic.Bool
		onePlace := func(ctx context.Context, params places.SearchNearbyParams) ([]places.PlaceData, error) {
			if served.CompareAndSwap(false, true) {
				return []places.PlaceData{{ID: "ext-1", Name: "Museo Nacional", Types: []string{"museum"}, Latitude: 1, Longitude: 2}}, nil
			}
			return nil, nil
		}
		provider.EXPECT().SearchNearby(mock.Anything, mock.Anything).RunAndReturn(onePlace)
		provider.EXPECT().SearchText(mock.Anything, mock.Anything).Return(nil, nil)

		db.EXPECT().GetActivityBySourceAndExternalID(mock.Anything, sqlcgen.GetActivityBySourceAndExternalIDParams{
			SourceId: strP("src-1"), ExternalId: strP("ext-1"),
		}).Return("", pgx.ErrNoRows)

		creator.EXPECT().CreateFromDraft(mock.Anything, mock.MatchedBy(func(d places.ActivityDraft) bool {
			return d.Name == "Museo Nacional" && d.Type == "cultural" && d.SourceID == "src-1" && d.ExternalID == "ext-1"
		})).Return("activity-1", nil)

		embeddings.EXPECT().AddActivityToVectorStore(mock.Anything, "activity-1", "Museo Nacional", mock.Anything, mock.Anything, mock.Anything).Return(nil)

		svc := places.NewService(db, provider, nil, creator, embeddings, "geoapify")
		ids, err := svc.CrawlAndSaveActivities(context.Background(), 1, 2, 0)
		require.NoError(t, err)
		require.Equal(t, []string{"activity-1"}, ids)
	})

	t.Run("a place already crawled (found by source+externalId) is skipped, not recreated", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		provider := mocks.NewProvider(t)
		creator := mocks.NewActivityCreator(t) // zero CreateFromDraft calls expected

		db.EXPECT().GetKnownActivityTypeByName(mock.Anything, mock.Anything).
			Return(sqlcgen.KnownActivityType{}, pgx.ErrNoRows).Maybe()
		db.EXPECT().CreateKnownActivityType(mock.Anything, mock.Anything).
			Return(sqlcgen.KnownActivityType{}, nil).Maybe()
		db.EXPECT().GetSourceByName(mock.Anything, "geoapify").Return(sqlcgen.Source{ID: "src-1"}, nil)

		var served atomic.Bool
		provider.EXPECT().SearchNearby(mock.Anything, mock.Anything).RunAndReturn(func(ctx context.Context, params places.SearchNearbyParams) ([]places.PlaceData, error) {
			if served.CompareAndSwap(false, true) {
				return []places.PlaceData{{ID: "ext-1", Name: "Already Crawled", Types: []string{"museum"}}}, nil
			}
			return nil, nil
		})
		provider.EXPECT().SearchText(mock.Anything, mock.Anything).Return(nil, nil)

		db.EXPECT().GetActivityBySourceAndExternalID(mock.Anything, mock.Anything).Return("existing-activity-id", nil)

		svc := places.NewService(db, provider, nil, creator, mocks.NewEmbeddingSaver(t), "geoapify")
		ids, err := svc.CrawlAndSaveActivities(context.Background(), 1, 2, 0)
		require.NoError(t, err)
		require.Empty(t, ids)
	})
}
