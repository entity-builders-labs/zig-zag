// LEGACY: as of PR10, the wizard path (TourActivityGenerationService) no
// longer calls this — travel times come directly from the deterministic
// planning solution. This file survives only because the deprecated
// /tours/nearby chain (tour-generation.service.ts) still calls it. Delete
// this file once that path is retired or migrated (see
// docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md,
// "Legacy utility fate").
import { calculateDistance } from '@shared/utils/distance.utils';
import { CreateTourActivityDto } from '../dto/create-tour.dto';
import { Activity } from '@prisma/client';

/**
 * Interface for activity coordinates
 */
interface ActivityCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Walking speed constant
 * Standard walking speed: 5 km/h = 12 minutes per kilometer
 */
const MINUTES_PER_KILOMETER = 12;

/**
 * Maximum tolerable walking distance between activities
 * If distance exceeds this, walking is not recommended and alternative transportation should be used
 */
const MAX_WALKING_DISTANCE_KM = 2;

/**
 * Get coordinates from an activity DTO
 * Tries to get coordinates from activityId (if activity is provided) or from inline fields
 */
export function getActivityCoordinates(
  activityDto: CreateTourActivityDto,
  activity?: Activity | null,
): ActivityCoordinates | null {
  // First, try to get coordinates from the Activity relation if available
  if (activity && activity.latitude != null && activity.longitude != null) {
    return {
      latitude: activity.latitude,
      longitude: activity.longitude,
    };
  }

  // Otherwise, try to get from inline fields
  if (
    activityDto.activityLatitude != null &&
    activityDto.activityLongitude != null
  ) {
    return {
      latitude: activityDto.activityLatitude,
      longitude: activityDto.activityLongitude,
    };
  }

  // If still not available, try to get from activityData
  if (
    activityDto.activityData &&
    typeof activityDto.activityData === 'object'
  ) {
    const data = activityDto.activityData as any;
    if (data.latitude != null && data.longitude != null) {
      return {
        latitude: data.latitude,
        longitude: data.longitude,
      };
    }
  }

  return null;
}

/**
 * Calculate walking time between two coordinates
 * @param distance Distance in kilometers
 * @returns Walking time in minutes (rounded)
 */
export function calculateWalkingTime(distance: number): number {
  if (distance <= 0) return 0;
  return Math.round(distance * MINUTES_PER_KILOMETER);
}

/**
 * Calculate distance and walking time between two activities
 * @param activity1 First activity
 * @param activity2 Second activity
 * @param activity1Entity Optional Activity entity for activity1 (if activityId exists)
 * @param activity2Entity Optional Activity entity for activity2 (if activityId exists)
 * @returns Object with distance (km) and walking time (minutes), or null if coordinates unavailable or distance exceeds maximum walking distance
 */
export function calculateTravelBetweenActivities(
  activity1: CreateTourActivityDto,
  activity2: CreateTourActivityDto,
  activity1Entity?: Activity | null,
  activity2Entity?: Activity | null,
): { distance: number; walkingTime: number } | null {
  const coords1 = getActivityCoordinates(activity1, activity1Entity);
  const coords2 = getActivityCoordinates(activity2, activity2Entity);

  if (!coords1 || !coords2) {
    return null;
  }

  const distance = calculateDistance(coords1, coords2);

  // If distance exceeds maximum walking distance, don't calculate walking time
  // Alternative transportation should be used
  if (distance > MAX_WALKING_DISTANCE_KM) {
    return null;
  }

  const walkingTime = calculateWalkingTime(distance);

  return {
    distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
    walkingTime,
  };
}

/**
 * Update travel times and distances for consecutive activities of the same day
 * Only calculates between activities that have the same dayNumber
 * @param activities Array of activity DTOs
 * @param activitiesMap Optional map of activityId -> Activity entity for faster lookup
 * @returns Updated array of activities with travelTimeToNext and distanceToNext calculated
 */
export function updateTravelTimesForActivities(
  activities: CreateTourActivityDto[],
  activitiesMap?: Map<string, Activity>,
): CreateTourActivityDto[] {
  if (activities.length <= 1) {
    return activities;
  }

  // Sort activities by dayNumber and order to ensure correct sequence
  const sortedActivities = [...activities].sort((a, b) => {
    const dayDiff = (a.dayNumber || 0) - (b.dayNumber || 0);
    if (dayDiff !== 0) return dayDiff;
    return (a.order || 0) - (b.order || 0);
  });

  const updatedActivities = sortedActivities.map((activity, index) => {
    // Don't calculate for the last activity
    if (index === sortedActivities.length - 1) {
      return {
        ...activity,
        travelTimeToNext: undefined,
        distanceToNext: undefined,
      };
    }

    const nextActivity = sortedActivities[index + 1];

    // Only calculate if both activities are on the same day
    if (activity.dayNumber !== nextActivity.dayNumber) {
      return {
        ...activity,
        travelTimeToNext: undefined,
        distanceToNext: undefined,
      };
    }

    // Get Activity entities if available
    const activity1Entity = activity.activityId
      ? activitiesMap?.get(activity.activityId)
      : null;
    const activity2Entity = nextActivity.activityId
      ? activitiesMap?.get(nextActivity.activityId)
      : null;

    // Calculate travel between activities
    const travel = calculateTravelBetweenActivities(
      activity,
      nextActivity,
      activity1Entity || undefined,
      activity2Entity || undefined,
    );

    if (travel) {
      return {
        ...activity,
        travelTimeToNext: travel.walkingTime,
        distanceToNext: travel.distance,
      };
    }

    // If calculation failed, keep original values or set to undefined
    return activity;
  });

  return updatedActivities;
}
