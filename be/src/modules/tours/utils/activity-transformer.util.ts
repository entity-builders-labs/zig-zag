import { isValidId } from '@shared/utils/id-validator';
import { CreateTourActivityDto } from '../dto/create-tour.dto';

/**
 * Parse start time from various formats (time string, ISO date, Date object)
 */
export function parseStartTime(
  startTime: string | Date | undefined,
): Date | undefined {
  if (!startTime) return undefined;

  if (startTime instanceof Date) {
    return startTime;
  }

  if (typeof startTime === 'string') {
    // Check if it's just a time string (HH:MM format) or a full date
    const timePattern = /^\d{1,2}:\d{2}(:\d{2})?$/;
    if (timePattern.test(startTime)) {
      // It's just a time string, we'll store it as-is in activityData
      // For startTime field, we'll skip it or try to combine with a date
      return undefined; // Skip for now since we don't have a base date
    } else {
      // Try to parse as ISO date
      const parsedDate = new Date(startTime);
      return !isNaN(parsedDate.getTime()) ? parsedDate : undefined;
    }
  }

  return undefined;
}

/**
 * Coerces the AI's returned duration into the plain hours-as-Float value
 * TourActivity.duration expects. Groq's strict json_schema mode guarantees a
 * real number, but weaker models (e.g. small local Ollama models) sometimes
 * echo it back with units attached (e.g. "2.5 hours") despite the schema —
 * extracting the leading numeric value here is more robust than trusting
 * every provider to honor the type, and failing persistence outright over a
 * cosmetic string wrapper would be a worse outcome than a null duration.
 */
export function parseDuration(duration: unknown): number | undefined {
  if (typeof duration === 'number') {
    return Number.isFinite(duration) ? duration : undefined;
  }
  if (typeof duration === 'string') {
    const match = duration.match(/-?\d+(\.\d+)?/);
    if (match) {
      const parsed = Number.parseFloat(match[0]);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

/**
 * Validate activity IDs and return only valid ones
 */
export async function validateActivityIds(
  activityIds: string[],
  prisma: any,
): Promise<string[]> {
  if (activityIds.length === 0) return [];

  const validIds = activityIds.filter((id): id is string => isValidId(id));

  if (validIds.length > 0) {
    try {
      const existingActivities = await prisma.activity.findMany({
        where: { id: { in: validIds } },
      });

      // Return only IDs that exist in the database
      return existingActivities.map((a: any) => a.id);
    } catch (error) {
      // Log error but don't throw - return empty array
      console.error('Error validating activity IDs:', error);
      return [];
    }
  }

  return [];
}

/**
 * Transform AI response activities to CreateTourActivityDto format
 */
export function transformAiActivitiesToDto(
  aiActivities: any[],
  startIndex: number = 0,
): CreateTourActivityDto[] {
  return aiActivities.map((act: any, index: number) => {
    const validActivityId =
      act.activityId && isValidId(act.activityId) ? act.activityId : undefined;

    const parsedStartTime = parseStartTime(act.startTime);

    return {
      activityId: validActivityId,
      activityName: act.activityName || act.type || 'Activity',
      activityType: act.type || act.activityType,
      activityLatitude: act.latitude,
      activityLongitude: act.longitude,
      duration: parseDuration(act.duration),
      startTime: parsedStartTime,
      notes: act.notes,
      dayNumber: act.dayNumber,
      travelTimeToNext: act.travelTimeToNext,
      distanceToNext: act.distanceToNext,
      order: startIndex + index + 1,
      // Store full activity data if activityId is not valid or not provided
      activityData: validActivityId
        ? undefined
        : ({
            name: act.activityName || act.type,
            type: act.type,
            latitude: act.latitude,
            longitude: act.longitude,
            startTime: act.startTime, // Store original startTime string in activityData
            ...act,
          } as any),
    };
  });
}

/**
 * Prepare activity data for Prisma create operation
 */
export function prepareActivityDataForCreate(
  activityDto: CreateTourActivityDto,
  index: number,
): any {
  const activityData: any = {
    order: activityDto.order || index + 1,
    activityId: activityDto.activityId,
    activityName: activityDto.activityName,
    activityType: activityDto.activityType,
    activityLatitude: activityDto.activityLatitude,
    activityLongitude: activityDto.activityLongitude,
    activityData: activityDto.activityData,
    duration: activityDto.duration,
    notes: activityDto.notes,
    dayNumber: activityDto.dayNumber,
    travelTimeToNext: activityDto.travelTimeToNext,
    distanceToNext: activityDto.distanceToNext,
  };

  // Parse startTime if it's a string
  if (activityDto.startTime) {
    const parsed = parseStartTime(activityDto.startTime);
    if (parsed) {
      activityData.startTime = parsed;
    }
  }

  // Remove undefined values
  Object.keys(activityData).forEach(
    (key) => activityData[key] === undefined && delete activityData[key],
  );

  return activityData;
}
