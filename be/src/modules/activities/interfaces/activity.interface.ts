import { Activity } from '@prisma/client';

/**
 * Activity with calculated distance from a reference point
 */
export interface ActivityWithDistance extends Activity {
  distance: number;
  weightedScore?: number;
}

/**
 * Result of creating multiple activities
 */
export interface CreateManyResult {
  created: number;
  duplicates: number;
  errors: number;
  activities: Activity[];
}

/**
 * Activity search result with metadata
 */
export interface ActivitySearchResult {
  activities: ActivityWithDistance[];
  fromCache: boolean;
  crawlingTriggered: boolean;
  message: string;
}
