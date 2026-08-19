import { ActivityKind, VariantTheme } from '@prisma/client';

// Mirrors activity-verification.util.ts's shape and spirit — never trust the
// prompt alone, drop anything not backed by a real, offered candidate, and
// count what got dropped for observability.

export interface RawCompositeActivity {
  name?: string;
  kind?: string;
  variantTheme?: string;
  themeReasoning?: string;
  areaId?: string;
  dayNumber?: number;
  startTime?: string;
  waypointIds?: string[];
}

export interface VerifiedCompositeActivity {
  name?: string;
  kind: Exclude<ActivityKind, 'POI' | 'AREA'>;
  variantTheme: VariantTheme;
  themeReasoning?: string;
  areaId: string;
  dayNumber?: number;
  startTime?: string;
  waypointIds: string[];
}

export interface CompositeVerificationResult {
  verified: VerifiedCompositeActivity[];
  hallucinatedWaypointCount: number;
  invalidCompositeCount: number;
}

const VALID_VARIANT_KINDS = new Set<string>([
  ActivityKind.NEIGHBORHOOD_WALK,
  ActivityKind.ROUTE,
  ActivityKind.EXPERIENCE,
]);

const VALID_THEMES = new Set<string>(Object.values(VariantTheme));

// Minimum viable stop count for a composite of multiple real places — below
// this it isn't really "a walk", just a mislabeled single POI. Exported so
// CompositeActivityService can apply the same rule when a live waypoint
// removal (removeWaypointFromActiveVariants) drops a variant below it.
export const MIN_WAYPOINTS_FOR_MULTI_STOP = 2;

/**
 * Filters/repairs the LLM's `compositeActivities` proposals against the real
 * candidates it was actually offered (Activities already in the DB, plus
 * OSM features from Overpass) — the same hard-enforcement principle as
 * verifyAndDedupeActivities, one level deeper: every individual waypointId
 * has to trace back to a real candidate, not just the composite as a whole.
 *
 * kind: ROUTE has a different validity rule than NEIGHBORHOOD_WALK/
 * EXPERIENCE — it doesn't need 2+ waypoints (it can be a pure trace with no
 * stops at all), but it does need at least one waypointId that resolves to
 * a real OSM feature, since that's the only source of the `boundary`
 * geometry a brand-new ROUTE gets created with.
 */
export function verifyAndDedupeCompositeActivities(
  rawComposites: RawCompositeActivity[],
  candidateActivityIds: Set<string>,
  candidateOsmFeatureIds: Set<string>,
  offeredAreaId: string | null,
): CompositeVerificationResult {
  const verified: VerifiedCompositeActivity[] = [];
  let hallucinatedWaypointCount = 0;
  let invalidCompositeCount = 0;

  const allRealIds = new Set([
    ...candidateActivityIds,
    ...candidateOsmFeatureIds,
  ]);

  for (const raw of rawComposites) {
    const kind = raw.kind?.toUpperCase();
    const variantTheme = raw.variantTheme?.toUpperCase();

    if (!kind || !VALID_VARIANT_KINDS.has(kind)) {
      invalidCompositeCount++;
      continue;
    }
    if (!variantTheme || !VALID_THEMES.has(variantTheme)) {
      invalidCompositeCount++;
      continue;
    }
    if (!offeredAreaId || raw.areaId !== offeredAreaId) {
      invalidCompositeCount++;
      continue;
    }

    const seen = new Set<string>();
    const validWaypointIds: string[] = [];
    for (const id of raw.waypointIds || []) {
      if (!allRealIds.has(id)) {
        hallucinatedWaypointCount++;
        continue;
      }
      if (seen.has(id)) continue; // silent dedupe, not a hallucination
      seen.add(id);
      validWaypointIds.push(id);
    }

    if (kind === ActivityKind.ROUTE) {
      const hasOsmGeometrySource = validWaypointIds.some((id) =>
        candidateOsmFeatureIds.has(id),
      );
      if (validWaypointIds.length === 0 || !hasOsmGeometrySource) {
        invalidCompositeCount++;
        continue;
      }
    } else if (validWaypointIds.length < MIN_WAYPOINTS_FOR_MULTI_STOP) {
      invalidCompositeCount++;
      continue;
    }

    verified.push({
      name: raw.name,
      kind: kind as Exclude<ActivityKind, 'POI' | 'AREA'>,
      variantTheme: variantTheme as VariantTheme,
      themeReasoning: raw.themeReasoning,
      areaId: raw.areaId as string,
      dayNumber: raw.dayNumber,
      startTime: raw.startTime,
      waypointIds: validWaypointIds,
    });
  }

  return { verified, hallucinatedWaypointCount, invalidCompositeCount };
}

/**
 * Validates an optional per-tour waypoint subset (the "instancia
 * personalizada" case — e.g. excluding a stop for a family with kids)
 * against a specific variant's OWN current waypoints — deliberately not
 * against the general candidate pool, since this is about narrowing an
 * already-real variant's content, not proposing new content. Returns null
 * (meaning "no override, use the full snapshot") when nothing was
 * requested, or when the requested subset would leave fewer than the
 * minimum viable stop count — silently falling back rather than persisting
 * a broken TourActivityWaypoint snapshot.
 */
export function verifySelectedWaypointSubset(
  requestedIds: string[] | undefined,
  actualWaypointIds: Set<string>,
): string[] | null {
  if (!requestedIds || requestedIds.length === 0) return null;

  const seen = new Set<string>();
  const filtered: string[] = [];
  for (const id of requestedIds) {
    if (actualWaypointIds.has(id) && !seen.has(id)) {
      seen.add(id);
      filtered.push(id);
    }
  }

  if (filtered.length < MIN_WAYPOINTS_FOR_MULTI_STOP) return null;
  return filtered;
}
