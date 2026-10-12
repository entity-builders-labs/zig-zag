import {
  DailyPlanningSolution,
  PlanningExperienceCandidate,
  TravelEstimate,
} from '../../../../be/src/modules/tours/interfaces/daily-planning.interface';
import { InterpretedRequest, LngLat, ReusableExperience } from '../contracts';
import { polylineLengthMeters } from '../geometry';
import { CompositionPolicy } from '../policy';
import { CatalogSnapshot } from '../stores';
import { toPlanningCandidate } from './projection';

/** Mirrors TourExperienceComponent: what the traveller was given. */
export interface TourComponentRow {
  geoEntityId: string;
  order: number;
  role: 'place' | 'route' | 'stop';
  required: boolean;
  name: string;
  latitude?: number;
  longitude?: number;
  geometry?: { type: 'LineString'; coordinates: [number, number][] };
}

/** Mirrors TourExperience. */
export interface TourExperienceRow {
  experienceId: string;
  dayNumber: number;
  order: number;
  startMinutesFromMidnight: number;
  durationMinutes: number;
  travelFromPrevious?: TravelEstimate;
  trimmedOptionalStops: string[];
  components: TourComponentRow[];
}

export interface TourSnapshot {
  request: InterpretedRequest;
  catalogEpoch: number;
  experiences: TourExperienceRow[];
  unselected: DailyPlanningSolution['unselected'];
  planner: DailyPlanningSolution['metadata'];
}

export interface PlannerPort {
  solve(candidates: PlanningExperienceCandidate[], request: InterpretedRequest): Promise<DailyPlanningSolution>;
}

export type TourComposition =
  | { status: 'COMPOSED'; tour: TourSnapshot }
  | { status: 'SELECTION_REJECTED'; unofferedIds: string[] };

const TRIM_REASONS = new Set(['DAILY_TIME_CAPACITY_EXCEEDED', 'MAX_WALKING_PER_DAY_EXCEEDED', 'MAX_CONTINUOUS_WALKING_EXCEEDED', 'NO_FEASIBLE_DAY']);

/** Duration of a corridor walk keeping only `kept` stops (same derivation as composition). */
export function trimmedDuration(experience: ReusableExperience, keptStops: number, policy: CompositionPolicy): number {
  if (experience.content.footprint.type !== 'LINE') return experience.content.durationMinutes;
  const walking = polylineLengthMeters(experience.content.footprint.line) / ((policy.walkingSpeedKmh * 1000) / 60);
  return Math.round(walking + keptStops * policy.corridorStopDwellMinutes);
}

function components(experience: ReusableExperience, keptStopIds: Set<string>): TourComponentRow[] {
  const point = (p: LngLat) => ({ latitude: p.lat, longitude: p.lng });
  if (experience.content.footprint.type === 'POINT') {
    const stop = experience.content.stops[0];
    return [{ geoEntityId: stop.geoEntityId, order: 1, role: 'place', required: true, name: stop.name, ...point(stop.point) }];
  }
  const routeId = experience.anchors.find((a) => a.startsWith('route='))?.slice('route='.length) ?? '';
  const rows: TourComponentRow[] = [{
    geoEntityId: routeId, order: 1, role: 'route', required: true, name: experience.content.name,
    geometry: { type: 'LineString', coordinates: experience.content.footprint.line.map((p) => [p.lng, p.lat]) },
  }];
  for (const stop of experience.content.stops.filter((s) => keptStopIds.has(s.geoEntityId))) {
    rows.push({ geoEntityId: stop.geoEntityId, order: rows.length + 1, role: 'stop', required: stop.required, name: stop.name, ...point(stop.point) });
  }
  return rows;
}

/**
 * Request-specific composition (spec `tour-composition`). Reads only the
 * FINAL catalog snapshot and returns a Tour-shaped snapshot; it has no
 * catalog write path. An optional external selection (e.g. a model's) is
 * accepted only if every id was offered; otherwise it is rejected whole.
 */
export async function composeTour(input: {
  snapshot: CatalogSnapshot;
  request: InterpretedRequest;
  planner: PlannerPort;
  policy: CompositionPolicy;
  selection?: string[];
}): Promise<TourComposition> {
  const offered = Object.values(input.snapshot.experiences)
    .filter((e) => e.status === 'ACTIVE')
    .sort((a, b) => a.key.localeCompare(b.key));
  const offeredById = new Map(offered.map((e) => [e.key, e]));
  if (input.selection) {
    const unofferedIds = input.selection.filter((id) => !offeredById.has(id));
    if (unofferedIds.length > 0) return { status: 'SELECTION_REJECTED', unofferedIds };
  }
  const chosen = input.selection ? input.selection.map((id) => offeredById.get(id) as ReusableExperience) : offered;
  const trimmed = new Map<string, Set<string>>(); // experienceId -> stop ids KEPT

  let candidates = chosen.map((e) => toPlanningCandidate(e, input.request));
  let solution = await input.planner.solve(candidates, input.request);

  // Optional-stop trimming: a corridor walk that did not fit is retried
  // once without its optional stops. The trim lives only in this snapshot.
  const retry = solution.unselected
    .map((u) => ({ u, e: offeredById.get(u.experienceId) }))
    .filter(({ u, e }) => e?.unitKind === 'CORRIDOR_WALK' && e.content.stops.some((s) => !s.required) && u.reasons.some((r) => TRIM_REASONS.has(r)));
  if (retry.length > 0) {
    for (const { e } of retry) {
      const ex = e as ReusableExperience;
      const kept = ex.content.stops.filter((s) => s.required);
      trimmed.set(ex.key, new Set(kept.map((s) => s.geoEntityId)));
    }
    candidates = chosen.map((e) => {
      const keep = trimmed.get(e.key);
      if (!keep) return toPlanningCandidate(e, input.request);
      const stops = e.content.stops.filter((s) => keep.has(s.geoEntityId));
      return toPlanningCandidate(e, input.request, stops, trimmedDuration(e, stops.length, input.policy));
    });
    solution = await input.planner.solve(candidates, input.request);
  }

  const durationById = new Map(candidates.map((c) => [c.experienceId, c.durationMinutes]));
  const rows: TourExperienceRow[] = [];
  for (const day of solution.days) {
    day.experiences.forEach((planned, index) => {
      const e = offeredById.get(planned.experienceId) as ReusableExperience;
      const keep = trimmed.get(e.key) ?? new Set(e.content.stops.map((s) => s.geoEntityId));
      rows.push({
        experienceId: e.key,
        dayNumber: day.dayNumber,
        order: index + 1,
        startMinutesFromMidnight: planned.startMinutesFromMidnight,
        durationMinutes: durationById.get(e.key) ?? e.content.durationMinutes,
        ...(planned.travelFromPrevious ? { travelFromPrevious: planned.travelFromPrevious } : {}),
        trimmedOptionalStops: e.content.stops.filter((s) => !keep.has(s.geoEntityId)).map((s) => s.geoEntityId),
        components: components(e, keep),
      });
    });
  }
  return {
    status: 'COMPOSED',
    tour: { request: input.request, catalogEpoch: input.snapshot.epoch, experiences: rows, unselected: solution.unselected, planner: solution.metadata },
  };
}
