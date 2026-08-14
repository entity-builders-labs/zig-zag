package tours

// Enums mirroring create-tour-from-prompt.dto.ts.
type BudgetLevel string

const (
	BudgetLevelLow    BudgetLevel = "low"
	BudgetLevelMedium BudgetLevel = "medium"
	BudgetLevelHigh   BudgetLevel = "high"
)

type TransportationMode string

const (
	TransportationWalking         TransportationMode = "walking"
	TransportationDriving         TransportationMode = "driving"
	TransportationPublicTransport TransportationMode = "public_transport"
	TransportationCycling         TransportationMode = "cycling"
)

type GroupType string

const (
	GroupTypeSolo    GroupType = "solo"
	GroupTypeCouple  GroupType = "couple"
	GroupTypeFamily  GroupType = "family"
	GroupTypeFriends GroupType = "friends"
)

type TravelPace string

const (
	TravelPaceRelaxed  TravelPace = "relaxed"
	TravelPaceModerate TravelPace = "moderate"
	TravelPaceFast     TravelPace = "fast"
)

// GenerateTourOptions mirrors GenerateTourOptions
// (interfaces/tour-generation.interface.ts) — the options bag stored in
// Tour.metadata.options and rebuilt from it when (re-)generating activities.
type GenerateTourOptions struct {
	OwnerID                   *string              `json:"ownerId,omitempty"`
	Latitude                  *float64             `json:"latitude,omitempty"`
	Longitude                 *float64             `json:"longitude,omitempty"`
	Radius                    *float64             `json:"radius,omitempty"`
	IncludeExistingActivities *bool                `json:"includeExistingActivities,omitempty"`
	Days                      *int                 `json:"days,omitempty"`
	BudgetLevel               *BudgetLevel         `json:"budgetLevel,omitempty"`
	Interests                 []string             `json:"interests,omitempty"`
	TransportationMode        []TransportationMode `json:"transportationMode,omitempty"`
	GroupType                 *GroupType           `json:"groupType,omitempty"`
	TravelPace                *TravelPace          `json:"travelPace,omitempty"`
	DietaryRestrictions       []string             `json:"dietaryRestrictions,omitempty"`
	Destination               *string              `json:"destination,omitempty"`
	DestinationLatitude       *float64             `json:"destinationLatitude,omitempty"`
	DestinationLongitude      *float64             `json:"destinationLongitude,omitempty"`
	SkipImageGeneration       *bool                `json:"skipImageGeneration,omitempty"`
	SkipActivities            *bool                `json:"skipActivities,omitempty"`
	Name                      *string              `json:"name,omitempty"`
	Description               *string              `json:"description,omitempty"`
	TotalDistance             *float64             `json:"totalDistance,omitempty"`
	Price                     *float64             `json:"price,omitempty"`
	EstimatedBudget           *float64             `json:"estimatedBudget,omitempty"`
	MaxGroupSize              *int                 `json:"maxGroupSize,omitempty"`
	RecommendedGroupSize      *int                 `json:"recommendedGroupSize,omitempty"`
	StartDates                []string             `json:"startDates,omitempty"`
	Categories                []string             `json:"categories,omitempty"`
	ExcludeTours              []string             `json:"excludeTours,omitempty"`
}
