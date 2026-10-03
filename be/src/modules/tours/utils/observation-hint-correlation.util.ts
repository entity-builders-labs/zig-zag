import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import {
  hasSpecificNameOverlap,
  normalizeGeoName,
} from './nominatim-match.util';

/**
 * Fail-closed bidirectional strict correlation between a web-discovered
 * hint's name and a structured `SourceObservation`'s title. Deliberately
 * stricter than any ONE-directional name-matching bar elsewhere in this
 * codebase (including `hasSpecificNameOverlap(..., { requireAllTokens: true
 * })` used alone), because this correlation is what lets a hint skip the
 * normal search-and-confirm path entirely -- a false positive here is not
 * "picked the wrong candidate among several", it is "trusted an unrelated
 * real place's identity outright".
 *
 * A single direction is NOT enough: the real regression this guards
 * against is `hint = "Puerto Madero"` against the unrelated real POI
 * `"Templo Beit Jabad Puerto Madero"` (a synagogue whose name happens to
 * end with the neighborhood's own name). Every one of the hint's tokens
 * ("puerto", "madero") is fully contained in the longer title, so
 * `hasSpecificNameOverlap(hint, title, { requireAllTokens: true })` alone
 * WRONGLY returns true. Requiring the same strict bar in the OTHER
 * direction too (title's tokens against the hint) rejects it: only 2 of
 * the title's 5 significant tokens are covered by the hint.
 *
 * The same bidirectional bar still accepts a genuine paraphrase sharing
 * the same significant tokens plus a leading article ("Zanjón de Granados"
 * / "El Zanjón de Granados" -- "de" is below the 4-char significance floor
 * either way), and still rejects a shorter, more generic name that is a
 * real prefix of a DIFFERENT, more specific real place ("Museo de Arte" /
 * "Museo de Arte Moderno" -- the reverse direction fails, 2 of 3 tokens).
 *
 * Deliberately not relaxed for cross-language/translated titles in this
 * phase (see `hasSpecificNameOverlap`'s own documented trade-off) --
 * an honest recall loss, not a bug, preferred over any false identity.
 */
export function isBidirectionallyCorrelated(
  hintName: string,
  observationTitle: string,
): boolean {
  const hint = normalizeGeoName(hintName);
  const title = normalizeGeoName(observationTitle);
  if (!hint || !title) return false;
  return (
    hasSpecificNameOverlap(hint, title, { requireAllTokens: true }) &&
    hasSpecificNameOverlap(title, hint, { requireAllTokens: true })
  );
}

export type ObservationCorrelationResult =
  | { status: 'none' }
  | { status: 'ambiguous'; candidates: SourceObservation[] }
  | { status: 'unique'; observation: SourceObservation };

/**
 * Finds the single `SourceObservation` (if any) among `observations` that
 * unambiguously names the same real-world thing as `hint`.
 *
 * Never uses `evidenceKeys`/`evidenceKey`: a web-discovered hint's
 * `evidenceKeys` cite the grounded-evidence pool the discovery LLM was
 * shown (SerpAPI/Tavily/... snippet keys) -- a namespace structurally
 * disjoint from a structured `SourceObservation.evidenceKey`
 * (provider-prefixed, e.g. `"google_places:<placeId>"`). The two pools
 * never correlate through that key (verified against
 * `experience-acquisition.service.ts`: `extractExperiences` is called with
 * only `grounded.evidence`, never `allObservations`). Name is the only
 * signal available pre-resolution -- a `GeoEntityHint` carries no geo, by
 * design (the discovery LLM never supplies trusted coordinates).
 *
 * Fail-closed on ambiguity: two or more observations with DIFFERENT
 * identities (by `provider`+`externalId`, falling back to `evidenceKey`
 * when `externalId` is absent) both correlating to the same hint name
 * means "more than one candidate identity was acquired during this run",
 * never "pick one arbitrarily". `allObservations` reflects what THIS
 * acquisition run happened to gather, not an exhaustive real-world
 * uniqueness guarantee -- treating a single-observation result as proof of
 * real-world uniqueness would be the same class of mistake the P0.1 fix
 * corrected for observation-sourced Wikidata QIDs, just at the acquisition
 * step instead of the confirmation step. Deliberately does NOT attempt to
 * unify two candidates sharing the same `canonicalIdentity.wikidataQid`
 * into a single non-ambiguous match in this phase -- a documented
 * simplification, not an oversight; measure before adding that.
 */
export function findReusableObservationCandidate(
  hint: { name: string },
  observations: SourceObservation[],
): ObservationCorrelationResult {
  const matches = observations.filter((observation) =>
    isBidirectionallyCorrelated(hint.name, observation.title),
  );
  if (matches.length === 0) return { status: 'none' };

  const distinctIdentities = new Set(
    matches.map(
      (observation) =>
        `${observation.provider}:${observation.externalId ?? observation.evidenceKey}`,
    ),
  );
  if (distinctIdentities.size > 1) {
    return { status: 'ambiguous', candidates: matches };
  }
  return { status: 'unique', observation: matches[0] };
}
