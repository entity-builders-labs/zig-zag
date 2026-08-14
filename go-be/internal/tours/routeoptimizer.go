package tours

import "math"

// GeoPoint is anything with coordinates — the constraint OptimizeActivityOrder needs.
type GeoPoint interface {
	Coords() Coordinates
}

// OptimizeActivityOrder ports optimizeActivityOrder (utils/route-optimizer.util.ts):
// reorders stops into a short walking route using nearest-neighbor
// construction followed by 2-opt local search over straight-line
// (haversine) distance. Not real routing (no streets, one-way
// restrictions, or rivers) — an approximation that reliably stops the AI's
// picks from zigzagging across the search area, needs no API key, has no
// rate limit, and costs nothing.
func OptimizeActivityOrder[T GeoPoint](origin Coordinates, points []T) []T {
	if len(points) <= 1 {
		return points
	}

	order := buildNearestNeighborOrder(origin, points)
	order = improveWithTwoOpt(origin, points, order)

	result := make([]T, len(order))
	for i, idx := range order {
		result[i] = points[idx]
	}
	return result
}

func buildNearestNeighborOrder[T GeoPoint](origin Coordinates, points []T) []int {
	remaining := make(map[int]bool, len(points))
	for i := range points {
		remaining[i] = true
	}

	order := make([]int, 0, len(points))
	current := origin

	for len(remaining) > 0 {
		nearestIndex := -1
		nearestDistance := math.Inf(1)

		for i := range remaining {
			d := CalculateDistance(current, points[i].Coords())
			if d < nearestDistance {
				nearestDistance = d
				nearestIndex = i
			}
		}

		order = append(order, nearestIndex)
		delete(remaining, nearestIndex)
		current = points[nearestIndex].Coords()
	}

	return order
}

// routeLength is the total length of origin -> points[order[0]] -> ... ->
// points[order[last]] (an open path, no return leg to origin).
func routeLength[T GeoPoint](origin Coordinates, points []T, order []int) float64 {
	total := 0.0
	prev := origin
	for _, i := range order {
		total += CalculateDistance(prev, points[i].Coords())
		prev = points[i].Coords()
	}
	return total
}

// improveWithTwoOpt repeatedly reverses segments when doing so shortens the
// route, until no improving swap remains.
func improveWithTwoOpt[T GeoPoint](origin Coordinates, points []T, initialOrder []int) []int {
	order := initialOrder
	improved := true

	for improved {
		improved = false
		for i := 0; i < len(order)-1; i++ {
			for j := i + 1; j < len(order); j++ {
				candidate := reverseSegment(order, i, j)
				if routeLength(origin, points, candidate) < routeLength(origin, points, order) {
					order = candidate
					improved = true
				}
			}
		}
	}

	return order
}

func reverseSegment(order []int, i, j int) []int {
	out := make([]int, 0, len(order))
	out = append(out, order[:i]...)
	for k := j; k >= i; k-- {
		out = append(out, order[k])
	}
	out = append(out, order[j+1:]...)
	return out
}
