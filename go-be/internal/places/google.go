package places

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// GoogleProvider ports GooglePlacesApiService (the New Places API v1).
// Not the actively-configured provider in this project (PLACES_PROVIDER=geoapify),
// but implemented for completeness/parity — see GeoapifyProvider for the
// one that's actually live.
type GoogleProvider struct {
	apiKey  string
	client  *http.Client
	baseURL string
}

func NewGoogleProvider(apiKey string, client *http.Client) *GoogleProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &GoogleProvider{apiKey: apiKey, client: client, baseURL: "https://places.googleapis.com/v1/places"}
}

const googleFieldMask = "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.websiteUri,places.nationalPhoneNumber,places.priceLevel,places.regularOpeningHours"

type googlePlace struct {
	ID          string `json:"id"`
	DisplayName *struct {
		Text string `json:"text"`
	} `json:"displayName"`
	FormattedAddress string `json:"formattedAddress"`
	Location         *struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"location"`
	Rating              *float64 `json:"rating"`
	UserRatingCount     *int     `json:"userRatingCount"`
	Types               []string `json:"types"`
	WebsiteURI          string   `json:"websiteUri"`
	NationalPhoneNumber string   `json:"nationalPhoneNumber"`
	PriceLevel          string   `json:"priceLevel"`
	RegularOpeningHours *struct {
		WeekdayDescriptions []string `json:"weekdayDescriptions"`
	} `json:"regularOpeningHours"`
}

func mapGooglePlace(p googlePlace) PlaceData {
	data := PlaceData{
		ID:                  p.ID,
		FormattedAddress:    p.FormattedAddress,
		Rating:              p.Rating,
		UserRatingCount:     p.UserRatingCount,
		Types:               p.Types,
		WebsiteURI:          p.WebsiteURI,
		NationalPhoneNumber: p.NationalPhoneNumber,
		PriceLevel:          p.PriceLevel,
	}
	if p.DisplayName != nil {
		data.Name = p.DisplayName.Text
		data.DisplayName = p.DisplayName.Text
	}
	if p.Location != nil {
		data.Latitude = p.Location.Latitude
		data.Longitude = p.Location.Longitude
	}
	if p.RegularOpeningHours != nil {
		data.OpeningHoursWeekdayText = p.RegularOpeningHours.WeekdayDescriptions
	}
	return data
}

type googlePlacesResponse struct {
	Places []googlePlace `json:"places"`
}

func (g *GoogleProvider) SearchNearby(ctx context.Context, params SearchNearbyParams) ([]PlaceData, error) {
	if g.apiKey == "" {
		return nil, fmt.Errorf("GOOGLE_MAPS_API_KEY is not configured")
	}

	maxResults := params.MaxResultCount
	if maxResults == 0 {
		maxResults = 20
	}
	rankPreference := params.RankPreference
	if rankPreference == "" {
		rankPreference = "DISTANCE"
	}

	body := map[string]any{
		"maxResultCount": maxResults,
		"rankPreference": rankPreference,
		"locationRestriction": map[string]any{
			"circle": map[string]any{
				"center": map[string]any{"latitude": params.Latitude, "longitude": params.Longitude},
				"radius": params.Radius,
			},
		},
	}
	if len(params.IncludedTypes) > 0 {
		body["includedTypes"] = params.IncludedTypes
	}

	var resp googlePlacesResponse
	if err := g.post(ctx, g.baseURL+":searchNearby", body, &resp); err != nil {
		return nil, fmt.Errorf("google searchNearby: %w", err)
	}
	return mapGooglePlaces(resp.Places), nil
}

func (g *GoogleProvider) SearchText(ctx context.Context, params SearchTextParams) ([]PlaceData, error) {
	if g.apiKey == "" {
		return nil, fmt.Errorf("GOOGLE_MAPS_API_KEY is not configured")
	}

	maxResults := params.MaxResultCount
	if maxResults == 0 {
		maxResults = 5
	}
	body := map[string]any{"textQuery": params.TextQuery, "maxResultCount": maxResults}
	if params.Latitude != 0 && params.Longitude != 0 {
		radius := params.Radius
		if radius == 0 {
			radius = 5000
		}
		body["locationBias"] = map[string]any{
			"circle": map[string]any{
				"center": map[string]any{"latitude": params.Latitude, "longitude": params.Longitude},
				"radius": radius,
			},
		}
	}

	var resp googlePlacesResponse
	if err := g.post(ctx, g.baseURL+":searchText", body, &resp); err != nil {
		return nil, fmt.Errorf("google searchText: %w", err)
	}
	return mapGooglePlaces(resp.Places), nil
}

func (g *GoogleProvider) GetPlaceDetails(ctx context.Context, placeID string) (PlaceData, error) {
	if g.apiKey == "" {
		return PlaceData{}, fmt.Errorf("GOOGLE_MAPS_API_KEY is not configured")
	}

	url := fmt.Sprintf("%s/%s?fields=id,nationalPhoneNumber,websiteUri,displayName,formattedAddress", g.baseURL, placeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return PlaceData{}, err
	}
	req.Header.Set("X-Goog-Api-Key", g.apiKey)

	resp, err := g.client.Do(req)
	if err != nil {
		return PlaceData{}, fmt.Errorf("get place details: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return PlaceData{}, fmt.Errorf("get place details: status %d", resp.StatusCode)
	}

	var p googlePlace
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return PlaceData{}, fmt.Errorf("decode place details: %w", err)
	}
	return mapGooglePlace(p), nil
}

func mapGooglePlaces(places []googlePlace) []PlaceData {
	out := make([]PlaceData, 0, len(places))
	for _, p := range places {
		out = append(out, mapGooglePlace(p))
	}
	return out
}

func (g *GoogleProvider) post(ctx context.Context, url string, body any, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", g.apiKey)
	req.Header.Set("X-Goog-FieldMask", googleFieldMask)

	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
