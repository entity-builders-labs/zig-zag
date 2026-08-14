package main

import (
	"context"
	"encoding/json"

	appactivities "github.com/juanobrach/zig-zag/go-be/internal/activities"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	apptours "github.com/juanobrach/zig-zag/go-be/internal/tours"
)

// activityFinderAdapter bridges activities.Service.FindAll to
// tours.ActivityFinder — tours owns a narrow CandidateActivity shape
// rather than depending on activities.ActivityWithDistance directly, so
// this small conversion lives here in main.go's wiring rather than in
// either domain package.
type activityFinderAdapter struct {
	svc *appactivities.Service
}

func (a activityFinderAdapter) FindAll(ctx context.Context, latitude, longitude string, radiusMeters float64, limit int, types []string) ([]apptours.CandidateActivity, error) {
	rows, err := a.svc.FindAll(ctx, latitude, longitude, radiusMeters, limit, types)
	if err != nil {
		return nil, err
	}

	out := make([]apptours.CandidateActivity, len(rows))
	for i, r := range rows {
		c := apptours.CandidateActivity{ID: r.ID, Name: r.Name, RatingCount: r.RatingCount}
		if r.Type != nil {
			c.Type = *r.Type
		}
		if r.Description != nil {
			c.Description = *r.Description
		}
		if r.Latitude != nil {
			c.Latitude = *r.Latitude
		}
		if r.Longitude != nil {
			c.Longitude = *r.Longitude
		}
		c.Duration = r.Duration
		c.Rating = r.Rating
		c.PriceLevel = r.PriceLevel
		if len(r.OpeningHours) > 0 {
			var oh struct {
				WeekdayText []string `json:"weekdayText"`
			}
			if json.Unmarshal(r.OpeningHours, &oh) == nil {
				c.OpeningHoursWeekdayText = oh.WeekdayText
			}
		}
		out[i] = c
	}
	return out, nil
}

func wireTours(core coreServices, queries *sqlcgen.Queries, pool apptours.Pool) *apptours.Handlers {
	toursSvc := apptours.NewService(queries, pool)
	finder := activityFinderAdapter{svc: core.activities}
	generationSvc := apptours.NewGenerationService(toursSvc, queries, pool, finder, core.places, core.chat, core.image)
	locationSvc := apptours.NewLocationService(queries, toursSvc, generationSvc)

	return apptours.NewHandlers(toursSvc, generationSvc, locationSvc)
}
