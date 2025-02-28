export interface Coordinates {
    latitude: number;
    longitude: number;
}

/**
 * Calculates the distance between two points on Earth using the Haversine formula.
 * @param point1 First point coordinates (latitude, longitude)
 * @param point2 Second point coordinates (latitude, longitude)
 * @returns Distance in kilometers
 */
export function calculateDistance(point1: Coordinates, point2: Coordinates): number {
    // Earth's radius in kilometers
    const EARTH_RADIUS = 6371;

    // Convert latitude and longitude from degrees to radians
    const lat1 = toRadians(point1.latitude);
    const lon1 = toRadians(point1.longitude);
    const lat2 = toRadians(point2.latitude);
    const lon2 = toRadians(point2.longitude);

    // Differences in coordinates
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;

    // Haversine formula
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    // Calculate the distance
    return EARTH_RADIUS * c;
}

/**
 * Converts degrees to radians
 * @param degrees Angle in degrees
 * @returns Angle in radians
 */
function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Calculates a distance score between 0 and 100 based on the distance between two points
 * @param point1 First point coordinates
 * @param point2 Second point coordinates
 * @param maxDistance Maximum distance (in km) at which the score becomes 0
 * @returns Score between 0 and 100
 */
export function calculateDistanceScore(
    point1: Coordinates,
    point2: Coordinates,
    maxDistance: number = 50
): number {
    const distance = calculateDistance(point1, point2);
    
    // If points are the same, return max score
    if (distance === 0) return 100;
    
    // If distance is greater than maxDistance, return 0
    if (distance >= maxDistance) return 0;
    
    // Linear score calculation: 100 - (distance/maxDistance * 100)
    const score = 100 * (1 - (distance / maxDistance));
    
    // Round to nearest integer and ensure it's between 0 and 100
    return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Returns a user-friendly description of the distance
 * @param distance Distance in kilometers
 * @returns Human-readable distance description
 */
export function getDistanceDescription(distance: number): string {
    if (distance < 1) {
        const meters = Math.round(distance * 1000);
        return `${meters} meters`;
    } else if (distance < 10) {
        return `${distance.toFixed(1)} km`;
    } else {
        return `${Math.round(distance)} km`;
    }
}

