package places

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// Querier is the narrow slice of sqlcgen.Queries Service needs — defined
// here, the consumer, so tests can mock just this.
type Querier interface {
	GetKnownActivityTypeByName(ctx context.Context, name string) (sqlcgen.KnownActivityType, error)
	CreateKnownActivityType(ctx context.Context, arg sqlcgen.CreateKnownActivityTypeParams) (sqlcgen.KnownActivityType, error)
	UpdateKnownActivityType(ctx context.Context, arg sqlcgen.UpdateKnownActivityTypeParams) error
	GetSourceByName(ctx context.Context, name string) (sqlcgen.Source, error)
	CreateSource(ctx context.Context, arg sqlcgen.CreateSourceParams) (sqlcgen.Source, error)
	GetActivityBySourceAndExternalID(ctx context.Context, arg sqlcgen.GetActivityBySourceAndExternalIDParams) (string, error)
}

// Categorizer classifies a place into a canonical activity category using
// AI as a fallback when the static Google-types mapping doesn't match.
// Mirrors LangChainService.generateCompletionResponse's role in
// classifyActivityCategoryWithAI — kept as a narrow interface (not the
// whole ai.ChatService) so this package doesn't depend on the AI layer's
// full surface.
type Categorizer interface {
	GenerateCompletionResponse(ctx context.Context, promptTemplate string, variables map[string]string) (string, error)
}

// ActivityDraft is what crawlAndSaveActivities hands off for persistence —
// the Go equivalent of CreateActivityDto's shape as populated by
// GooglePlacesService.crawlAndSaveActivities.
type ActivityDraft struct {
	Name                  string
	Description           string
	Type                  string
	Duration              float64
	Price                 float64
	MaxGroupSize          int
	Latitude              float64
	Longitude             float64
	Rating                *float64
	RatingCount           *int
	FormattedAddress      string
	PhoneNumber           string
	Website               string
	PriceLevel            *int
	OpeningHours          json.RawMessage
	KnownActivityTypeName string
	Location              json.RawMessage
	SourceID              string
	ExternalID            string
	Metadata              json.RawMessage
}

// ActivityCreator is implemented by internal/activities (task 6) — defined
// here, the consumer, so this package has no dependency on activities'
// internal types; wiring happens in main.go once both packages exist.
type ActivityCreator interface {
	CreateFromDraft(ctx context.Context, draft ActivityDraft) (id string, err error)
}

// EmbeddingSaver is the narrow slice of ai.VectorStore's surface
// crawlAndSaveActivities needs — ai.VectorStore satisfies this
// structurally, no adapter required.
type EmbeddingSaver interface {
	AddActivityToVectorStore(ctx context.Context, id, name string, description, activityType *string, metadataJSON []byte) error
}

type SearchDef struct {
	Type          string
	Keyword       string
	MinRating     float64
	PreferredTime string
}

type categoryGroup struct {
	Category string
	Searches []SearchDef
}

// placesToSearch mirrors the placesToSearch config table in google-places.service.ts.
var placesToSearch = []categoryGroup{
	{Category: "cultural", Searches: []SearchDef{
		{Type: "museum", Keyword: "art history culture", MinRating: 4.0, PreferredTime: "day"},
		{Type: "art_gallery", Keyword: "contemporary modern art", MinRating: 4.0, PreferredTime: "day"},
		{Type: "tourist_attraction", Keyword: "historic cultural landmark", MinRating: 4.0, PreferredTime: "day"},
	}},
	{Category: "cultural", Searches: []SearchDef{ // religious/historical places are part of the cultural category
		{Type: "church", Keyword: "cathedral temple historic", MinRating: 4.0, PreferredTime: "day"},
		{Type: "point_of_interest", Keyword: "historic monument heritage", MinRating: 4.0, PreferredTime: "day"},
	}},
	{Category: "outdoor", Searches: []SearchDef{
		{Type: "park", Keyword: "national park nature reserve", MinRating: 4.0, PreferredTime: "day"},
		{Type: "natural_feature", Keyword: "landscape scenic viewpoint", MinRating: 4.0, PreferredTime: "day"},
		{Type: "hiking_trail", Keyword: "hiking trekking trail nature", MinRating: 4.0, PreferredTime: "morning"},
		{Type: "campground", Keyword: "camping nature outdoor", MinRating: 3.5, PreferredTime: "day"},
	}},
	{Category: "food", Searches: []SearchDef{
		{Type: "restaurant", Keyword: "fine dining local cuisine traditional", MinRating: 4.2, PreferredTime: "evening"},
		{Type: "restaurant", Keyword: "popular authentic food", MinRating: 4.0, PreferredTime: "lunch"},
		{Type: "cafe", Keyword: "coffee breakfast brunch", MinRating: 4.0, PreferredTime: "morning"},
	}},
	{Category: "nightlife", Searches: []SearchDef{
		{Type: "bar", Keyword: "cocktail rooftop lounge", MinRating: 4.0, PreferredTime: "night"},
		{Type: "bar", Keyword: "pub local beer craft", MinRating: 4.0, PreferredTime: "night"},
	}},
	{Category: "entertainment", Searches: []SearchDef{
		{Type: "amusement_park", Keyword: "theme park entertainment family", MinRating: 4.0, PreferredTime: "day"},
		{Type: "movie_theater", Keyword: "cinema entertainment", MinRating: 4.0, PreferredTime: "evening"},
	}},
}

type activityTypeDef struct {
	Name            string
	Includes        []string
	DefaultDuration float64
	Icon            string
	Description     string
}

// activityTypes mirrors the ActivityTypes config table in google-places.service.ts.
var activityTypes = []activityTypeDef{
	{Name: "cultural", Includes: []string{"museum", "art_gallery", "tourist_attraction", "historical_landmark"}, DefaultDuration: 2.5, Icon: "\U0001F3DB", Description: "Cultural and historical activities"},
	{Name: "outdoor", Includes: []string{"park", "hiking_trail", "natural_feature", "campground"}, DefaultDuration: 3.0, Icon: "\U0001F333", Description: "Outdoor and nature activities"},
	{Name: "entertainment", Includes: []string{"amusement_park", "movie_theater", "bowling_alley", "casino"}, DefaultDuration: 4.0, Icon: "\U0001F3AD", Description: "Entertainment and fun activities"},
	{Name: "food", Includes: []string{"restaurant", "cafe", "bakery", "food_market"}, DefaultDuration: 1.5, Icon: "\U0001F37D", Description: "Food and dining experiences"},
	{Name: "nightlife", Includes: []string{"bar", "night_club", "lounge", "karaoke"}, DefaultDuration: 2.0, Icon: "\U0001F319", Description: "Nightlife and entertainment"},
}

// unsupportedNearbyTypes mirrors the unsupportedTypes set in searchNearbyPlaces:
// types with no reliable "nearby search" mapping, falling back to text search.
var unsupportedNearbyTypes = map[string]bool{
	"point_of_interest": true,
	"natural_feature":   true,
	"hiking_trail":      true,
}

const searchRadiusMeters = 5000

// Service ports GooglePlacesService.
type Service struct {
	db           Querier
	provider     Provider
	categorize   Categorizer
	creator      ActivityCreator
	embeddings   EmbeddingSaver
	providerName string // "google" | "geoapify" — for source-name provenance, matches ensureGooglePlacesSource
}

func NewService(db Querier, provider Provider, categorize Categorizer, creator ActivityCreator, embeddings EmbeddingSaver, providerName string) *Service {
	return &Service{db: db, provider: provider, categorize: categorize, creator: creator, embeddings: embeddings, providerName: providerName}
}

// EnsureKnownActivityTypes seeds/updates the known_activity_types table
// from the static activityTypes config, mirroring ensureKnownActivityTypes.
func (s *Service) EnsureKnownActivityTypes(ctx context.Context) error {
	for _, t := range activityTypes {
		existing, err := s.db.GetKnownActivityTypeByName(ctx, t.Name)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				slog.Warn("failed looking up known activity type", "type", t.Name, "error", err)
				continue
			}
			if _, err := s.db.CreateKnownActivityType(ctx, sqlcgen.CreateKnownActivityTypeParams{
				ID: newID(), Name: t.Name, Icon: &t.Icon, Description: &t.Description, Category: &t.Name,
			}); err != nil {
				slog.Warn("failed creating known activity type", "type", t.Name, "error", err)
			}
			continue
		}

		if strPtrDiffers(existing.Icon, t.Icon) || strPtrDiffers(existing.Description, t.Description) || strPtrDiffers(existing.Category, t.Name) {
			if err := s.db.UpdateKnownActivityType(ctx, sqlcgen.UpdateKnownActivityTypeParams{
				ID: existing.ID, Icon: &t.Icon, Description: &t.Description, Category: &t.Name,
			}); err != nil {
				slog.Warn("failed updating known activity type", "type", t.Name, "error", err)
			}
		}
	}
	return nil
}

func strPtrDiffers(p *string, want string) bool {
	return p == nil || *p != want
}

// findMatchingActivityType mirrors findMatchingActivityType: static
// lookup from the place's provider-reported types to a canonical category.
func findMatchingActivityType(googleTypes []string) (name string, duration float64, ok bool) {
	for _, gt := range googleTypes {
		for _, t := range activityTypes {
			for _, inc := range t.Includes {
				if inc == gt {
					return t.Name, t.DefaultDuration, true
				}
			}
		}
	}
	return "", 0, false
}

// classifyActivityCategoryWithAI mirrors the method of the same name: AI
// fallback classification when the static type mapping doesn't match.
// Returns ("", false) on any failure — callers fall back to the search
// group's own category, same as Nest.
func (s *Service) classifyActivityCategoryWithAI(ctx context.Context, place PlaceData) (string, bool) {
	if s.categorize == nil {
		return "", false
	}

	categories := []string{"cultural", "outdoor", "entertainment", "food", "nightlife"}
	placeJSON, err := json.Marshal(map[string]any{
		"name": place.Name, "types": place.Types, "formattedAddress": place.FormattedAddress,
		"website": place.WebsiteURI, "rating": place.Rating,
	})
	if err != nil {
		return "", false
	}

	const promptTemplate = "Given the following place data, choose the single best category from this exact set: cultural | outdoor | entertainment | food | nightlife.\n\nPlace JSON:\n{placeJson}\n\nAnswer ONLY with one word from the set above, no punctuation, no explanation."

	response, err := s.categorize.GenerateCompletionResponse(ctx, promptTemplate, map[string]string{"placeJson": string(placeJSON)})
	if err != nil {
		slog.Warn("AI category classification failed; falling back to defaults", "error", err)
		return "", false
	}

	normalized := strings.ToLower(strings.TrimSpace(response))
	for _, c := range categories {
		if normalized == c {
			return c, true
		}
	}
	cleaned := stripNonAlpha(normalized)
	for _, c := range categories {
		if cleaned == c {
			return c, true
		}
	}
	return "", false
}

func stripNonAlpha(s string) string {
	return nonAlpha.ReplaceAllString(s, "")
}

// SearchNearbyPlaces mirrors searchNearbyPlaces: nearby search for
// supported types, text-search fallback for the three that aren't, then
// filters by minRating (missing rating never fails the filter — Geoapify
// never exposes rating at all).
func (s *Service) SearchNearbyPlaces(ctx context.Context, latitude, longitude, radius float64, search SearchDef) ([]PlaceData, error) {
	var (
		results []PlaceData
		err     error
	)

	if radius == 0 {
		radius = searchRadiusMeters
	}

	if !unsupportedNearbyTypes[search.Type] {
		results, err = s.provider.SearchNearby(ctx, SearchNearbyParams{
			Latitude: latitude, Longitude: longitude, Radius: radius,
			IncludedTypes: []string{search.Type}, MaxResultCount: 20, RankPreference: "DISTANCE",
		})
	} else {
		query := strings.TrimSpace(strings.ReplaceAll(search.Type, "_", " ") + " " + search.Keyword)
		results, err = s.provider.SearchText(ctx, SearchTextParams{
			TextQuery: query, Latitude: latitude, Longitude: longitude, Radius: radius, MaxResultCount: 20,
		})
	}
	if err != nil {
		return nil, fmt.Errorf("search nearby places: %w", err)
	}

	filtered := make([]PlaceData, 0, len(results))
	for _, p := range results {
		if p.Rating == nil || *p.Rating >= search.MinRating {
			filtered = append(filtered, p)
		}
	}
	return filtered, nil
}

func (s *Service) ensureSource(ctx context.Context) (string, error) {
	name, baseURL := "google-maps", "https://maps.google.com"
	if s.providerName == "geoapify" {
		name, baseURL = "geoapify", "https://www.geoapify.com"
	}

	existing, err := s.db.GetSourceByName(ctx, name)
	if err == nil {
		return existing.ID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("look up source: %w", err)
	}

	created, err := s.db.CreateSource(ctx, sqlcgen.CreateSourceParams{ID: newID(), Name: name, Type: "api", BaseUrl: &baseURL})
	if err != nil {
		return "", fmt.Errorf("create source: %w", err)
	}
	return created.ID, nil
}

// CrawlAndSaveActivities mirrors crawlAndSaveActivities: runs every
// configured search, classifies + dedupes results, persists new activities
// via ActivityCreator, and best-effort embeds them via EmbeddingSaver.
func (s *Service) CrawlAndSaveActivities(ctx context.Context, latitude, longitude, radius float64) ([]string, error) {
	if err := s.EnsureKnownActivityTypes(ctx); err != nil {
		return nil, err
	}
	sourceID, err := s.ensureSource(ctx)
	if err != nil {
		return nil, err
	}

	var drafts []ActivityDraft
	for _, group := range placesToSearch {
		for _, search := range group.Searches {
			results, err := s.SearchNearbyPlaces(ctx, latitude, longitude, radius, search)
			if err != nil {
				slog.Error("error searching nearby places", "type", search.Type, "error", err)
				continue
			}

			for _, place := range results {
				categoryName, matched := "", false
				if name, _, ok := findMatchingActivityType(place.Types); ok {
					categoryName, matched = name, true
				}
				if !matched {
					categoryName, matched = s.classifyActivityCategoryWithAI(ctx, place)
				}
				if !matched {
					categoryName = strings.ToLower(group.Category)
				}

				_, duration, hasDuration := findMatchingActivityType(place.Types)
				if !hasDuration {
					duration = defaultDurationFor(categoryName)
				}

				priceLevel, hasPrice := PriceLevelToNumber(place.PriceLevel)
				price := 0.0
				var priceLevelPtr *int
				if hasPrice {
					price = float64(priceLevel) * 10
					priceLevelPtr = &priceLevel
				}

				location, _ := json.Marshal(map[string]float64{"latitude": place.Latitude, "longitude": place.Longitude})
				var openingHours json.RawMessage
				if len(place.OpeningHoursWeekdayText) > 0 {
					openingHours, _ = json.Marshal(map[string]any{"weekdayText": place.OpeningHoursWeekdayText})
				}
				metadata, _ := json.Marshal(map[string]any{
					"activityId":    place.ID,
					"googleTypes":   place.Types,
					"preferredTime": search.PreferredTime,
				})

				name := place.Name
				if name == "" {
					name = place.DisplayName
				}

				drafts = append(drafts, ActivityDraft{
					Name: name, Description: place.WebsiteURI, Type: categoryName, Duration: duration,
					Price: price, MaxGroupSize: 15, Latitude: place.Latitude, Longitude: place.Longitude,
					Rating: place.Rating, RatingCount: place.UserRatingCount, FormattedAddress: place.FormattedAddress,
					PhoneNumber: place.NationalPhoneNumber, Website: place.WebsiteURI, PriceLevel: priceLevelPtr,
					OpeningHours: openingHours, KnownActivityTypeName: categoryName, Location: location,
					SourceID: sourceID, ExternalID: place.ID, Metadata: metadata,
				})
			}
		}
	}

	var createdIDs []string
	for _, draft := range drafts {
		_, err := s.db.GetActivityBySourceAndExternalID(ctx, sqlcgen.GetActivityBySourceAndExternalIDParams{
			SourceId: &draft.SourceID, ExternalId: &draft.ExternalID,
		})
		if err == nil {
			continue // already crawled
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("error checking for existing activity", "externalId", draft.ExternalID, "error", err)
			continue
		}

		id, err := s.creator.CreateFromDraft(ctx, draft)
		if err != nil {
			slog.Error("error creating activity from crawl", "name", draft.Name, "error", err)
			continue
		}
		createdIDs = append(createdIDs, id)

		if s.embeddings != nil {
			var desc *string
			if draft.Description != "" {
				desc = &draft.Description
			}
			typ := draft.Type
			if err := s.embeddings.AddActivityToVectorStore(ctx, id, draft.Name, desc, &typ, draft.Metadata); err != nil {
				// Log but don't fail the entire crawl — activities were saved.
				slog.Error("failed to save embedding, but activity was saved", "id", id, "error", err)
			}
		}
	}

	slog.Debug("saved activities to database", "count", len(createdIDs))
	return createdIDs, nil
}

func defaultDurationFor(category string) float64 {
	for _, t := range activityTypes {
		if t.Name == category {
			return t.DefaultDuration
		}
	}
	return 2.0
}

// newID mirrors Prisma's @default(uuid()) on KnownActivityType.id/Source.id
// — the client generates the id, not the database.
func newID() string {
	return uuid.NewString()
}
