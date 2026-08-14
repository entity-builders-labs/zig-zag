package tours

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
)

// Querier is the narrow slice of sqlcgen.Queries Service needs for
// non-transactional operations.
type Querier interface {
	GetTour(ctx context.Context, id string) (sqlcgen.Tour, error)
	GetTourOwnerID(ctx context.Context, id string) (*string, error)
	GetTourActivities(ctx context.Context, tourID string) ([]sqlcgen.TourActivity, error)
	CountToursByOwner(ctx context.Context, arg sqlcgen.CountToursByOwnerParams) (int64, error)
	ListToursByOwner(ctx context.Context, arg sqlcgen.ListToursByOwnerParams) ([]sqlcgen.Tour, error)
	ListToursNearCategory(ctx context.Context, arg sqlcgen.ListToursNearCategoryParams) ([]sqlcgen.Tour, error)
	UpdateTourMetadata(ctx context.Context, arg sqlcgen.UpdateTourMetadataParams) error
	UpdateTourCoverImage(ctx context.Context, arg sqlcgen.UpdateTourCoverImageParams) error
	DeleteTour(ctx context.Context, id string) error
}

// Pool is the narrow slice of *pgxpool.Pool Service needs — just enough to
// run the multi-statement create/update flows (tour + its activities) in a
// single transaction. sqlcgen.New accepts any DBTX, including a pgx.Tx, so
// a transactional Querier is built ad hoc as sqlcgen.New(tx) rather than
// needing its own named interface.
type Pool interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

var (
	ErrTourNotFound = errors.New("tour not found")
	ErrForbidden    = errors.New("you do not have access to this tour")
)

// Service ports ToursService (be/src/modules/tours/services/tours.service.ts).
type Service struct {
	db   Querier
	pool Pool
}

func NewService(db Querier, pool Pool) *Service {
	return &Service{db: db, pool: pool}
}

// Create ports ToursService.create.
func (s *Service) Create(ctx context.Context, input TourInput) (domain.Tour, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Tour{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op if already committed

	txDB := sqlcgen.New(tx)

	tour, err := txDB.CreateTour(ctx, sqlcgen.CreateTourParams{
		ID: newTourID(), OwnerId: input.OwnerID, Name: input.Name, Description: input.Description,
		Price: input.Price, Duration: input.Duration, MaxGroupSize: int32Ptr(input.MaxGroupSize),
		StartDates: pgTimestamps(input.StartDates), TotalDays: int32Ptr(input.TotalDays),
		TotalDistance: input.TotalDistance, EstimatedBudget: input.EstimatedBudget,
		RecommendedGroupSize: int32Ptr(input.RecommendedGroupSize), Prompt: input.Prompt,
		Query: input.Query, Categories: input.Categories, Metadata: input.Metadata,
	})
	if err != nil {
		return domain.Tour{}, fmt.Errorf("create tour: %w", err)
	}

	if err := createTourActivities(ctx, txDB, tour.ID, input.Activities); err != nil {
		return domain.Tour{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Tour{}, fmt.Errorf("commit transaction: %w", err)
	}

	result := toDomainTour(tour)
	result.Activities = tourActivityInputsToDomain(input.Activities)
	return result, nil
}

func createTourActivities(ctx context.Context, db *sqlcgen.Queries, tourID string, activities []TourActivityInput) error {
	for i, act := range activities {
		order := act.Order
		if order == 0 {
			order = i + 1
		}
		var startTime pgtypeTimestamp
		if act.StartTime != nil {
			startTime = toPgTimestamp(*act.StartTime)
		}
		if err := db.CreateTourActivity(ctx, sqlcgen.CreateTourActivityParams{
			ID: newTourActivityID(), TourId: tourID, ActivityId: act.ActivityID, ActivityName: act.ActivityName,
			ActivityType: act.ActivityType, ActivityLatitude: act.ActivityLatitude, ActivityLongitude: act.ActivityLongitude,
			ActivityData: act.ActivityData, Duration: act.Duration, StartTime: startTime, Notes: act.Notes,
			DayNumber: int32Ptr(act.DayNumber), TravelTimeToNext: act.TravelTimeToNext, DistanceToNext: act.DistanceToNext,
			Order: int32(order),
		}); err != nil {
			return fmt.Errorf("create tour activity: %w", err)
		}
	}
	return nil
}

func tourActivityInputsToDomain(inputs []TourActivityInput) []domain.TourActivity {
	out := make([]domain.TourActivity, len(inputs))
	for i, in := range inputs {
		out[i] = domain.TourActivity{
			ActivityID: in.ActivityID, ActivityName: in.ActivityName, ActivityType: in.ActivityType,
			ActivityLatitude: in.ActivityLatitude, ActivityLongitude: in.ActivityLongitude, ActivityData: in.ActivityData,
			Duration: in.Duration, StartTime: in.StartTime, Notes: in.Notes, DayNumber: in.DayNumber,
			TravelTimeToNext: in.TravelTimeToNext, DistanceToNext: in.DistanceToNext, Order: in.Order,
		}
	}
	return out
}

type FindAllParams struct {
	OwnerID  string
	Page     int
	Limit    int
	Category *string
}

type FindAllResult struct {
	Tours []domain.Tour `json:"tours"`
	Meta  struct {
		Total      int64 `json:"total"`
		Page       int   `json:"page"`
		Limit      int   `json:"limit"`
		TotalPages int   `json:"totalPages"`
	} `json:"meta"`
}

// FindAll ports ToursService.findAll — tours are always scoped to
// OwnerID, never a client-supplied filter (private per owner).
func (s *Service) FindAll(ctx context.Context, params FindAllParams) (FindAllResult, error) {
	page, limit := params.Page, params.Limit
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}
	skip := (page - 1) * limit

	total, err := s.db.CountToursByOwner(ctx, sqlcgen.CountToursByOwnerParams{OwnerId: &params.OwnerID, Category: params.Category})
	if err != nil {
		return FindAllResult{}, fmt.Errorf("count tours: %w", err)
	}

	rows, err := s.db.ListToursByOwner(ctx, sqlcgen.ListToursByOwnerParams{
		OwnerId: &params.OwnerID, Limit: int32(limit), Offset: int32(skip), Category: params.Category,
	})
	if err != nil {
		return FindAllResult{}, fmt.Errorf("list tours: %w", err)
	}

	result := FindAllResult{Tours: make([]domain.Tour, len(rows))}
	for i, row := range rows {
		tour, err := s.attachActivities(ctx, toDomainTour(row))
		if err != nil {
			return FindAllResult{}, err
		}
		result.Tours[i] = tour
	}
	result.Meta.Total = total
	result.Meta.Page = page
	result.Meta.Limit = limit
	result.Meta.TotalPages = int((total + int64(limit) - 1) / int64(limit))
	return result, nil
}

// FindOne ports ToursService.findOne. ownerID nil skips the ownership
// check — used by trusted internal callers (background activity
// generation, which runs without an HTTP/user context); the HTTP-facing
// controller always passes it to enforce that tours are private per owner.
func (s *Service) FindOne(ctx context.Context, id string, ownerID *string) (domain.Tour, error) {
	row, err := s.db.GetTour(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Tour{}, ErrTourNotFound
		}
		return domain.Tour{}, fmt.Errorf("get tour: %w", err)
	}

	if ownerID != nil {
		if row.OwnerId == nil || *row.OwnerId != *ownerID {
			return domain.Tour{}, ErrForbidden
		}
	}

	return s.attachActivities(ctx, toDomainTour(row))
}

func (s *Service) attachActivities(ctx context.Context, tour domain.Tour) (domain.Tour, error) {
	rows, err := s.db.GetTourActivities(ctx, tour.ID)
	if err != nil {
		return domain.Tour{}, fmt.Errorf("get tour activities: %w", err)
	}
	tour.Activities = make([]domain.TourActivity, len(rows))
	for i, row := range rows {
		tour.Activities[i] = toDomainTourActivity(row)
	}
	return tour, nil
}

// Update ports ToursService.update: replaces all activities (delete then
// recreate), matching the original's approach exactly.
func (s *Service) Update(ctx context.Context, id string, input TourInput, ownerID string) (domain.Tour, error) {
	existingOwnerID, err := s.db.GetTourOwnerID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Tour{}, ErrTourNotFound
		}
		return domain.Tour{}, fmt.Errorf("get tour owner: %w", err)
	}
	if existingOwnerID == nil || *existingOwnerID != ownerID {
		return domain.Tour{}, ErrForbidden
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Tour{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	txDB := sqlcgen.New(tx)

	if err := txDB.DeleteTourActivities(ctx, id); err != nil {
		return domain.Tour{}, fmt.Errorf("delete existing activities: %w", err)
	}

	updated, err := txDB.UpdateTour(ctx, sqlcgen.UpdateTourParams{
		ID: id, Name: input.Name, Description: input.Description, Price: input.Price, Duration: input.Duration,
		MaxGroupSize: int32Ptr(input.MaxGroupSize), StartDates: pgTimestamps(input.StartDates),
		TotalDays: int32Ptr(input.TotalDays), TotalDistance: input.TotalDistance, EstimatedBudget: input.EstimatedBudget,
		RecommendedGroupSize: int32Ptr(input.RecommendedGroupSize), Prompt: input.Prompt, Query: input.Query,
		Categories: input.Categories, Metadata: input.Metadata,
	})
	if err != nil {
		return domain.Tour{}, fmt.Errorf("update tour: %w", err)
	}

	if err := createTourActivities(ctx, txDB, id, input.Activities); err != nil {
		return domain.Tour{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Tour{}, fmt.Errorf("commit transaction: %w", err)
	}

	result := toDomainTour(updated)
	result.Activities = tourActivityInputsToDomain(input.Activities)
	return result, nil
}

// Remove ports ToursService.remove. TourActivity rows cascade-delete via
// the schema's onDelete: Cascade.
func (s *Service) Remove(ctx context.Context, id string, ownerID string) (domain.Tour, error) {
	tour, err := s.FindOne(ctx, id, &ownerID)
	if err != nil {
		return domain.Tour{}, err
	}
	if err := s.db.DeleteTour(ctx, id); err != nil {
		return domain.Tour{}, fmt.Errorf("delete tour: %w", err)
	}
	return tour, nil
}

// UpdateMetadata reads a tour's current metadata, applies mutate to it,
// and persists the result — the shared primitive both
// updateGenerationStatus and the final completed/failed writes in
// generation.go build on.
func (s *Service) UpdateMetadata(ctx context.Context, tourID string, mutate func(map[string]any)) (domain.Tour, error) {
	tour, err := s.FindOne(ctx, tourID, nil)
	if err != nil {
		return domain.Tour{}, err
	}

	meta := decodeMetadata(tour.Metadata)
	mutate(meta)

	data, err := json.Marshal(meta)
	if err != nil {
		return domain.Tour{}, fmt.Errorf("marshal metadata: %w", err)
	}

	if err := s.db.UpdateTourMetadata(ctx, sqlcgen.UpdateTourMetadataParams{ID: tourID, Metadata: data}); err != nil {
		return domain.Tour{}, fmt.Errorf("update tour metadata: %w", err)
	}
	tour.Metadata = data
	return tour, nil
}

func decodeMetadata(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return map[string]any{}
	}
	return m
}
