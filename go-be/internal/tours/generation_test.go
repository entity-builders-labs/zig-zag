package tours_test

// GatherCandidateActivities, InvokeTourChain, and LoadGenerationOptions are
// exported specifically so they're testable here without the mocks
// package (which itself imports tours for its type references) creating
// an import cycle with an internal (white-box) test file. None of them
// touch db/pool, so a GenerationService built with nil for those two
// fields is safe in these tests — the transactional
// Create/Update/replaceTourActivities paths are exercised by the
// end-to-end smoke test instead, not mocked unit tests, since faking
// pgx.Tx convincingly isn't worth the complexity it'd add.

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/tours"
	"github.com/juanobrach/zig-zag/go-be/internal/tours/mocks"
)

func floatPtr(f float64) *float64 { return &f }

// newTestToursService builds a *tours.Service backed by a permissively
// mocked Querier — GatherCandidateActivities calls updateGenerationStatus
// internally, which needs a working Service to write status messages
// through to (a nil *tours.Service would panic on the first such call).
// The .Maybe() expectations mean these tests aren't asserting anything
// about the status-update side effects themselves, just tolerating them.
func newTestToursService(t *testing.T) *tours.Service {
	t.Helper()
	db := mocks.NewQuerier(t)
	db.EXPECT().GetTour(mock.Anything, mock.Anything).Return(sqlcgen.Tour{ID: "tour-1"}, nil).Maybe()
	db.EXPECT().GetTourActivities(mock.Anything, mock.Anything).Return(nil, nil).Maybe()
	db.EXPECT().UpdateTourMetadata(mock.Anything, mock.Anything).Return(nil).Maybe()
	return tours.NewService(db, nil)
}

func TestGatherCandidateActivities(t *testing.T) {
	t.Run("no location: returns empty text without calling anything", func(t *testing.T) {
		svc := tours.NewGenerationService(newTestToursService(t), nil, nil, mocks.NewActivityFinder(t), mocks.NewCrawler(t), mocks.NewChatter(t), mocks.NewImageGenerator(t))
		text, ids, byID := svc.GatherCandidateActivities(context.Background(), "tour-1", tours.GenerateTourOptions{})
		require.Empty(t, text)
		require.Empty(t, ids)
		require.Empty(t, byID)
	})

	t.Run("local activities found: no crawl triggered", func(t *testing.T) {
		finder := mocks.NewActivityFinder(t)
		finder.EXPECT().FindAll(mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return([]tours.CandidateActivity{{ID: "a1", Name: "Museo", Latitude: -34.6, Longitude: -58.4}}, nil)
		crawler := mocks.NewCrawler(t) // zero calls expected

		svc := tours.NewGenerationService(newTestToursService(t), nil, nil, finder, crawler, mocks.NewChatter(t), mocks.NewImageGenerator(t))
		text, ids, byID := svc.GatherCandidateActivities(context.Background(), "tour-1", tours.GenerateTourOptions{
			Latitude: floatPtr(-34.6), Longitude: floatPtr(-58.4),
		})
		require.Contains(t, text, "Museo")
		require.True(t, ids["a1"])
		require.Contains(t, byID, "a1")
	})

	t.Run("no local activities: triggers a crawl, then re-searches", func(t *testing.T) {
		finder := mocks.NewActivityFinder(t)
		finder.EXPECT().FindAll(mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return(nil, nil).Once()
		crawler := mocks.NewCrawler(t)
		crawler.EXPECT().CrawlAndSaveActivities(mock.Anything, -34.6, -58.4, 5000.0).Return([]string{"new-1"}, nil)
		finder.EXPECT().FindAll(mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return([]tours.CandidateActivity{{ID: "new-1", Name: "Recien Crawleado", Latitude: -34.6, Longitude: -58.4}}, nil).Once()

		svc := tours.NewGenerationService(newTestToursService(t), nil, nil, finder, crawler, mocks.NewChatter(t), mocks.NewImageGenerator(t))
		text, ids, _ := svc.GatherCandidateActivities(context.Background(), "tour-1", tours.GenerateTourOptions{
			Latitude: floatPtr(-34.6), Longitude: floatPtr(-58.4),
		})
		require.Contains(t, text, "Recien Crawleado")
		require.True(t, ids["new-1"])
	})

	t.Run("crawl fails: returns empty text (caller fails generation), no panic", func(t *testing.T) {
		finder := mocks.NewActivityFinder(t)
		finder.EXPECT().FindAll(mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return(nil, nil)
		crawler := mocks.NewCrawler(t)
		crawler.EXPECT().CrawlAndSaveActivities(mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return(nil, errors.New("geoapify: 500"))

		svc := tours.NewGenerationService(newTestToursService(t), nil, nil, finder, crawler, mocks.NewChatter(t), mocks.NewImageGenerator(t))
		text, ids, byID := svc.GatherCandidateActivities(context.Background(), "tour-1", tours.GenerateTourOptions{
			Latitude: floatPtr(-34.6), Longitude: floatPtr(-58.4),
		})
		require.Empty(t, text)
		require.Empty(t, ids)
		require.Empty(t, byID)
	})
}

func TestInvokeTourChain(t *testing.T) {
	t.Run("clean JSON response parses directly", func(t *testing.T) {
		chat := mocks.NewChatter(t)
		chat.EXPECT().GenerateChatResponse(mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return(`{"title":"Buenos Aires Highlights","activities":[{"activityId":"a1"}]}`, nil)

		svc := tours.NewGenerationService(nil, nil, nil, mocks.NewActivityFinder(t), mocks.NewCrawler(t), chat, mocks.NewImageGenerator(t))
		got, err := svc.InvokeTourChain(context.Background(), "input", "activities")
		require.NoError(t, err)
		require.Equal(t, "Buenos Aires Highlights", got.Title)
		require.Len(t, got.Activities, 1)
	})

	t.Run("markdown-fenced JSON with a trailing comma is extracted and repaired", func(t *testing.T) {
		chat := mocks.NewChatter(t)
		chat.EXPECT().GenerateChatResponse(mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return("```json\n{\"title\":\"Tour\",\"activities\":[{\"activityId\":\"a1\"},]}\n```", nil)

		svc := tours.NewGenerationService(nil, nil, nil, mocks.NewActivityFinder(t), mocks.NewCrawler(t), chat, mocks.NewImageGenerator(t))
		got, err := svc.InvokeTourChain(context.Background(), "input", "activities")
		require.NoError(t, err)
		require.Equal(t, "Tour", got.Title)
	})

	t.Run("chat call failure propagates", func(t *testing.T) {
		chat := mocks.NewChatter(t)
		chat.EXPECT().GenerateChatResponse(mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return("", errors.New("groq: 503"))

		svc := tours.NewGenerationService(nil, nil, nil, mocks.NewActivityFinder(t), mocks.NewCrawler(t), chat, mocks.NewImageGenerator(t))
		_, err := svc.InvokeTourChain(context.Background(), "input", "activities")
		require.Error(t, err)
	})
}

func TestLoadGenerationOptions(t *testing.T) {
	t.Run("missing options key", func(t *testing.T) {
		_, _, err := tours.LoadGenerationOptions(map[string]any{})
		require.ErrorIs(t, err, tours.ErrNoGenerationOptions)
	})

	t.Run("missing prompt", func(t *testing.T) {
		_, _, err := tours.LoadGenerationOptions(map[string]any{"options": map[string]any{}})
		require.ErrorIs(t, err, tours.ErrNoGenerationPrompt)
	})

	t.Run("round-trips options and prefers originalPrompt over enhancedPrompt", func(t *testing.T) {
		meta := map[string]any{
			"options":        map[string]any{"latitude": -34.6, "days": float64(3)},
			"originalPrompt": "original",
			"enhancedPrompt": "enhanced",
		}
		options, prompt, err := tours.LoadGenerationOptions(meta)
		require.NoError(t, err)
		require.Equal(t, "original", prompt)
		require.NotNil(t, options.Latitude)
		require.Equal(t, -34.6, *options.Latitude)
		require.NotNil(t, options.Days)
		require.Equal(t, 3, *options.Days)
	})
}
