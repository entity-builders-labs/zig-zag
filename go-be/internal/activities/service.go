package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/google/uuid"
	"github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
	"github.com/juanobrach/zig-zag/go-be/internal/places"
)

// Querier is the narrow slice of sqlcgen.Queries Service needs.
type Querier interface {
	GetActivity(ctx context.Context, id string) (sqlcgen.Activity, error)
	GetActivityBySourceExternalID(ctx context.Context, arg sqlcgen.GetActivityBySourceExternalIDParams) (sqlcgen.Activity, error)
	FindActivitiesInBoundingBox(ctx context.Context, arg sqlcgen.FindActivitiesInBoundingBoxParams) ([]sqlcgen.Activity, error)
	CreateActivity(ctx context.Context, arg sqlcgen.CreateActivityParams) (sqlcgen.Activity, error)
	UpdateActivity(ctx context.Context, arg sqlcgen.UpdateActivityParams) (sqlcgen.Activity, error)
	DeleteActivity(ctx context.Context, id string) (sqlcgen.Activity, error)
	GetActivitiesByIDs(ctx context.Context, ids []string) ([]sqlcgen.Activity, error)
}

// VectorFinder is the narrow slice of ai.VectorStore's surface Service needs.
type VectorFinder interface {
	FindSimilarActivities(ctx context.Context, prompt string, k int) ([]ai.SimilarActivityResult, error)
}

// Weighted-rating and distance constants, matching ActivitiesService exactly.
const (
	priorMean              = 4.0
	priorWeight            = 50.0
	earthRadiusKM          = 6371.0
	degreesPerKM           = 111.32
	scoreComparisonEpsilon = 1e-9
	metersToKMThreshold    = 100.0
)

var (
	ErrActivityNotFound   = errors.New("activity not found")
	ErrInvalidCoordinates = errors.New("invalid latitude or longitude values")
)

type Service struct {
	db       Querier
	metadata *MetadataService
	vectors  VectorFinder
}

func NewService(db Querier, metadata *MetadataService, vectors VectorFinder) *Service {
	return &Service{db: db, metadata: metadata, vectors: vectors}
}

// Create ports ActivitiesService.create: a fast-path duplicate check when
// both sourceId+externalId are set, AI metadata generation when none is
// provided, and a best-effort cover image (a no-op in practice — see
// MetadataService.GenerateImage's bypass=true).
func (s *Service) Create(ctx context.Context, input ActivityInput) (domain.Activity, error) {
	if input.SourceID != nil && input.ExternalID != nil {
		existing, err := s.db.GetActivityBySourceExternalID(ctx, sqlcgen.GetActivityBySourceExternalIDParams{
			SourceId: input.SourceID, ExternalId: input.ExternalID,
		})
		if err == nil {
			return toDomainActivity(existing), nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return domain.Activity{}, fmt.Errorf("check existing activity: %w", err)
		}
	}

	metadata := input.Metadata
	description := input.Description

	if len(metadata) == 0 && input.Name != nil && *input.Name != "" && s.metadata != nil {
		generated, err := s.metadata.GenerateMetadata(ctx, ActivityInfo{
			Name:         *input.Name,
			Description:  derefString(description),
			Type:         derefString(input.Type),
			Difficulty:   string(derefDifficulty(input.Difficulty)),
			LocationText: string(input.Location),
			Price:        input.Price,
			Duration:     input.Duration,
		})
		if err == nil {
			if b, err := json.Marshal(generated); err == nil {
				metadata = b
			}
			if enhanced, ok := generated["enhancedDescription"].(string); ok && enhanced != "" && description == nil {
				description = &enhanced
			}
		}
	}

	photos := input.Photos
	if len(photos) == 0 && input.Name != nil && *input.Name != "" && s.metadata != nil {
		if url := s.metadata.GenerateImage(ctx, *input.Name, derefString(input.Type), derefString(description)); url != "" {
			photos = []string{url}
		}
	}

	name := derefString(input.Name)
	photosJSON, _ := json.Marshal(photos)
	if len(photos) == 0 {
		photosJSON = nil
	}

	created, err := s.db.CreateActivity(ctx, sqlcgen.CreateActivityParams{
		ID: uuid.NewString(), Name: name, Description: description,
		Type: input.Type, Difficulty: (*sqlcgen.Difficulty)(input.Difficulty), Duration: input.Duration, Price: input.Price,
		MaxGroupSize: int32Ptr(input.MaxGroupSize), Latitude: input.Latitude, Longitude: input.Longitude,
		Location: input.Location, Address: input.Address, SourceId: input.SourceID, ExternalId: input.ExternalID,
		Rating: input.Rating, RatingCount: int32Ptr(input.RatingCount), FormattedAddress: input.FormattedAddress,
		PhoneNumber: input.PhoneNumber, Website: input.Website, BusinessStatus: input.BusinessStatus,
		PriceLevel: int32Ptr(input.PriceLevel), Photos: photosJSON, OpeningHours: input.OpeningHours,
		Metadata: metadata, KnownActivityTypeName: input.KnownActivityTypeName,
	})
	if err != nil {
		if isConstraintViolation(err) {
			return domain.Activity{}, fmt.Errorf("%w: %s", errBadActivityInput, err.Error())
		}
		return domain.Activity{}, fmt.Errorf("create activity: %w", err)
	}
	return toDomainActivity(created), nil
}

var errBadActivityInput = errors.New("database error")

// CreateFromDraft adapts a places.ActivityDraft into ActivityInput and
// delegates to Create — satisfying places.ActivityCreator. This is
// deliberately the SAME path the public API uses: crawlAndSaveActivities
// calls this.activitiesService.create(place) in Nest too, not a separate
// method — and since crawled drafts always set Metadata already, the AI
// metadata-generation branch above is a no-op for them, matching Nest exactly.
func (s *Service) CreateFromDraft(ctx context.Context, draft places.ActivityDraft) (string, error) {
	lat, lng := draft.Latitude, draft.Longitude
	var priceLevel *int
	if draft.PriceLevel != nil {
		priceLevel = draft.PriceLevel
	}
	maxGroupSize := draft.MaxGroupSize

	created, err := s.Create(ctx, ActivityInput{
		Name: &draft.Name, Description: strPtrOrNil(draft.Description), Type: strPtrOrNil(draft.Type),
		Duration: &draft.Duration, Price: &draft.Price, MaxGroupSize: &maxGroupSize,
		Latitude: &lat, Longitude: &lng, Location: draft.Location,
		SourceID: strPtrOrNil(draft.SourceID), ExternalID: strPtrOrNil(draft.ExternalID),
		Rating: draft.Rating, RatingCount: draft.RatingCount, FormattedAddress: strPtrOrNil(draft.FormattedAddress),
		PhoneNumber: strPtrOrNil(draft.PhoneNumber), Website: strPtrOrNil(draft.Website), PriceLevel: priceLevel,
		OpeningHours: draft.OpeningHours, KnownActivityTypeName: strPtrOrNil(draft.KnownActivityTypeName),
		Metadata: draft.Metadata,
	})
	if err != nil {
		return "", err
	}
	return created.ID, nil
}

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// FindAll ports ActivitiesService.findAll: bounding-box query, then
// in-memory Haversine distance + weighted-rating scoring/sort — matches
// the original's "no `take` in the DB query" comment: truncating early
// would drop candidates the scoring hasn't ranked yet.
func (s *Service) FindAll(ctx context.Context, latitude, longitude string, radiusMeters float64, limit int, types []string) ([]ActivityWithDistance, error) {
	lat, err := parseCoordinate(latitude)
	if err != nil {
		return nil, ErrInvalidCoordinates
	}
	lng, err := parseCoordinate(longitude)
	if err != nil {
		return nil, ErrInvalidCoordinates
	}

	radiusKM := radiusMeters / 1000
	radiusDeg := radiusKM / degreesPerKM

	rows, err := s.db.FindActivitiesInBoundingBox(ctx, sqlcgen.FindActivitiesInBoundingBoxParams{
		Latitude:    ptr(lat - radiusDeg),
		Latitude_2:  ptr(lat + radiusDeg),
		Longitude:   ptr(lng - radiusDeg),
		Longitude_2: ptr(lng + radiusDeg),
	})
	if err != nil {
		return nil, fmt.Errorf("find activities: %w", err)
	}

	lowerTypes := make(map[string]bool, len(types))
	for _, t := range types {
		lowerTypes[strings.ToLower(t)] = true
	}

	results := make([]ActivityWithDistance, 0, len(rows))
	for _, row := range rows {
		if len(lowerTypes) > 0 {
			if row.KnownActivityTypeName == nil || !lowerTypes[strings.ToLower(*row.KnownActivityTypeName)] {
				continue
			}
		}

		a := toDomainActivity(row)
		if a.Latitude == nil || a.Longitude == nil {
			continue
		}
		distance := haversineKM(lat, lng, *a.Latitude, *a.Longitude)
		if distance > radiusKM {
			continue
		}

		score := weightedScore(derefFloat(a.Rating), float64(derefInt(a.RatingCount)))
		results = append(results, ActivityWithDistance{Activity: a, Distance: distance, WeightedScore: &score})
	}

	sortByScoreThenDistance(results)
	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

// FindOne ports ActivitiesService.findOne.
func (s *Service) FindOne(ctx context.Context, id string) (domain.Activity, error) {
	row, err := s.db.GetActivity(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Activity{}, ErrActivityNotFound
		}
		return domain.Activity{}, fmt.Errorf("get activity: %w", err)
	}
	return toDomainActivity(row), nil
}

// Update ports ActivitiesService.update: read-modify-write, applying only
// the fields present (non-nil) in input onto the existing row.
func (s *Service) Update(ctx context.Context, id string, input ActivityInput) (domain.Activity, error) {
	existing, err := s.db.GetActivity(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Activity{}, ErrActivityNotFound
		}
		return domain.Activity{}, fmt.Errorf("get activity: %w", err)
	}

	params := mergeActivity(existing, input)
	updated, err := s.db.UpdateActivity(ctx, params)
	if err != nil {
		if isConstraintViolation(err) {
			return domain.Activity{}, fmt.Errorf("%w: %s", errBadActivityInput, err.Error())
		}
		return domain.Activity{}, fmt.Errorf("update activity: %w", err)
	}
	return toDomainActivity(updated), nil
}

// Remove ports ActivitiesService.remove.
func (s *Service) Remove(ctx context.Context, id string) (domain.Activity, error) {
	if _, err := s.FindOne(ctx, id); err != nil {
		return domain.Activity{}, err
	}
	deleted, err := s.db.DeleteActivity(ctx, id)
	if err != nil {
		return domain.Activity{}, fmt.Errorf("delete activity: %w", err)
	}
	return toDomainActivity(deleted), nil
}

// FindNearbyActivities ports findNearbyActivities: a longitude-degrees
// correction by cos(latitude) that FindAll does NOT apply — an
// inconsistency in the original between the two endpoints, kept as-is
// rather than "fixed" to match this port's spirit of faithful translation.
func (s *Service) FindNearbyActivities(ctx context.Context, latitude, longitude, radius float64, limit int) ([]ActivityWithDistance, error) {
	radiusKM := radius
	if radius > metersToKMThreshold {
		radiusKM = radius / 1000
	}
	radiusDeg := radiusKM / degreesPerKM
	lngCorrection := radiusDeg / math.Cos(latitude*math.Pi/180)

	rows, err := s.db.FindActivitiesInBoundingBox(ctx, sqlcgen.FindActivitiesInBoundingBoxParams{
		Latitude: ptr(latitude - radiusDeg), Latitude_2: ptr(latitude + radiusDeg),
		Longitude: ptr(longitude - lngCorrection), Longitude_2: ptr(longitude + lngCorrection),
	})
	if err != nil {
		return nil, fmt.Errorf("find nearby activities: %w", err)
	}

	results := make([]ActivityWithDistance, 0, len(rows))
	for _, row := range rows {
		a := toDomainActivity(row)
		if a.Latitude == nil || a.Longitude == nil {
			continue
		}
		distance := haversineKM(latitude, longitude, *a.Latitude, *a.Longitude)
		if distance > radiusKM {
			continue
		}
		results = append(results, ActivityWithDistance{Activity: a, Distance: distance})
	}

	sortByDistance(results)
	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

// FindSimilar ports findSimilar: rebuild the same rich-text query used at
// embedding time, run a pgvector similarity search, then fetch the
// candidate rows by id preserving similarity order.
func (s *Service) FindSimilar(ctx context.Context, id string, limit int) ([]domain.Activity, error) {
	activity, err := s.FindOne(ctx, id)
	if err != nil {
		return nil, err
	}

	metadataText := "{}"
	if len(activity.Metadata) > 0 {
		metadataText = string(activity.Metadata)
	}
	baseText := fmt.Sprintf("Activity Details:\n%s. %s. Metadata: %s", activity.Name, derefString(activity.Description), metadataText)

	results, err := s.vectors.FindSimilarActivities(ctx, baseText, limit+1)
	if err != nil {
		return nil, fmt.Errorf("find similar activities: %w", err)
	}
	if len(results) == 0 {
		return nil, nil
	}

	candidateIDs := make([]string, 0, limit)
	for _, r := range results {
		candidateID, _ := r.Metadata["activityId"].(string)
		if candidateID == "" {
			candidateID, _ = r.Metadata["id"].(string)
		}
		if candidateID != "" && candidateID != id {
			candidateIDs = append(candidateIDs, candidateID)
		}
		if len(candidateIDs) >= limit {
			break
		}
	}
	if len(candidateIDs) == 0 {
		return nil, nil
	}

	rows, err := s.db.GetActivitiesByIDs(ctx, candidateIDs)
	if err != nil {
		return nil, fmt.Errorf("get activities by ids: %w", err)
	}

	order := make(map[string]int, len(candidateIDs))
	for i, id := range candidateIDs {
		order[id] = i
	}
	activities := make([]domain.Activity, len(rows))
	for i, row := range rows {
		activities[i] = toDomainActivity(row)
	}
	sortByCandidateOrder(activities, order)
	return activities, nil
}

func parseCoordinate(s string) (float64, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(s), ",", ".")
	return strconv.ParseFloat(normalized, 64)
}

func ptr[T any](v T) *T { return &v }

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefFloat(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func derefInt(i *int) int {
	if i == nil {
		return 0
	}
	return *i
}

func derefDifficulty(d *domain.Difficulty) domain.Difficulty {
	if d == nil {
		return ""
	}
	return *d
}

// weightedScore mirrors findAll's Bayesian-average blend of an activity's
// own rating against a prior, weighted by how many ratings it has.
func weightedScore(rating, ratingCount float64) float64 {
	if ratingCount+priorWeight <= 0 {
		return 0
	}
	return (ratingCount/(ratingCount+priorWeight))*rating + (priorWeight/(ratingCount+priorWeight))*priorMean
}

func haversineKM(lat1, lon1, lat2, lon2 float64) float64 {
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKM * c
}

func toRad(deg float64) float64 { return deg * math.Pi / 180 }

func sortByScoreThenDistance(results []ActivityWithDistance) {
	sort.Slice(results, func(i, j int) bool {
		a, b := results[i], results[j]
		as, bs := derefFloat(a.WeightedScore), derefFloat(b.WeightedScore)
		if math.Abs(bs-as) > scoreComparisonEpsilon {
			return bs < as // descending score
		}
		return a.Distance < b.Distance
	})
}

func sortByDistance(results []ActivityWithDistance) {
	sort.Slice(results, func(i, j int) bool { return results[i].Distance < results[j].Distance })
}

func sortByCandidateOrder(activities []domain.Activity, order map[string]int) {
	sort.Slice(activities, func(i, j int) bool { return order[activities[i].ID] < order[activities[j].ID] })
}

func isConstraintViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "23505" || pgErr.Code == "23503")
}
