package places

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// typeToGeoapifyCategories maps the Google-Places-style type strings used
// by the crawl config to the closest Geoapify category code(s). Geoapify
// accepts a comma-separated list of categories per request (OR semantics).
var typeToGeoapifyCategories = map[string]string{
	"museum":             "entertainment.museum",
	"art_gallery":        "entertainment.culture.gallery",
	"tourist_attraction": "tourism.attraction",
	"church":             "tourism.sights.place_of_worship",
	"point_of_interest":  "tourism.attraction,tourism.sights",
	"park":               "leisure.park",
	// Geoapify has no dedicated "hiking trail" POI category; this is the
	// closest available approximation and may return sparse/irrelevant results.
	"natural_feature": "natural.forest,natural.mountain,natural.water,natural.protected_area",
	"hiking_trail":    "natural.forest,natural.protected_area",
	"campground":      "camping.camp_site",
	"restaurant":      "catering.restaurant",
	"cafe":            "catering.cafe",
	"bar":             "catering.bar,catering.pub",
	"amusement_park":  "entertainment.theme_park",
	"movie_theater":   "entertainment.cinema",
}

// textSearchKeywordCategories recovers the intended category from a
// composed textQuery as a best effort — Geoapify has no free-text search
// endpoint (that's a separate Geocoding/Autocomplete product), so
// SearchText is only ever called for the types nearby search doesn't
// support (point_of_interest, natural_feature, hiking_trail).
var textSearchKeywordCategories = []struct {
	match      string
	categories string
}{
	{"hikingtrail", typeToGeoapifyCategories["hiking_trail"]},
	{"naturalfeature", typeToGeoapifyCategories["natural_feature"]},
	{"pointofinterest", typeToGeoapifyCategories["point_of_interest"]},
}

var nonAlpha = regexp.MustCompile(`[^a-z]`)

// GeoapifyProvider ports GeoapifyPlacesApiService — the provider actually
// configured in this project's .env (PLACES_PROVIDER=geoapify).
type GeoapifyProvider struct {
	apiKey     string
	client     *http.Client
	baseURL    string
	detailsURL string
}

func NewGeoapifyProvider(apiKey string, client *http.Client) *GeoapifyProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &GeoapifyProvider{
		apiKey:     apiKey,
		client:     client,
		baseURL:    "https://api.geoapify.com/v2/places",
		detailsURL: "https://api.geoapify.com/v2/place-details",
	}
}

type geoapifyFeature struct {
	Properties struct {
		PlaceID   string  `json:"place_id"`
		Name      string  `json:"name"`
		Formatted string  `json:"formatted"`
		Lat       float64 `json:"lat"`
		Lon       float64 `json:"lon"`
		Contact   struct {
			Phone string `json:"phone"`
		} `json:"contact"`
		Website      string `json:"website"`
		OpeningHours string `json:"opening_hours"`
	} `json:"properties"`
}

type geoapifyPlacesResponse struct {
	Features []geoapifyFeature `json:"features"`
}

func mapGeoapifyFeature(f geoapifyFeature, types []string) PlaceData {
	p := f.Properties
	return PlaceData{
		ID:               p.PlaceID,
		Name:             p.Name,
		DisplayName:      p.Name,
		FormattedAddress: p.Formatted,
		Latitude:         p.Lat,
		Longitude:        p.Lon,
		Types:            types,
		// Geoapify never exposes rating/review-count or a structured price
		// level, on any endpoint or plan. Opening hours DO exist, but only
		// on Place Details, not on this Places Search response.
	}
}

func (g *GeoapifyProvider) searchByCategory(ctx context.Context, categories string, lat, lng, radius float64, maxResults int, types []string) ([]PlaceData, error) {
	if g.apiKey == "" {
		return nil, fmt.Errorf("GEOAPIFY_API_KEY is not configured")
	}

	q := url.Values{}
	q.Set("categories", categories)
	// Geoapify's circle filter takes lon,lat (reversed from the usual lat,lng).
	q.Set("filter", fmt.Sprintf("circle:%s,%s,%s", trimFloat(lng), trimFloat(lat), trimFloat(radius)))
	q.Set("limit", strconv.Itoa(maxResults))
	q.Set("apiKey", g.apiKey)

	var resp geoapifyPlacesResponse
	if err := g.get(ctx, g.baseURL+"?"+q.Encode(), &resp); err != nil {
		return nil, fmt.Errorf("search geoapify places (categories=%s): %w", categories, err)
	}

	places := make([]PlaceData, 0, len(resp.Features))
	for _, f := range resp.Features {
		places = append(places, mapGeoapifyFeature(f, types))
	}
	return places, nil
}

func (g *GeoapifyProvider) SearchNearby(ctx context.Context, params SearchNearbyParams) ([]PlaceData, error) {
	var categories []string
	for _, t := range params.IncludedTypes {
		if c, ok := typeToGeoapifyCategories[t]; ok {
			categories = append(categories, c)
		}
	}
	if len(categories) == 0 {
		return nil, nil
	}

	maxResults := params.MaxResultCount
	if maxResults == 0 {
		maxResults = 20
	}
	return g.searchByCategory(ctx, strings.Join(categories, ","), params.Latitude, params.Longitude, params.Radius, maxResults, params.IncludedTypes)
}

func (g *GeoapifyProvider) SearchText(ctx context.Context, params SearchTextParams) ([]PlaceData, error) {
	normalized := nonAlpha.ReplaceAllString(strings.ToLower(params.TextQuery), "")

	var categories string
	for _, entry := range textSearchKeywordCategories {
		if strings.Contains(normalized, entry.match) {
			categories = entry.categories
			break
		}
	}
	if categories == "" {
		return nil, nil
	}
	if params.Latitude == 0 && params.Longitude == 0 {
		return nil, nil
	}

	radius := params.Radius
	if radius == 0 {
		radius = 5000
	}
	maxResults := params.MaxResultCount
	if maxResults == 0 {
		maxResults = 20
	}
	return g.searchByCategory(ctx, categories, params.Latitude, params.Longitude, radius, maxResults, nil)
}

func (g *GeoapifyProvider) GetPlaceDetails(ctx context.Context, placeID string) (PlaceData, error) {
	if g.apiKey == "" {
		return PlaceData{}, fmt.Errorf("GEOAPIFY_API_KEY is not configured")
	}

	q := url.Values{}
	q.Set("id", placeID)
	q.Set("apiKey", g.apiKey)

	var resp geoapifyPlacesResponse
	if err := g.get(ctx, g.detailsURL+"?"+q.Encode(), &resp); err != nil {
		return PlaceData{}, nil //nolint:nilerr // matches Nest's getPlaceDetails: log-and-return-empty, never propagate
	}
	if len(resp.Features) == 0 {
		return PlaceData{}, nil
	}

	p := resp.Features[0].Properties
	data := PlaceData{ID: p.PlaceID, Name: p.Name, NationalPhoneNumber: p.Contact.Phone, WebsiteURI: p.Website}
	if p.OpeningHours != "" {
		// Raw OSM-syntax string (e.g. "Mo-Fr 09:00-18:00; Sa 10:00-14:00"),
		// wrapped in a single-element slice to fit the weekdayText shape the
		// tour prompt formatter expects — an LLM can reasonably interpret
		// the OSM format as-is.
		data.OpeningHoursWeekdayText = []string{p.OpeningHours}
	}
	return data, nil
}

func (g *GeoapifyProvider) get(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("geoapify request failed: status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func trimFloat(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}
