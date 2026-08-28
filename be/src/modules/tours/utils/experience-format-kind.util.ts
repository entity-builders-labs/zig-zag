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

/**
 * Natural-language phrase for each requested experience format, used to
 * build real web-search queries (SerpApi / Groq browser_search). The raw
 * enum slug (e.g. "neighborhood_walks") must never be appended to a search
 * query directly — nobody searches that literal string, and it returns
 * materially worse evidence than the phrase a real person would type (e.g.
 * "walking tour"). POINT_VISITS is absent on purpose: "must-see attractions"
 * (already part of every query) already covers it.
 */
export const EXPERIENCE_FORMAT_SEARCH_PHRASE: Partial<
  Record<ExperienceFormat, string>
> = {
  [ExperienceFormat.NEIGHBORHOOD_WALKS]: 'walking tour guided walk',
  [ExperienceFormat.THEMATIC_ROUTES]: 'themed walking route self-guided trail',
  [ExperienceFormat.EXPERIENCES]: 'local experience tour',
};
