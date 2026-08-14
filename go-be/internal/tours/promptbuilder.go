package tours

import (
	"strconv"
	"strings"
)

// promptParams mirrors buildPromptFromParams' inline params object.
type promptParams struct {
	Name                string
	Description         string
	Days                int
	StartDates          []string
	Categories          []string
	Interests           []string
	BudgetLevel         string
	TransportationMode  []string
	TravelPace          string
	DietaryRestrictions []string
	GroupType           string
	Latitude, Longitude float64
	HasLocation         bool
}

// BuildPromptFromParams ports buildPromptFromParams (utils/prompt-builder.util.ts).
func BuildPromptFromParams(p promptParams) string {
	var parts []string

	if p.Name != "" {
		parts = append(parts, "Tour Name: "+p.Name)
	}
	if p.Description != "" {
		parts = append(parts, "Description: "+p.Description)
	}
	if p.Days != 0 {
		parts = append(parts, "Number of days: "+strconv.Itoa(p.Days))
	}
	if len(p.StartDates) > 0 {
		parts = append(parts, "Start dates: "+strings.Join(p.StartDates, ", "))
	}
	if len(p.Categories) > 0 {
		parts = append(parts, "Categories: "+strings.Join(p.Categories, ", "))
	}
	if len(p.Interests) > 0 {
		parts = append(parts, "Interests: "+strings.Join(p.Interests, ", "))
	}
	if p.BudgetLevel != "" {
		parts = append(parts, "Budget level: "+p.BudgetLevel)
	}
	if len(p.TransportationMode) > 0 {
		parts = append(parts, "Transportation: "+strings.Join(p.TransportationMode, ", "))
	}
	if p.TravelPace != "" {
		parts = append(parts, "Travel pace: "+p.TravelPace)
	}
	if len(p.DietaryRestrictions) > 0 {
		parts = append(parts, "Dietary restrictions: "+strings.Join(p.DietaryRestrictions, ", "))
	}
	if p.GroupType != "" {
		parts = append(parts, "Group type: "+p.GroupType)
	}
	if p.HasLocation {
		parts = append(parts, "Location: "+formatCoord(p.Latitude)+", "+formatCoord(p.Longitude))
	}

	if len(parts) == 0 {
		return "Create a general tour itinerary"
	}
	return "Create a tour based on: " + strings.Join(parts, "; ")
}

// BuildPreferencesObject ports buildPreferencesObject — the subset of
// GenerateTourOptions worth persisting into Tour.metadata.preferences for
// display, independent of the full options bag.
func BuildPreferencesObject(options GenerateTourOptions) map[string]any {
	prefs := map[string]any{}

	if options.Destination != nil {
		prefs["destination"] = *options.Destination
	}
	if options.DestinationLatitude != nil {
		prefs["destinationLatitude"] = *options.DestinationLatitude
	}
	if options.DestinationLongitude != nil {
		prefs["destinationLongitude"] = *options.DestinationLongitude
	}
	if len(options.Interests) > 0 {
		prefs["interests"] = options.Interests
	}
	if len(options.TransportationMode) > 0 {
		prefs["transportationMode"] = options.TransportationMode
	}
	if options.TravelPace != nil {
		prefs["travelPace"] = *options.TravelPace
	}
	if len(options.DietaryRestrictions) > 0 {
		prefs["dietaryRestrictions"] = options.DietaryRestrictions
	}
	if options.BudgetLevel != nil {
		prefs["budgetLevel"] = *options.BudgetLevel
	}
	if options.GroupType != nil {
		prefs["groupType"] = *options.GroupType
	}
	if len(options.StartDates) > 0 {
		prefs["startDates"] = options.StartDates
	}
	if options.Days != nil {
		prefs["days"] = *options.Days
	}

	return prefs
}

func formatCoord(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}
