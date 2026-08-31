import { ActivityKind } from '@prisma/client';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';

/**
 * Single source of truth mapping a requested experience format to the real
 * ActivityKind that satisfies it. AREA is deliberately absent: it is a
 * geographic container, never a user-facing experience format, and
 * ActivitiesService.findAll already excludes it from the candidate pool.
 */
export const EXPERIENCE_FORMAT_ACTIVITY_KIND: Partial<
  Record<ExperienceFormat, ActivityKind>
> = {
  [ExperienceFormat.POINT_VISITS]: ActivityKind.POI,
  [ExperienceFormat.NEIGHBORHOOD_WALKS]: ActivityKind.NEIGHBORHOOD_WALK,
  [ExperienceFormat.THEMATIC_ROUTES]: ActivityKind.ROUTE,
  [ExperienceFormat.EXPERIENCES]: ActivityKind.EXPERIENCE,
};

/**
 * Natural-language phrase for each requested experience format, used to
 * build real web-search queries. The raw enum slug (e.g.
 * "neighborhood_walks") must never be appended to a search query directly.
 * POINT_VISITS is absent on purpose: "must-see attractions" (already part of
 * every general query) covers point visits without adding noisy wording.
 */
export const EXPERIENCE_FORMAT_SEARCH_PHRASE: Partial<
  Record<ExperienceFormat, string>
> = {
  [ExperienceFormat.NEIGHBORHOOD_WALKS]: 'walking tour guided walk',
  [ExperienceFormat.THEMATIC_ROUTES]: 'themed walking route self-guided trail',
  [ExperienceFormat.EXPERIENCES]: 'local experience tour',
};
