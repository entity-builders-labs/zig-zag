import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { NominatimResult } from '@integrations/osm/interfaces/nominatim.interface';
import { calculateDistance, Coordinates } from '@shared/utils/distance.utils';

/**
 * Extracted verbatim (byte-identical behavior) from
 * `ExperienceProposalResolverService`'s former private methods, so the
 * same real name-matching semantics can be reused outside the resolver
 * (Task B5 — area/route anchor resolution) instead of being reimplemented
 * in a simplified form. See the resolver's own spec file for the original
 * regression coverage this preserves unchanged.
 */
export function normalizeGeoName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Nominatim's own `importance` is a global, name-driven popularity signal
 * with no awareness of the requested destination — verified live against
 * the real API: two real places sharing an identical name (e.g. a
 * "Catedral San Juan Bautista" in Buenos Aires and another in San Juan
 * province) can both survive the text-match filters above, and the wrong
 * one (Buenos Aires, importance 0.208) outranks the right one (San Juan,
 * importance 0.199) on importance alone. When we know where the request's
 * destination actually is, proximity to it is a far stronger signal than
 * global importance for choosing between same-named real places — so it
 * takes priority whenever it can be measured. A candidate missing
 * coordinates simply can't participate in that comparison and falls back
 * to importance, same as before this fix existed.
 */
export function rankNominatimCandidates(
  candidates: NominatimResult[],
  destinationPoint?: Coordinates,
): NominatimResult | undefined {
  if (candidates.length === 0) return undefined;

  if (destinationPoint) {
    const measured = candidates
      .filter(
        (result) =>
          Number.isFinite(result.latitude) && Number.isFinite(result.longitude),
      )
      .map((result) => ({
        result,
        distanceKm: calculateDistance(destinationPoint, {
          latitude: result.latitude as number,
          longitude: result.longitude as number,
        }),
      }));
    if (measured.length > 0) {
      return measured.sort((a, b) => a.distanceKm - b.distanceKm)[0].result;
    }
  }

  return candidates.sort((a, b) => b.importance - a.importance)[0];
}

export function bestNominatimMatch(
  name: string,
  results: NominatimResult[],
  destinationPoint?: Coordinates,
): NominatimResult | undefined {
  const needle = normalizeGeoName(name);
  const exact = results.filter((result) => {
    const display = normalizeGeoName(result.displayName);
    return display === needle || display.startsWith(`${needle} `);
  });
  if (exact.length > 0) {
    return rankNominatimCandidates(exact, destinationPoint);
  }

  // A real landmark's grounded-evidence name and Nominatim's own canonical
  // name can differ by more than word order or punctuation. Argentina's
  // OSM data names places in Spanish ("Parque Provincial Ischigualasto")
  // while English-language grounded search evidence — and the LLM
  // extracting from it — surfaces the English form ("Ischigualasto
  // Provincial Park"). Requiring an exact literal prefix silently
  // discarded a real, unambiguous, single-result Nominatim match just
  // because "Park" never literally becomes "Parque". Fall back to
  // significant-token overlap against only the place-name segment of
  // displayName (never the address hierarchy after it, which would let
  // country/region tokens produce false positives on their own), guarded
  // by requiring at least one long/specific shared token so a merely
  // translated generic word can never match by itself.
  const needleTokens = needle.split(' ').filter((token) => token.length >= 4);
  if (needleTokens.length === 0) return undefined;

  const fuzzyMatches = results
    .map((result) => {
      const headSegment = normalizeGeoName(
        result.displayName.split(',')[0] ?? '',
      );
      const headTokens = new Set(headSegment.split(' ').filter(Boolean));
      const matchedTokens = needleTokens.filter((token) =>
        headTokens.has(token),
      );
      return { result, matchedTokens };
    })
    .filter(
      (candidate) =>
        candidate.matchedTokens.length / needleTokens.length >= 0.5 &&
        candidate.matchedTokens.some((token) => token.length >= 5),
    )
    .map((candidate) => candidate.result);
  return rankNominatimCandidates(fuzzyMatches, destinationPoint);
}

/**
 * Nominatim's own top-of-hierarchy address classification for a scope
 * genuinely broader than any single coherent destination/anchor area --
 * NOT an enumeration of "acceptable" narrow place types (cutover M3.5, spec
 * cutover plan SS7; engineering-principles.md SS9: generalize the bug, don't
 * hardcode examples). A country/state/continent-scale result would blow
 * out every downstream radius-bounded search (catalog retrieval, Overpass,
 * Places Nearby) if treated as a bounded area scope -- this is the only
 * reason ANY exclusion exists here.
 */
const TOO_BROAD_ADDRESS_TYPES: ReadonlySet<string> = new Set([
  'continent',
  'country',
  'state',
]);

/**
 * The ONE canonical "is this a usable, scale-compatible urban/
 * administrative area" predicate (cutover M3.5) -- shared by
 * `DestinationResolutionService` (whole-trip destination scope) and
 * `AreaRouteAnchorResolverService` (B5 area anchors), so there is exactly
 * one scope-acceptance authority, never two independently-drifting ones.
 *
 * Combines FOUR real, provider-native signals, never a name whitelist:
 *   1. provider type    -- Nominatim's own `class` (the top-level OSM tag
 *                           category that matched: 'boundary'/'place' vs.
 *                           'building'/'highway'/'amenity'/'shop'/...);
 *   2. usable boundary   -- a real way/relation only; a bare node has no
 *                           polygon geometry to hydrate, ever;
 *   3. urban/admin context -- `class` must actually be 'boundary' (an
 *                           administrative boundary) or 'place' (a named
 *                           populated place), never inferred from
 *                           `addresstype` alone;
 *   4. scale compatibility -- `addresstype` must not be one of the small,
 *                           stable, too-broad top-level scales above.
 *
 * A suburb, neighbourhood, quarter, borough, hamlet, or any other locale-
 * specific administrative/place classification Nominatim/OSM ever returns
 * is accepted uniformly here -- this function never enumerates "which
 * narrow terms count," it only excludes the handful of genuinely-too-broad
 * ones. `class`/`addresstype` missing or unrecognized never defaults to
 * eligible (unknown is not evidence of eligibility).
 */
export function isAreaScaleEligible<
  T extends Pick<NominatimResult, 'osmType' | 'addresstype' | 'class'>,
>(result: T): result is T & { osmType: 'way' | 'relation' } {
  if (result.osmType === 'node') return false;
  if (TOO_BROAD_ADDRESS_TYPES.has(result.addresstype)) return false;
  return result.class === 'boundary' || result.class === 'place';
}

export function matchOsmCandidateByName(
  name: string,
  pool: OsmCandidate[],
): OsmCandidate | undefined {
  const needle = normalizeGeoName(name);
  return pool.find((candidate) => {
    const haystack = normalizeGeoName(candidate.name);
    return (
      haystack === needle ||
      haystack.includes(needle) ||
      needle.includes(haystack)
    );
  });
}
