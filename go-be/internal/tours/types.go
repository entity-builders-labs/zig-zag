package tours

import (
	"encoding/json"
	"time"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
)

// TourInput mirrors CreateTourDto (be/src/modules/tours/dto/create-tour.dto.ts).
type TourInput struct {
	OwnerID              *string             `json:"ownerId,omitempty"`
	Name                 string              `json:"name"`
	Description          *string             `json:"description,omitempty"`
	Price                *float64            `json:"price,omitempty"`
	Duration             *float64            `json:"duration,omitempty"`
	MaxGroupSize         *int                `json:"maxGroupSize,omitempty"`
	StartDates           []time.Time         `json:"startDates,omitempty"`
	TotalDays            *int                `json:"totalDays,omitempty"`
	TotalDistance        *float64            `json:"totalDistance,omitempty"`
	EstimatedBudget      *float64            `json:"estimatedBudget,omitempty"`
	RecommendedGroupSize *int                `json:"recommendedGroupSize,omitempty"`
	Prompt               *string             `json:"prompt,omitempty"`
	Query                *string             `json:"query,omitempty"`
	Categories           []string            `json:"categories,omitempty"`
	Metadata             json.RawMessage     `json:"metadata,omitempty"`
	Activities           []TourActivityInput `json:"activities,omitempty"`
}

func int32Ptr(i *int) *int32 {
	if i == nil {
		return nil
	}
	v := int32(*i)
	return &v
}

func intPtr(i *int32) *int {
	if i == nil {
		return nil
	}
	v := int(*i)
	return &v
}

func pgTimestamps(times []time.Time) []pgtypeTimestamp {
	out := make([]pgtypeTimestamp, len(times))
	for i, t := range times {
		out[i] = toPgTimestamp(t)
	}
	return out
}

func toDomainTour(t sqlcgen.Tour) domain.Tour {
	return domain.Tour{
		ID: t.ID, Name: t.Name, Description: t.Description, OwnerID: t.OwnerId,
		Price: t.Price, Duration: t.Duration, MaxGroupSize: intPtr(t.MaxGroupSize),
		StartDates: fromPgTimestamps(t.StartDates), TotalDays: intPtr(t.TotalDays),
		TotalDistance: t.TotalDistance, EstimatedBudget: t.EstimatedBudget,
		RecommendedGroupSize: intPtr(t.RecommendedGroupSize), CoverImage: t.CoverImage,
		Prompt: t.Prompt, Query: t.Query, Categories: t.Categories, Metadata: t.Metadata,
		CreatedAt: t.CreatedAt.Time, UpdatedAt: t.UpdatedAt.Time,
	}
}

func toDomainTourActivity(a sqlcgen.TourActivity) domain.TourActivity {
	da := domain.TourActivity{
		ID: a.ID, TourID: a.TourId, ActivityID: a.ActivityId, Duration: a.Duration,
		Notes: a.Notes, DayNumber: intPtr(a.DayNumber), TravelTimeToNext: a.TravelTimeToNext,
		DistanceToNext: a.DistanceToNext, Order: int(a.Order), ActivityName: a.ActivityName,
		ActivityType: a.ActivityType, ActivityLatitude: a.ActivityLatitude, ActivityLongitude: a.ActivityLongitude,
		ActivityData: a.ActivityData, CreatedAt: a.CreatedAt.Time, UpdatedAt: a.UpdatedAt.Time,
	}
	if a.StartTime.Valid {
		st := a.StartTime.Time
		da.StartTime = &st
	}
	return da
}
