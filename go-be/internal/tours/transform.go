package tours

import (
	"encoding/json"
	"regexp"
	"time"

	"github.com/google/uuid"
)

// AIActivity is one element of the AI response's "activities" array —
// matches the JSON schema in CREATE_TOUR_JSON_SYSTEM_PROMPT.
type AIActivity struct {
	ActivityID       string  `json:"activityId"`
	ActivityName     string  `json:"activityName"`
	Type             string  `json:"type"`
	DayNumber        int     `json:"dayNumber"`
	StartTime        string  `json:"startTime"`
	Duration         float64 `json:"duration"`
	TravelTimeToNext float64 `json:"travelTimeToNext"`
	DistanceToNext   float64 `json:"distanceToNext"`
	Notes            string  `json:"notes"`
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
}

func (a AIActivity) Coords() Coordinates {
	return Coordinates{Latitude: a.Latitude, Longitude: a.Longitude}
}

// TourActivityInput mirrors CreateTourActivityDto
// (be/src/modules/tours/dto/create-tour.dto.ts).
type TourActivityInput struct {
	ActivityID        *string         `json:"activityId,omitempty"`
	ActivityName      *string         `json:"activityName,omitempty"`
	ActivityType      *string         `json:"activityType,omitempty"`
	ActivityLatitude  *float64        `json:"activityLatitude,omitempty"`
	ActivityLongitude *float64        `json:"activityLongitude,omitempty"`
	ActivityData      json.RawMessage `json:"activityData,omitempty"`
	Duration          *float64        `json:"duration,omitempty"`
	StartTime         *time.Time      `json:"startTime,omitempty"`
	Notes             *string         `json:"notes,omitempty"`
	DayNumber         *int            `json:"dayNumber,omitempty"`
	TravelTimeToNext  *float64        `json:"travelTimeToNext,omitempty"`
	DistanceToNext    *float64        `json:"distanceToNext,omitempty"`
	Order             int             `json:"order,omitempty"`
}

var timePattern = regexp.MustCompile(`^\d{1,2}:\d{2}(:\d{2})?$`)

// ParseStartTime ports parseStartTime (utils/activity-transformer.util.ts):
// a bare "HH:MM"-style time string is intentionally NOT resolvable to a
// real Date (there's no base date to combine it with here), so it's kept
// only in ActivityData's raw JSON, not the typed StartTime field. Anything
// else is parsed as an ISO date.
func ParseStartTime(raw string) *time.Time {
	if raw == "" {
		return nil
	}
	if timePattern.MatchString(raw) {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t
	}
	return nil
}

// TransformAiActivitiesToDto ports transformAiActivitiesToDto.
func TransformAiActivitiesToDto(aiActivities []AIActivity, startIndex int) []TourActivityInput {
	out := make([]TourActivityInput, len(aiActivities))
	for i, act := range aiActivities {
		var activityID *string
		if act.ActivityID != "" {
			id := act.ActivityID
			activityID = &id
		}

		name := act.ActivityName
		if name == "" {
			name = act.Type
		}
		if name == "" {
			name = "Activity"
		}

		input := TourActivityInput{
			ActivityName:      &name,
			ActivityType:      strPtrIfSet(act.Type),
			ActivityLatitude:  &act.Latitude,
			ActivityLongitude: &act.Longitude,
			Duration:          &act.Duration,
			StartTime:         ParseStartTime(act.StartTime),
			Notes:             strPtrIfSet(act.Notes),
			DayNumber:         intPtrIfSet(act.DayNumber),
			TravelTimeToNext:  &act.TravelTimeToNext,
			DistanceToNext:    &act.DistanceToNext,
			Order:             startIndex + i + 1,
		}

		if activityID != nil {
			input.ActivityID = activityID
		} else {
			// Store full activity data if activityId is not valid or not provided.
			data, _ := json.Marshal(map[string]any{
				"name": name, "type": act.Type, "latitude": act.Latitude, "longitude": act.Longitude,
				"startTime": act.StartTime, "notes": act.Notes, "dayNumber": act.DayNumber,
			})
			input.ActivityData = data
		}

		out[i] = input
	}
	return out
}

func strPtrIfSet(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func intPtrIfSet(i int) *int {
	if i == 0 {
		return nil
	}
	return &i
}

// newTourActivityID mirrors Prisma's @default(uuid()) on TourActivity.id.
func newTourActivityID() string {
	return uuid.NewString()
}
