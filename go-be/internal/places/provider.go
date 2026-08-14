// Package places ports be/src/modules/integrations/google-places: a
// pluggable places-search provider (Google or Geoapify, behind a common
// interface), an optional file-based cache/mock layer in front of it, and
// the crawl orchestration that turns search results into activity drafts.
package places

import "context"

// PlaceData mirrors PlaceData (interfaces/places-api.interface.ts) — the
// common shape every provider normalizes its response into.
type PlaceData struct {
	ID                      string   `json:"id"`
	Name                    string   `json:"name,omitempty"`
	DisplayName             string   `json:"displayName,omitempty"`
	FormattedAddress        string   `json:"formattedAddress,omitempty"`
	Latitude                float64  `json:"latitude,omitempty"`
	Longitude               float64  `json:"longitude,omitempty"`
	Rating                  *float64 `json:"rating,omitempty"`
	UserRatingCount         *int     `json:"userRatingCount,omitempty"`
	Types                   []string `json:"types,omitempty"`
	WebsiteURI              string   `json:"websiteUri,omitempty"`
	NationalPhoneNumber     string   `json:"nationalPhoneNumber,omitempty"`
	PriceLevel              string   `json:"priceLevel,omitempty"`
	OpeningHoursWeekdayText []string `json:"openingHoursWeekdayText,omitempty"`
}

type SearchNearbyParams struct {
	Latitude       float64  `json:"latitude"`
	Longitude      float64  `json:"longitude"`
	Radius         float64  `json:"radius"`
	IncludedTypes  []string `json:"includedTypes,omitempty"`
	MaxResultCount int      `json:"maxResultCount,omitempty"`
	RankPreference string   `json:"rankPreference,omitempty"` // "DISTANCE" | "POPULARITY"
}

type SearchTextParams struct {
	TextQuery      string  `json:"textQuery"`
	Latitude       float64 `json:"latitude,omitempty"`
	Longitude      float64 `json:"longitude,omitempty"`
	Radius         float64 `json:"radius,omitempty"`
	MaxResultCount int     `json:"maxResultCount,omitempty"`
}

// Provider mirrors IPlacesApiService — implemented by GoogleProvider,
// GeoapifyProvider, and CachedProvider (which wraps either of the above).
type Provider interface {
	SearchNearby(ctx context.Context, params SearchNearbyParams) ([]PlaceData, error)
	SearchText(ctx context.Context, params SearchTextParams) ([]PlaceData, error)
	GetPlaceDetails(ctx context.Context, placeID string) (PlaceData, error)
}
