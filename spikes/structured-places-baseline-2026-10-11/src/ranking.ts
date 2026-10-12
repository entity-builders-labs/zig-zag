import { AdmissionRecord } from './admission';
import { CandidateFacts, LngLat, distanceMeters } from './reuse';

/**
 * Deterministic structured ranking (owner decision Q3). Priority:
 * 1. provider tourism/category signal; 2. structured heritage/historic
 * designation; 3. provider importance (none available from OSM POIs);
 * 4. spatial diversity (redundant nearby candidates demoted);
 * 5. Wikidata sitelinks only as a weak tie-breaker.
 * No LLM, embeddings, web evidence or L2 assertions.
 */
export const RANKING_POLICY_VERSION = 'ranking-spike3-1';

/** Category signal per backend tourism class; rationale: visitable-attraction specificity. */
const CATEGORY_WEIGHTS: Record<string, number> = {
  'tourism:attraction': 5, 'tourism:museum': 5, 'tourism:gallery': 4, 'tourism:viewpoint': 4, 'tourism:zoo': 4, 'tourism:aquarium': 4,
  'tourism:theme_park': 3, 'tourism:artwork': 2, 'tourism:picnic_site': 1,
  'historic:monument': 4, 'historic:castle': 4, 'historic:building': 3, 'historic:memorial': 2,
  'amenity:marketplace': 3, 'amenity:place_of_worship': 2,
  'leisure:park': 2, 'leisure:square': 2, 'leisure:beach_resort': 2, 'natural:beach': 2,
};
const DEFAULT_WEIGHT: Record<string, number> = { tourism: 2, historic: 3 };
export const DIVERSITY_RADIUS_METERS = 250;

export interface RankingInputs {
  placeId: string;
  name: string;
  admissionClass: string;
  categorySignal: number;
  heritageSignal: number;
  importanceSignal: 'unavailable';
  sitelinks: number;
  demotedForDiversity?: { near: string; meters: number };
}

export function categorySignal(cls: string): number {
  return CATEGORY_WEIGHTS[cls] ?? DEFAULT_WEIGHT[cls.split(':')[0]] ?? 1;
}

export function heritageSignal(facts: CandidateFacts | undefined): number {
  if (!facts) return 0;
  if (facts.facts.some((f) => f.source === 'wikidata' && f.field === 'P1435')) return 2;
  if (facts.facts.some((f) => f.source === 'openstreetmap' && (f.field === 'tag:heritage' || f.field === 'tag:historic'))) return 1;
  return 0;
}

/**
 * Ranks admitted places. Ranking orders candidates only: it never admits,
 * rejects or writes. Ties break by place id.
 */
export function rankPlaces(admitted: AdmissionRecord[], candidates: Readonly<Record<string, CandidateFacts>>, points: Readonly<Record<string, LngLat>>): RankingInputs[] {
  const scored = admitted.map((r) => {
    const facts = candidates[r.placeId];
    return {
      placeId: r.placeId, name: r.name, admissionClass: r.admissionClass as string,
      categorySignal: categorySignal(r.admissionClass as string), heritageSignal: heritageSignal(facts), importanceSignal: 'unavailable' as const,
      sitelinks: facts?.prominence.sitelinks ?? 0,
    };
  }).sort((a, b) => b.categorySignal - a.categorySignal || b.heritageSignal - a.heritageSignal || b.sitelinks - a.sitelinks || a.placeId.localeCompare(b.placeId));

  const kept: RankingInputs[] = [];
  const demoted: RankingInputs[] = [];
  for (const c of scored) {
    const p = points[c.placeId];
    const near = p ? kept.find((k) => points[k.placeId] && distanceMeters(points[k.placeId], p) < DIVERSITY_RADIUS_METERS) : undefined;
    if (near) demoted.push({ ...c, demotedForDiversity: { near: near.placeId, meters: Math.round(distanceMeters(points[near.placeId], p)) } });
    else kept.push(c);
  }
  return [...kept, ...demoted];
}
