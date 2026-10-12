import { CandidateFacts } from './contracts';
import { Spike2Snapshot } from './catalog';
import { distanceToLineMeters, lineVertices } from './spike1';

/**
 * Structured-prominence ranking (design R5). It orders which candidates are
 * offered for evaluation within a budget; it never writes or authorizes.
 */
export interface RankedCandidate {
  id: string;
  score: number[];
  signals: string[];
}

export function rankByProminence(candidates: CandidateFacts[]): RankedCandidate[] {
  return candidates
    .map((c) => ({
      id: c.geoEntityId,
      score: [c.prominence.sitelinks ?? 0, c.prominence.tagSignals.length],
      signals: [`sitelinks:${c.prominence.sitelinks ?? 0}`, ...c.prominence.tagSignals],
    }))
    .sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || a.id.localeCompare(b.id));
}

/** Routes ranked by grounded relevant places near their geometry (retrieval signal only). */
export function rankRoutes(snapshot: Spike2Snapshot, routes: CandidateFacts[], relevantPlaceIds: string[], bufferMeters: number): RankedCandidate[] {
  const places = relevantPlaceIds.map((id) => snapshot.catalog.geoEntities[id]).filter(Boolean);
  return routes
    .map((r) => {
      const geometry = snapshot.catalog.geoEntities[r.geoEntityId]?.geometry;
      const vertices = geometry ? lineVertices(geometry) : [];
      const near = places.filter((p) => distanceToLineMeters(vertices, p.centroid) <= bufferMeters).map((p) => p.name).sort();
      return { id: r.geoEntityId, score: [near.length, r.prominence.sitelinks ?? 0], signals: [`groundedPlacesNear:${near.length}`, ...near.map((n) => `near:${n}`)] };
    })
    .sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || a.id.localeCompare(b.id));
}
