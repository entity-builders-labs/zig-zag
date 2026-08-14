package activities_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/activities"
	"github.com/juanobrach/zig-zag/go-be/internal/activities/mocks"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

func TestHybridSearchService_SearchActivitiesWithCrawling(t *testing.T) {
	t.Run("forceRefresh always triggers a crawl, skipping the CrawlerSearch lookup entirely", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().FindActivitiesInBoundingBox(mock.Anything, mock.Anything).Return(nil, nil)
		crawlDB := mocks.NewCrawlQuerier(t) // zero calls expected — forceRefresh short-circuits before the lookup
		crawler := mocks.NewCrawler(t)
		crawler.EXPECT().CrawlAndSaveActivities(mock.Anything, 1.0, 2.0, 3000.0).Return(nil, nil).Maybe()

		svc := activities.NewHybridSearchService(activities.NewService(db, nil, mocks.NewVectorFinder(t)), crawler, crawlDB)
		result, err := svc.SearchActivitiesWithCrawling(context.Background(), activities.HybridSearchParams{
			Latitude: 1, Longitude: 2, Radius: 3000, ForceRefresh: true,
		})
		require.NoError(t, err)
		require.True(t, result.CrawlingTriggered)
		require.False(t, result.FromCache)

		// The crawl runs in a goroutine (fire-and-forget) — give it a moment
		// so the .Maybe() expectation above actually gets exercised/asserted
		// rather than racing the test's own cleanup.
		time.Sleep(20 * time.Millisecond)
	})

	t.Run("a recent CrawlerSearch row within the cache window skips crawling", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().FindActivitiesInBoundingBox(mock.Anything, mock.Anything).Return(nil, nil)
		crawlDB := mocks.NewCrawlQuerier(t)
		crawlDB.EXPECT().GetRecentCrawlerSearchNear(mock.Anything, mock.Anything).Return(sqlcgen.CrawlerSearch{ID: "cs-1"}, nil)

		svc := activities.NewHybridSearchService(activities.NewService(db, nil, mocks.NewVectorFinder(t)), mocks.NewCrawler(t), crawlDB)
		result, err := svc.SearchActivitiesWithCrawling(context.Background(), activities.HybridSearchParams{
			Latitude: 1, Longitude: 2, Radius: 3000,
		})
		require.NoError(t, err)
		require.False(t, result.CrawlingTriggered)
		require.True(t, result.FromCache)
		require.Equal(t, "Results from database", result.Message)
	})

	t.Run("no recent CrawlerSearch row (the actual current behavior, since nothing ever writes one) triggers a crawl", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().FindActivitiesInBoundingBox(mock.Anything, mock.Anything).Return(nil, nil)
		crawlDB := mocks.NewCrawlQuerier(t)
		crawlDB.EXPECT().GetRecentCrawlerSearchNear(mock.Anything, mock.Anything).Return(sqlcgen.CrawlerSearch{}, pgx.ErrNoRows)
		crawler := mocks.NewCrawler(t)
		crawler.EXPECT().CrawlAndSaveActivities(mock.Anything, 1.0, 2.0, 3000.0).Return(nil, nil).Maybe()

		svc := activities.NewHybridSearchService(activities.NewService(db, nil, mocks.NewVectorFinder(t)), crawler, crawlDB)
		result, err := svc.SearchActivitiesWithCrawling(context.Background(), activities.HybridSearchParams{
			Latitude: 1, Longitude: 2, Radius: 3000,
		})
		require.NoError(t, err)
		require.True(t, result.CrawlingTriggered)
		time.Sleep(20 * time.Millisecond)
	})

	t.Run("types filter drops rows whose knownActivityTypeName doesn't match, after FindAll", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		db.EXPECT().FindActivitiesInBoundingBox(mock.Anything, mock.Anything).Return([]sqlcgen.Activity{
			{ID: "a1", Name: "Cultural spot", Latitude: floatP(1), Longitude: floatP(2), KnownActivityTypeName: strP("cultural")},
			{ID: "a2", Name: "Food spot", Latitude: floatP(1), Longitude: floatP(2), KnownActivityTypeName: strP("food")},
		}, nil)
		crawlDB := mocks.NewCrawlQuerier(t)
		crawlDB.EXPECT().GetRecentCrawlerSearchNear(mock.Anything, mock.Anything).Return(sqlcgen.CrawlerSearch{ID: "cs-1"}, nil)

		svc := activities.NewHybridSearchService(activities.NewService(db, nil, mocks.NewVectorFinder(t)), mocks.NewCrawler(t), crawlDB)
		result, err := svc.SearchActivitiesWithCrawling(context.Background(), activities.HybridSearchParams{
			Latitude: 1, Longitude: 2, Radius: 3000, Types: []string{"cultural"},
		})
		require.NoError(t, err)
		require.Len(t, result.Activities, 1)
		require.Equal(t, "a1", result.Activities[0].ID)
	})
}
