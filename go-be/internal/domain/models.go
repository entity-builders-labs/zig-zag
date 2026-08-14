// Package domain holds structs mirroring be/prisma/schema.prisma's models.
// These are the shared vocabulary every other package's interfaces are
// expressed in terms of — no package should invent its own parallel shape
// for an Activity, Tour, etc.
package domain

import (
	"encoding/json"
	"time"
)

// User mirrors the Prisma `User` model.
type User struct {
	ID               string
	Email            string
	Name             *string
	AvatarURL        *string
	Provider         AuthProvider
	ProviderID       string
	RefreshTokenHash *string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Activity mirrors the Prisma `Activity` model. Embedding is intentionally
// not a field here — it's written/read via raw SQL in internal/ai's vector
// store code (pgvector-go), the same way VectorStoreService bypasses
// Prisma's client for it on the Nest side.
type Activity struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description"`

	Type         *string     `json:"type"`
	Difficulty   *Difficulty `json:"difficulty"`
	Duration     *float64    `json:"duration"`
	Price        *float64    `json:"price"`
	MaxGroupSize *int        `json:"maxGroupSize"`

	Latitude  *float64        `json:"latitude"`
	Longitude *float64        `json:"longitude"`
	Location  json.RawMessage `json:"location"`
	Address   *string         `json:"address"`

	SourceID   *string `json:"sourceId"`
	ExternalID *string `json:"externalId"`

	Rating           *float64        `json:"rating"`
	RatingCount      *int            `json:"ratingCount"`
	FormattedAddress *string         `json:"formattedAddress"`
	PhoneNumber      *string         `json:"phoneNumber"`
	Website          *string         `json:"website"`
	BusinessStatus   *string         `json:"businessStatus"`
	PriceLevel       *int            `json:"priceLevel"`
	Photos           json.RawMessage `json:"photos"`
	OpeningHours     json.RawMessage `json:"openingHours"`

	Metadata json.RawMessage `json:"metadata"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	KnownActivityTypeName *string `json:"knownActivityTypeName"`
}

// Tour mirrors the Prisma `Tour` model.
type Tour struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description"`

	OwnerID *string `json:"ownerId"`

	Price                *float64    `json:"price"`
	Duration             *float64    `json:"duration"`
	MaxGroupSize         *int        `json:"maxGroupSize"`
	StartDates           []time.Time `json:"startDates"`
	TotalDays            *int        `json:"totalDays"`
	TotalDistance        *float64    `json:"totalDistance"`
	EstimatedBudget      *float64    `json:"estimatedBudget"`
	RecommendedGroupSize *int        `json:"recommendedGroupSize"`

	CoverImage *string `json:"coverImage"`

	Prompt *string `json:"prompt"`
	Query  *string `json:"query"`

	Categories []string `json:"categories"`

	// Metadata carries, among other things, generationStatus/generationError
	// for background tour generation — the frontend's only progress signal
	// (fe/app/tours/[id].tsx polls GET /tours/:id and reads this). Any code
	// writing Tour.Metadata during generation must preserve that shape exactly.
	Metadata json.RawMessage `json:"metadata"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	Activities []TourActivity `json:"activities,omitempty"`
}

// TourActivity mirrors the Prisma `TourActivity` join model.
type TourActivity struct {
	ID               string     `json:"id"`
	TourID           string     `json:"tourId"`
	ActivityID       *string    `json:"activityId"`
	StartTime        *time.Time `json:"startTime"`
	Duration         *float64   `json:"duration"`
	Notes            *string    `json:"notes"`
	DayNumber        *int       `json:"dayNumber"`
	TravelTimeToNext *float64   `json:"travelTimeToNext"`
	DistanceToNext   *float64   `json:"distanceToNext"`
	Order            int        `json:"order"`

	ActivityName      *string         `json:"activityName"`
	ActivityType      *string         `json:"activityType"`
	ActivityLatitude  *float64        `json:"activityLatitude"`
	ActivityLongitude *float64        `json:"activityLongitude"`
	ActivityData      json.RawMessage `json:"activityData"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	// Activity is the joined Activity row when ActivityID references a real
	// one — mirrors Prisma's `include: { activity: true }` on TourActivity.
	Activity *Activity `json:"activity,omitempty"`
}

// CrawlerSearch mirrors the Prisma `CrawlerSearch` model — dedup tracking
// for the Google Places crawler (the 24h-stale check in search-hybrid).
type CrawlerSearch struct {
	ID          string
	Latitude    float64
	Longitude   float64
	DeviceToken *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Source mirrors the Prisma `Source` model.
type Source struct {
	ID        string
	Name      string
	Type      string // "external" | "ai" | "manual"
	BaseURL   *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// KnownActivityType mirrors the Prisma `KnownActivityType` model.
type KnownActivityType struct {
	ID          string
	Name        string
	Description *string
	Icon        *string
	Category    *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ActivityRelationship mirrors the Prisma `ActivityRelationship` model —
// pairwise compatibility scoring between two activities.
type ActivityRelationship struct {
	ID                     string
	SourceActivityID       string
	TargetActivityID       string
	RelationType           RelationType
	CompatibilityScore     int
	TimeCompatibilityScore int
	DistanceScore          int
	VarietyScore           int
	TimeGapRecommended     *int
	Reasoning              *string
	Metadata               json.RawMessage
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// EmailLoginCode mirrors the Prisma `EmailLoginCode` model — OTP codes for
// passwordless email login.
type EmailLoginCode struct {
	ID         string
	Email      string
	CodeHash   string
	ExpiresAt  time.Time
	Attempts   int
	ConsumedAt *time.Time
	CreatedAt  time.Time
}
