package tours

import (
	"math"
	"sort"
)

// Walking-time constants, matching travel-time-calculator.util.ts exactly.
const (
	minutesPerKilometer  = 12  // 5 km/h standard walking speed
	maxWalkingDistanceKM = 2.0 // beyond this, alternative transportation is assumed
)

// activityEntityCoords is the narrow subset of a fetched Activity row
// needed for travel-time lookups (mirrors the `Activity` param in
// getActivityCoordinates, when a real activityId is known).
type activityEntityCoords struct {
	Latitude, Longitude *float64
}

// getActivityCoordinates ports getActivityCoordinates: prefers the linked
// Activity entity's coordinates, falling back to the input's own inline
// latitude/longitude.
func getActivityCoordinates(input TourActivityInput, entity *activityEntityCoords) (Coordinates, bool) {
	if entity != nil && entity.Latitude != nil && entity.Longitude != nil {
		return Coordinates{Latitude: *entity.Latitude, Longitude: *entity.Longitude}, true
	}
	if input.ActivityLatitude != nil && input.ActivityLongitude != nil {
		return Coordinates{Latitude: *input.ActivityLatitude, Longitude: *input.ActivityLongitude}, true
	}
	return Coordinates{}, false
}

func calculateWalkingTime(distanceKM float64) int {
	if distanceKM <= 0 {
		return 0
	}
	return int(math.Round(distanceKM * minutesPerKilometer))
}

// calculateTravelBetweenActivities ports calculateTravelBetweenActivities.
// Returns ok=false if coordinates are unavailable for either activity, or
// the distance exceeds maxWalkingDistanceKM (alternative transportation
// should be used, so no walking time is suggested).
func calculateTravelBetweenActivities(a, b TourActivityInput, aEntity, bEntity *activityEntityCoords) (distanceKM float64, walkingMinutes int, ok bool) {
	coordsA, okA := getActivityCoordinates(a, aEntity)
	coordsB, okB := getActivityCoordinates(b, bEntity)
	if !okA || !okB {
		return 0, 0, false
	}

	distance := CalculateDistance(coordsA, coordsB)
	if distance > maxWalkingDistanceKM {
		return 0, 0, false
	}

	rounded := math.Round(distance*100) / 100
	return rounded, calculateWalkingTime(distance), true
}

// UpdateTravelTimesForActivities ports updateTravelTimesForActivities:
// only calculates travel time/distance between CONSECUTIVE activities on
// the SAME day (sorted by dayNumber then order); the last activity of each
// day gets no travelTimeToNext/distanceToNext.
func UpdateTravelTimesForActivities(activities []TourActivityInput, entitiesByID map[string]activityEntityCoords) []TourActivityInput {
	if len(activities) <= 1 {
		return activities
	}

	sorted := make([]TourActivityInput, len(activities))
	copy(sorted, activities)
	sort.SliceStable(sorted, func(i, j int) bool {
		di, dj := derefIntOr0(sorted[i].DayNumber), derefIntOr0(sorted[j].DayNumber)
		if di != dj {
			return di < dj
		}
		return sorted[i].Order < sorted[j].Order
	})

	for i := range sorted {
		if i == len(sorted)-1 {
			sorted[i].TravelTimeToNext = nil
			sorted[i].DistanceToNext = nil
			continue
		}

		next := sorted[i+1]
		if derefIntOr0(sorted[i].DayNumber) != derefIntOr0(next.DayNumber) {
			sorted[i].TravelTimeToNext = nil
			sorted[i].DistanceToNext = nil
			continue
		}

		var aEntity, bEntity *activityEntityCoords
		if sorted[i].ActivityID != nil {
			if e, ok := entitiesByID[*sorted[i].ActivityID]; ok {
				aEntity = &e
			}
		}
		if next.ActivityID != nil {
			if e, ok := entitiesByID[*next.ActivityID]; ok {
				bEntity = &e
			}
		}

		if distance, minutes, ok := calculateTravelBetweenActivities(sorted[i], next, aEntity, bEntity); ok {
			d, m := distance, float64(minutes)
			sorted[i].DistanceToNext = &d
			sorted[i].TravelTimeToNext = &m
		}
	}

	return sorted
}

func derefIntOr0(i *int) int {
	if i == nil {
		return 0
	}
	return *i
}
