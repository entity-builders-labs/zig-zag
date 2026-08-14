// Package tours ports be/src/modules/tours: CRUD, the wizard tour-creation
// flow, AI-driven activity generation (the highest-orchestration-risk piece
// in the whole migration), route optimization, and nearby-tour lookup.
package tours

import "math"

// Coordinates mirrors Coordinates (be/src/shared/utils/distance.utils.ts).
type Coordinates struct {
	Latitude  float64
	Longitude float64
}

const earthRadiusKM = 6371.0

// CalculateDistance ports calculateDistance (shared/utils/distance.utils.ts) —
// the Haversine formula. Kept as its own copy here rather than sharing
// activities' internal haversineKM: the original TS has two separate
// implementations of the same formula too (shared/utils/distance.utils.ts
// vs ActivitiesService's private calculateDistance), so duplicating here
// matches the source structure rather than deviating from it.
func CalculateDistance(p1, p2 Coordinates) float64 {
	lat1, lon1 := toRadians(p1.Latitude), toRadians(p1.Longitude)
	lat2, lon2 := toRadians(p2.Latitude), toRadians(p2.Longitude)

	dLat := lat2 - lat1
	dLon := lon2 - lon1

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusKM * c
}

func toRadians(degrees float64) float64 { return degrees * math.Pi / 180 }
