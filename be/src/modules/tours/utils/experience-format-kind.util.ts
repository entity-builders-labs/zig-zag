import { ActivityKind } from '@prisma/client';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';

/**
 * Single source of truth mapping a requested experience format to the real
 * ActivityKind that satisfies it. POINT_VISITS is deliberately absent — it
 * maps to POI, which is the near-ubiquitous default kind and needs no
 * coverage gate. AREA is absent too: it's a geographic container, never a
 * "walk" a user can experience directly, and ActivitiesService.findAll
 * already excludes it from the candidate pool.
 */
export const EXPERIENCE_FORMAT_ACTIVITY_KIND: Partial<
  Record<ExperienceFormat, ActivityKind>
> = {
  [ExperienceFormat.NEIGHBORHOOD_WALKS]: ActivityKind.NEIGHBORHOOD_WALK,
  [ExperienceFormat.THEMATIC_ROUTES]: ActivityKind.ROUTE,
  [ExperienceFormat.EXPERIENCES]: ActivityKind.EXPERIENCE,
};
