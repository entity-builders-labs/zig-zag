package tours

import (
	"context"
	"log/slog"
	"math"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
)

// LocationQuerier is the narrow slice of sqlcgen.Queries LocationService needs.
type LocationQuerier interface {
	ListToursNearCategory(ctx context.Context, arg sqlcgen.ListToursNearCategoryParams) ([]sqlcgen.Tour, error)
}

// LocationService ports TourLocationService.
type LocationService struct {
	db         LocationQuerier
	tours      *Service
	generation *GenerationService
}

func NewLocationService(db LocationQuerier, tours *Service, generation *GenerationService) *LocationService {
	return &LocationService{db: db, tours: tours, generation: generation}
}

// GetNearbyTours ports getNearbyTours: search for existing tours matching
// a category near a location; if fewer than 3 are found, synchronously
// create and generate one more to fill out the list.
//
// Nest's version generates via the separately-implemented (and explicitly
// @deprecated) generateTour method. This port consolidates onto the same
// wizard-based pipeline createTourFromWizard/generateTourActivities use —
// deliberately, not an oversight: generateTour duplicates most of that
// orchestration, is marked for removal in the source, and this endpoint is
// its only remaining caller.
func (s *LocationService) GetNearbyTours(ctx context.Context, latitude, longitude float64, category string, radius *float64) ([]domain.Tour, error) {
	if category == "" {
		category = "walking"
	}
	r := 5000.0
	if radius != nil {
		r = *radius
	}

	latDelta := r / 111000
	lngDelta := r / (111000 * math.Cos(latitude*math.Pi/180))
	namePattern := "%" + category + "%"

	rows, err := s.db.ListToursNearCategory(ctx, sqlcgen.ListToursNearCategoryParams{
		ActivityLatitude: ptrFloat(latitude - latDelta), ActivityLatitude_2: ptrFloat(latitude + latDelta),
		ActivityLongitude: ptrFloat(longitude - lngDelta), ActivityLongitude_2: ptrFloat(longitude + lngDelta),
		Name: namePattern,
	})
	if err != nil {
		return nil, err
	}

	nearbyTours := make([]domain.Tour, 0, len(rows))
	for _, row := range rows {
		tour, err := s.tours.attachActivities(ctx, toDomainTour(row))
		if err != nil {
			return nil, err
		}
		nearbyTours = append(nearbyTours, tour)
	}

	if len(nearbyTours) >= 3 {
		return nearbyTours, nil
	}

	lat, lng := latitude, longitude
	wideRadius := r * 2
	includeExisting := true
	options := GenerateTourOptions{
		Latitude: &lat, Longitude: &lng, Radius: &wideRadius, IncludeExistingActivities: &includeExisting,
		Name: strPtrIfSet("Tour de " + category),
	}

	tour, err := s.generation.createTourStructure(ctx, options)
	if err != nil {
		slog.Error("failed to create nearby tour structure", "error", err)
		return nearbyTours, nil
	}
	generated, err := s.generation.GenerateTourActivities(ctx, tour.ID)
	if err != nil {
		slog.Error("failed to generate nearby tour", "tourId", tour.ID, "error", err)
		return nearbyTours, nil
	}

	return append(nearbyTours, generated), nil
}

func ptrFloat(f float64) *float64 { return &f }
