import {
  Coordinate,
  PlanningExperienceCandidate,
  SpatialFootprint,
} from '../../../../be/src/modules/tours/interfaces/daily-planning.interface';
import { InterpretedRequest, LngLat, ReusableExperience } from '../contracts';

const coord = (p: LngLat): Coordinate => ({ lat: p.lat, lng: p.lng });
const point = (p: LngLat): SpatialFootprint => ({ type: 'POINT', centroid: coord(p) });

function bounds(line: LngLat[]) {
  return {
    north: Math.max(...line.map((p) => p.lat)),
    south: Math.min(...line.map((p) => p.lat)),
    east: Math.max(...line.map((p) => p.lng)),
    west: Math.min(...line.map((p) => p.lng)),
  };
}

/**
 * Facet overlap between the Experience's grounded facets and the request's
 * facets, in [0, 1]. Explicitly a spike relevance signal (no embeddings in
 * the spike, design D10).
 */
export function facetOverlapScore(experience: ReusableExperience, request: InterpretedRequest): number {
  const requested = new Set([...request.thematicFacets, ...request.experienceFormatFacets]);
  if (requested.size === 0) return 0;
  const hits = experience.content.facetKeys.filter((f) => requested.has(f)).length;
  return hits / requested.size;
}

/**
 * Projects a reusable Experience into the existing planner candidate
 * contract (spec: "Planner-compatible units"). PLACE_VISIT -> POINT;
 * CORRIDOR_WALK -> LINE with segment geometry, start/end at the segment ends
 * and component footprints following the ordered stops.
 */
export function toPlanningCandidate(
  experience: ReusableExperience,
  request: InterpretedRequest,
  stops = experience.content.stops,
  durationMinutes = experience.content.durationMinutes,
): PlanningExperienceCandidate {
  const base = {
    experienceId: experience.key,
    title: experience.content.name,
    durationMinutes,
    openingHours: { status: 'unknown' as const },
    semanticScore: facetOverlapScore(experience, request),
    themes: experience.content.facetKeys,
  };
  const footprint = experience.content.footprint;
  if (footprint.type === 'POINT') {
    const p = point(footprint.point);
    return { ...base, spatialFootprint: p, startFootprint: p, endFootprint: p };
  }
  const line = footprint.line;
  const start = point(line[0]);
  const end = point(line[line.length - 1]);
  const mid = line[Math.floor(line.length / 2)];
  return {
    ...base,
    spatialFootprint: { type: 'LINE', centroid: coord(mid), bounds: bounds(line), geometry: line.map(coord) },
    componentFootprints: [start, ...stops.map((s) => point(s.point)), end],
    startFootprint: start,
    endFootprint: end,
  };
}
