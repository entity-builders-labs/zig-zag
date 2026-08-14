// Package activities ports be/src/modules/activities: CRUD, proximity
// search with weighted-rating scoring, pgvector similarity, AI metadata
// enrichment, and the search-hybrid (background-crawl-triggering) flow.
package activities

import (
	"encoding/json"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
)

// ActivityInput mirrors CreateActivityDto / UpdateActivityDto (the latter
// is CreateActivityDto with every field optional in Nest via PartialType).
// All fields are pointers/nil-able slices so a JSON PATCH body can
// distinguish "not provided" (nil) from "provided" — used as-is for
// create (Name required) and, after merging onto an existing row, for update.
type ActivityInput struct {
	Name                  *string
	Description           *string
	Type                  *string
	Difficulty            *domain.Difficulty
	Duration              *float64
	Price                 *float64
	MaxGroupSize          *int
	Latitude              *float64
	Longitude             *float64
	Address               *string
	Location              json.RawMessage
	SourceID              *string
	ExternalID            *string
	Rating                *float64
	RatingCount           *int
	FormattedAddress      *string
	PhoneNumber           *string
	Website               *string
	BusinessStatus        *string
	PriceLevel            *int
	Photos                []string
	OpeningHours          json.RawMessage
	KnownActivityTypeName *string
	Metadata              json.RawMessage
}

// ActivityWithDistance mirrors ActivityWithDistance (interfaces/activity.interface.ts).
type ActivityWithDistance struct {
	domain.Activity
	Distance      float64  `json:"distance"`
	WeightedScore *float64 `json:"weightedScore,omitempty"`
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

// mergeActivity builds UpdateActivity params from an existing row, applying
// only the fields present (non-nil / non-empty) in input — matching
// Prisma's `update({data: updateActivityDto})`, which only touches keys
// actually present in the DTO.
func mergeActivity(existing sqlcgen.Activity, input ActivityInput) sqlcgen.UpdateActivityParams {
	p := sqlcgen.UpdateActivityParams{
		ID: existing.ID, Name: existing.Name, Description: existing.Description,
		Type: existing.Type, Difficulty: existing.Difficulty, Duration: existing.Duration, Price: existing.Price,
		MaxGroupSize: existing.MaxGroupSize, Latitude: existing.Latitude, Longitude: existing.Longitude,
		Location: existing.Location, Address: existing.Address, SourceId: existing.SourceId, ExternalId: existing.ExternalId,
		Rating: existing.Rating, RatingCount: existing.RatingCount, FormattedAddress: existing.FormattedAddress,
		PhoneNumber: existing.PhoneNumber, Website: existing.Website, BusinessStatus: existing.BusinessStatus,
		PriceLevel: existing.PriceLevel, Photos: existing.Photos, OpeningHours: existing.OpeningHours,
		Metadata: existing.Metadata, KnownActivityTypeName: existing.KnownActivityTypeName,
	}

	if input.Name != nil {
		p.Name = *input.Name
	}
	if input.Description != nil {
		p.Description = input.Description
	}
	if input.Type != nil {
		p.Type = input.Type
	}
	if input.Difficulty != nil {
		p.Difficulty = (*sqlcgen.Difficulty)(input.Difficulty)
	}
	if input.Duration != nil {
		p.Duration = input.Duration
	}
	if input.Price != nil {
		p.Price = input.Price
	}
	if input.MaxGroupSize != nil {
		p.MaxGroupSize = int32Ptr(input.MaxGroupSize)
	}
	if input.Latitude != nil {
		p.Latitude = input.Latitude
	}
	if input.Longitude != nil {
		p.Longitude = input.Longitude
	}
	if input.Location != nil {
		p.Location = input.Location
	}
	if input.Address != nil {
		p.Address = input.Address
	}
	if input.SourceID != nil {
		p.SourceId = input.SourceID
	}
	if input.ExternalID != nil {
		p.ExternalId = input.ExternalID
	}
	if input.Rating != nil {
		p.Rating = input.Rating
	}
	if input.RatingCount != nil {
		p.RatingCount = int32Ptr(input.RatingCount)
	}
	if input.FormattedAddress != nil {
		p.FormattedAddress = input.FormattedAddress
	}
	if input.PhoneNumber != nil {
		p.PhoneNumber = input.PhoneNumber
	}
	if input.Website != nil {
		p.Website = input.Website
	}
	if input.BusinessStatus != nil {
		p.BusinessStatus = input.BusinessStatus
	}
	if input.PriceLevel != nil {
		p.PriceLevel = int32Ptr(input.PriceLevel)
	}
	if input.Photos != nil {
		b, _ := json.Marshal(input.Photos)
		p.Photos = b
	}
	if input.OpeningHours != nil {
		p.OpeningHours = input.OpeningHours
	}
	if input.KnownActivityTypeName != nil {
		p.KnownActivityTypeName = input.KnownActivityTypeName
	}
	if input.Metadata != nil {
		p.Metadata = input.Metadata
	}

	return p
}

func toDomainActivity(a sqlcgen.Activity) domain.Activity {
	return domain.Activity{
		ID: a.ID, Name: a.Name, Description: a.Description,
		Type: a.Type, Difficulty: (*domain.Difficulty)(a.Difficulty), Duration: a.Duration, Price: a.Price, MaxGroupSize: intPtr(a.MaxGroupSize),
		Latitude: a.Latitude, Longitude: a.Longitude, Location: a.Location, Address: a.Address,
		SourceID: a.SourceId, ExternalID: a.ExternalId,
		Rating: a.Rating, RatingCount: intPtr(a.RatingCount), FormattedAddress: a.FormattedAddress, PhoneNumber: a.PhoneNumber,
		Website: a.Website, BusinessStatus: a.BusinessStatus, PriceLevel: intPtr(a.PriceLevel), Photos: a.Photos, OpeningHours: a.OpeningHours,
		Metadata: a.Metadata, CreatedAt: a.CreatedAt.Time, UpdatedAt: a.UpdatedAt.Time, KnownActivityTypeName: a.KnownActivityTypeName,
	}
}
