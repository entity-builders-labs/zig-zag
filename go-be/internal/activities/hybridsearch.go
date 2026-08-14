package activities

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// pgTimestamp converts to UTC before building a pgtype.Timestamp — this
// schema's "timestamp" (no time zone) columns store UTC wall-clock numbers
// (see internal/auth/service.go's pgTimestamp for the regression this
// exact mistake caused there: a local-zone time.Time written unconverted
// silently shifts the stored instant by the machine's UTC offset).
func pgTimestamp(t time.Time) pgtype.Timestamp {
	return pgtype.Timestamp{Time: t.UTC(), Valid: true}
}

// searchRadiusThresholdDeg / cacheExpiry mirror HybridSearchService's
// SEARCH_RADIUS_THRESHOLD (~1km in degrees) and CACHE_EXPIRY_HOURS.
const (
	searchRadiusThresholdDeg = 0.01
	cacheExpiryHours         = 24
)

// CrawlQuerier is the narrow slice of sqlcgen.Queries HybridSearchService needs.
type CrawlQuerier interface {
	GetRecentCrawlerSearchNear(ctx context.Context, arg sqlcgen.GetRecentCrawlerSearchNearParams) (sqlcgen.CrawlerSearch, error)
}

// Crawler is the narrow slice of places.Service's surface needed —
// triggering a background crawl.
type Crawler interface {
	CrawlAndSaveActivities(ctx context.Context, latitude, longitude, radius float64) ([]string, error)
}

// HybridSearchResult mirrors ActivitySearchResult (interfaces/activity.interface.ts).
type HybridSearchResult struct {
	Activities        []ActivityWithDistance `json:"activities"`
	FromCache         bool                   `json:"fromCache"`
	CrawlingTriggered bool                   `json:"crawlingTriggered"`
	Message           string                 `json:"message"`
}

// HybridSearchParams mirrors searchActivitiesWithCrawling's params object.
type HybridSearchParams struct {
	Latitude     float64
	Longitude    float64
	Radius       float64
	Limit        int
	ForceRefresh bool
	Types        []string
}

// HybridSearchService ports HybridSearchService
// (be/src/modules/activities/services/hybrid-search.service.ts).
type HybridSearchService struct {
	activities *Service
	crawler    Crawler
	db         CrawlQuerier
}

func NewHybridSearchService(activities *Service, crawler Crawler, db CrawlQuerier) *HybridSearchService {
	return &HybridSearchService{activities: activities, crawler: crawler, db: db}
}

func (s *HybridSearchService) SearchActivitiesWithCrawling(ctx context.Context, params HybridSearchParams) (HybridSearchResult, error) {
	limit := params.Limit
	if limit == 0 {
		limit = 50
	}

	dbActivities, err := s.activities.FindAll(ctx,
		strconv.FormatFloat(params.Latitude, 'f', -1, 64),
		strconv.FormatFloat(params.Longitude, 'f', -1, 64),
		params.Radius, limit, params.Types,
	)
	if err != nil {
		return HybridSearchResult{}, err
	}

	if len(params.Types) > 0 {
		typeSet := make(map[string]bool, len(params.Types))
		for _, t := range params.Types {
			typeSet[strings.ToLower(t)] = true
		}
		filtered := dbActivities[:0]
		for _, a := range dbActivities {
			if a.KnownActivityTypeName != nil && typeSet[strings.ToLower(*a.KnownActivityTypeName)] {
				filtered = append(filtered, a)
			}
		}
		dbActivities = filtered
	}

	shouldCrawl, err := s.shouldTriggerCrawling(ctx, params.Latitude, params.Longitude, params.ForceRefresh)
	if err != nil {
		slog.Error("error checking crawl staleness", "error", err)
		shouldCrawl = false
	}

	if shouldCrawl {
		// Fire-and-forget, matching Nest's un-awaited
		// triggerBackgroundCrawling(...).catch(...) — errors are logged,
		// never surfaced to the caller of this request.
		go func() {
			bgCtx := context.Background()
			if _, err := s.crawler.CrawlAndSaveActivities(bgCtx, params.Latitude, params.Longitude, minFloat(params.Radius, 5000)); err != nil {
				slog.Error("background crawling failed", "latitude", params.Latitude, "longitude", params.Longitude, "error", err)
			}
		}()
	}

	message := "Results from database"
	if shouldCrawl {
		message = "Searching for new activities in background..."
	}

	return HybridSearchResult{
		Activities:        dbActivities,
		FromCache:         !shouldCrawl,
		CrawlingTriggered: shouldCrawl,
		Message:           message,
	}, nil
}

// shouldTriggerCrawling mirrors shouldTriggerCrawling exactly, including
// its actual behavior: CrawlerSearch is never written anywhere in this
// codebase (only ever read here), so absent a forceRefresh this lookup
// always misses and crawling triggers on every hybrid search. That's an
// incomplete feature upstream, not something to "fix" in this port.
func (s *HybridSearchService) shouldTriggerCrawling(ctx context.Context, latitude, longitude float64, forceRefresh bool) (bool, error) {
	if forceRefresh {
		return true, nil
	}

	_, err := s.db.GetRecentCrawlerSearchNear(ctx, sqlcgen.GetRecentCrawlerSearchNearParams{
		Latitude:    latitude - searchRadiusThresholdDeg,
		Latitude_2:  latitude + searchRadiusThresholdDeg,
		Longitude:   longitude - searchRadiusThresholdDeg,
		Longitude_2: longitude + searchRadiusThresholdDeg,
		CreatedAt:   pgTimestamp(time.Now().Add(-cacheExpiryHours * time.Hour)),
	})
	if err == nil {
		return false, nil // a recent search exists — don't re-crawl
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	return false, fmt.Errorf("check recent crawler search: %w", err)
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
