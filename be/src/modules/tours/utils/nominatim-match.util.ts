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
 * Nominatim place/address ranks are lower for broader administrative levels.
 * Ranks 13..25 cover settlement and neighborhood-scale named areas while
 * excluding continent/country/state/region/county-scale results. The policy
 * intentionally uses the numeric scale signal, not an addresstype list.
 */
const AREA_SCALE_MIN_RANK = 13;
const AREA_SCALE_MAX_RANK = 25;

function hasSupportedAreaScaleEvidence(result: {
  placeRank?: number;
  addressRank?: number;
}): boolean {
  const rank = result.placeRank ?? result.addressRank;
  return (
    rank !== undefined &&
    Number.isInteger(rank) &&
    rank >= AREA_SCALE_MIN_RANK &&
    rank <= AREA_SCALE_MAX_RANK
  );
}

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
 *   3. urban/admin context -- see the per-class rule below; never inferred
 *                           from `addresstype` alone;
 *   4. scale compatibility -- Nominatim's numeric place/address rank must
 *                           positively place the result in the supported
 *                           settlement/neighborhood band; unknown rank is
 *                           not eligible.
 *
 * Urban/admin context is NOT simply "class is boundary or place" -- the
 * two classes carry different semantics and are validated differently:
 *   - `class === 'boundary'`: Nominatim overloads this class with several
 *     non-administrative boundary kinds (national parks, protected areas,
 *     maritime boundaries, postal code areas, ...). Only
 *     `type === 'administrative'` genuinely establishes an administrative
 *     area -- a missing/unrecognized `type` never defaults to eligible.
 *   - `class === 'place'`: every real OSM `place=*` value denotes a genuine
 *     named/populated place at some granularity; the numeric rank decides
 *     whether that granularity is usable here.
 *
 * Suburb, neighbourhood, and quarter-style places are accepted by their
 * positive rank evidence, without blindly whitelisting those names. Never a
 * destination-name or provider-specific special case.
 */
export function isAreaScaleEligible<
  T extends Pick<
    NominatimResult,
    'osmType' | 'addresstype' | 'class' | 'type' | 'placeRank' | 'addressRank'
  >,
>(result: T): result is T & { osmType: 'way' | 'relation' } {
  if (result.osmType === 'node') return false;
  if (!hasSupportedAreaScaleEvidence(result)) return false;
  if (result.class === 'boundary') return result.type === 'administrative';
  return result.class === 'place';
}

/**
 * Whether a Nominatim match that already failed `isAreaScaleEligible` can
 * still be treated as a point-scale PLACE, instead of being discarded
 * outright. The discovery LLM's `expectedKind`/`role` is only a proposal —
 * this decides, from the match's own structural evidence, whether it is a
 * genuine venue-scale point or simply too broad to be resolved at any
 * granularity in this domain:
 *   - any `class === 'boundary'` match (administrative or not — national
 *     parks, postal areas, etc. are all polygons, never a single point) is
 *     inherently area-shaped, not a point, so it is never PLACE-eligible;
 *   - a `class === 'place'` match below the area-scale rank band (country/
 *     state/region-scale, e.g. "region"/"province"/"county") is similarly
 *     too broad to stand in for a single venue;
 *   - everything else (a real POI/venue class such as amenity/tourism/
 *     shop/leisure, or a `place`-class match whose rank simply falls
 *     outside the area band for another reason, e.g. a node with no
 *     polygon) is a genuine point-scale candidate.
 */
export function isPlaceScaleEligible<
  T extends Pick<NominatimResult, 'class' | 'placeRank' | 'addressRank'>,
>(result: T): boolean {
  if (result.class === 'boundary') return false;
  if (result.class === 'place') {
    const rank = result.placeRank ?? result.addressRank;
    return rank === undefined || rank >= AREA_SCALE_MIN_RANK;
  }
  return true;
}

/**
 * Same specificity discipline `bestNominatimMatch`'s fuzzy path already
 * applies to the global Nominatim search results (a real word overlap of
 * at least half the hint's significant tokens, with at least one token of
 * real length) — applied here to the LOCAL Overpass pool, which had none
 * of these guards. Before this fix, raw bidirectional substring containment
 * let any short/generic OSM-tagged name (a 1-3 letter node, or a single
 * generic category word like "Iglesia"/"Church") match purely because its
 * letters happened to appear inside a longer, completely unrelated hint —
 * confirmed live: one mistagged node ("B") was accepted as the identity of
 * four distinct real Buenos Aires landmarks (MALBA, La Bombonera, Museo
 * Nacional de Bellas Artes) across one characterization run.
 *
 * Exact equality is always accepted regardless of length — that can never
 * be a false positive. Anything short of exact equality must clear the
 * same token-overlap bar `bestNominatimMatch` uses; there is no length-only
 * shortcut, because a short-but-real hint (e.g. a 3-letter café name)
 * legitimately using the SAME containment logic would be indistinguishable
 * from a mistagged 1-3 letter node without this token check.
 */
export function hasSpecificNameOverlap(
  needle: string,
  haystack: string,
  // Task A5 (2026-09-17 confirmation-collision-fix plan): confirmation
  // needs a stricter bar than matching. Two DIFFERENT real places sharing
  // one common neighborhood/historical-figure word (e.g. "Recoleta",
  // "Güemes") both legitimately clear the default >=50% bar on that one
  // shared token alone -- fine for finding a matching CANDIDATE (matching
  // must stay permissive for real translation/substring cases), but wrong
  // for INDEPENDENTLY CONFIRMING one, where a false "yes" is exactly the
  // failure this whole cross-source confirmation mechanism exists to
  // prevent. requireAllTokens raises the bar to 100% of the needle's
  // significant tokens for that caller only -- every existing caller
  // (omitting this option) is completely unaffected. A single-token
  // needle is unaffected either way: 1/1 already equals both 50% and 100%.
  //
  // Known, accepted trade-off (confirmation-collision-fix plan, final
  // review): this bar is intentionally language-blind. A genuine
  // cross-language/translation confirmation (e.g. a Spanish OSM/Wikidata
  // name vs. an English hint, or vice versa) sharing fewer than 100% of
  // tokens will now correctly be refused as UNCONFIRMED_MATCH rather than
  // confirmed -- an honest loss, not a bug. This is deliberate: the
  // fail-closed direction is the one this whole mechanism exists to
  // protect, and loosening this bar to recover cross-language confirmation
  // would reopen the exact same-token collision (e.g. "Recoleta") this
  // plan was written to close. Do not "fix" this by relaxing
  // requireAllTokens.
  options?: { requireAllTokens?: boolean },
): boolean {
  if (haystack === needle) return true;

  const needleTokens = needle.split(' ').filter((token) => token.length >= 4);
  if (needleTokens.length === 0) return false;

  const haystackTokens = new Set(haystack.split(' ').filter(Boolean));
  const matchedTokens = needleTokens.filter((token) =>
    haystackTokens.has(token),
  );
  const requiredRatio = options?.requireAllTokens ? 1 : 0.5;
  return (
    matchedTokens.length / needleTokens.length >= requiredRatio &&
    matchedTokens.some((token) => token.length >= 5)
  );
}

/**
 * An exact match anywhere in the pool always wins over a fuzzy (token-
 * overlap) one, even when the fuzzy match appears earlier in pool order.
 * Without this, a naive `.find()` over `hasSpecificNameOverlap` can return
 * the WRONG entry: two pool candidates sharing one generic token (e.g.
 * "Venue 000" and "Venue 007" both reduce to the single significant token
 * "venue" once the distinguishing digits are filtered out by the <4-char
 * token-length floor) let the first one found silently steal a hint whose
 * exact match was a later pool entry (real regression, Task A3
 * characterization: bulk-numbered venue names from a large candidate
 * batch).
 */
/**
 * P0.2: how many items in `items` have a name that EXACTLY equals `name`
 * once normalized -- the same "is there real ambiguity in this pool"
 * question for every source (OSM pool / Nominatim results / Places
 * results), each with its own exactness definition passed in as
 * `getName`. Selection functions (`matchOsmCandidateByName`,
 * `selectBestPlaceCandidate`, `bestNominatimMatch`) still pick ONE
 * candidate to try when this is > 1 -- this only tells the caller whether
 * that pick came from an unambiguous pool (count === 1, exact match alone
 * remains strong evidence) or an ambiguous one (count > 1, `IdentityVerifier`
 * must require independent evidence beyond the name match itself).
 */
export function countExactNormalizedMatches<T>(
  name: string,
  items: readonly T[],
  getName: (item: T) => string | undefined,
): number {
  const needle = normalizeGeoName(name);
  if (!needle) return 0;
  return items.filter(
    (item) => normalizeGeoName(getName(item) ?? '') === needle,
  ).length;
}

/**
 * Same as `countExactNormalizedMatches`, using the SAME broader "exact"
 * definition `bestNominatimMatch`'s own exact bucket uses (the whole
 * normalized `displayName` equals or starts with `needle + ' '`, not just
 * its first comma-separated segment) -- so this count never diverges from
 * what `bestNominatimMatch` itself actually considered exact.
 */
export function countNominatimExactMatches(
  name: string,
  results: readonly NominatimResult[],
): number {
  const needle = normalizeGeoName(name);
  if (!needle) return 0;
  return results.filter((result) => {
    const display = normalizeGeoName(result.displayName);
    return display === needle || display.startsWith(`${needle} `);
  }).length;
}

/**
 * Canonical mapping from candidate-match count to identity multiplicity.
 * Use this everywhere an acquisition source legitimately has an
 * identity-capable candidate set (e.g. Nominatim results, Places results,
 * local OSM pool for PLACE/AREA). Raw OSM ROUTE ways MUST NOT use this.
 *   0 -> UNKNOWN
 *   1 -> SINGLE
 *   >1 -> MULTIPLE
 */
export function candidateMatchCountToMultiplicity(
  count: number,
): 'SINGLE' | 'MULTIPLE' | 'UNKNOWN' {
  if (count === 1) return 'SINGLE';
  if (count > 1) return 'MULTIPLE';
  return 'UNKNOWN';
}

/**
 * @deprecated Use candidateMatchCountToMultiplicity instead.
 * Kept for backward compatibility during migration.
 */
export const exactMatchCountToMultiplicity = candidateMatchCountToMultiplicity;

/**
 * Counts how many candidates in the pool have an OWN declared alias that matches
 * the hint name according to the canonical alias-match policy (hasSpecificNameOverlap
 * with requireAllTokens: true). This is the canonical way to establish alias multiplicity.
 *
 * Use this only for legitimate identity-capable candidate pools (e.g., local OSM PLACE pool).
 * Raw OSM ROUTE ways MUST NOT use this.
 *   0 -> UNKNOWN
 *   1 -> SINGLE
 *   >1 -> MULTIPLE
 */
export function countAliasMatches(
  hintName: string,
  pool: Array<{
    tags?: Record<string, string>;
    nameAliasCandidates?: string[];
  }>,
): number {
  const needle = normalizeGeoName(hintName);
  if (!needle) return 0;
  return pool.filter((candidate) => {
    // Extract aliases from tags if available, otherwise use pre-extracted nameAliasCandidates
    const aliases =
      candidate.nameAliasCandidates ?? extractAliasesFromTags(candidate.tags);
    return aliases.some((alias) =>
      hasSpecificNameOverlap(needle, normalizeGeoName(alias), {
        requireAllTokens: true,
      }),
    );
  }).length;
}

/**
 * Extracts alias candidates from OSM tags.
 * Uses the same logic as extractNameAliasCandidates but returns just the strings.
 */
function extractAliasesFromTags(tags?: Record<string, string>): string[] {
  if (!tags) return [];
  const candidates: string[] = [];
  const NAME_ALIAS_TAG_KEYS = new Set([
    'official_name',
    'alt_name',
    'short_name',
    'loc_name',
  ]);
  for (const [key, value] of Object.entries(tags)) {
    if (!value) continue;
    if (key.startsWith('name:') || NAME_ALIAS_TAG_KEYS.has(key)) {
      for (const part of value.split(';')) {
        const trimmed = part.trim();
        if (trimmed) candidates.push(trimmed);
      }
    }
  }
  const wikipediaTag = tags.wikipedia?.trim();
  if (wikipediaTag) {
    const separatorIndex = wikipediaTag.indexOf(':');
    const title =
      separatorIndex > 0
        ? wikipediaTag.slice(separatorIndex + 1).trim()
        : wikipediaTag;
    if (title) candidates.push(title);
  }
  return candidates.length > 0 ? candidates : [];
}

export function matchOsmCandidateByName(
  name: string,
  pool: OsmCandidate[],
  addressHint?: string,
): OsmCandidate | undefined {
  const needle = normalizeGeoName(name);
  const exact = pool.find(
    (candidate) => normalizeGeoName(candidate.name) === needle,
  );
  if (exact) return exact;

  const fuzzyMatches = pool.filter((candidate) =>
    hasSpecificNameOverlap(needle, normalizeGeoName(candidate.name)),
  );
  if (fuzzyMatches.length <= 1) return fuzzyMatches[0];
  return bestFuzzyMatch(needle, fuzzyMatches, addressHint);
}

/**
 * A real street address either matches or it doesn't -- unlike fuzzy
 * name-token overlap, there's no "50% similar" for an exact housenumber.
 * Only trusts a candidate's OWN `addr:housenumber`/`addr:street` tags (a
 * direct declaration by the same real record, same trust tier as its own
 * `name`), never a guess or a nearby address. Requires an exact
 * housenumber match (extracted as the first standalone number in the
 * hint) AND at least the default name-token overlap on the street name
 * (not strict -- street names legitimately vary by abbreviation, e.g.
 * "Av." vs "Avenida").
 */
/**
 * The housenumber is the LAST standalone number in the part of the
 * address before its first comma -- real regression: a street NAME can
 * itself contain a number (e.g. "Avenida 9 de Julio"), so taking the
 * FIRST number in the whole string mistook "9" for the housenumber
 * instead of the real "1234" in "Avenida 9 de Julio 1234". Stopping at
 * the first comma also keeps a trailing postal code (e.g. "..., C1107
 * Cdad. Autónoma de Buenos Aires") from ever being mistaken for one --
 * Argentine addresses conventionally put the housenumber right after the
 * street name, before any comma-separated locality/postal segment.
 */
function extractHousenumberToken(addressHint: string): string | undefined {
  const streetSegment = addressHint.split(',')[0];
  const matches = streetSegment.match(/\d{1,6}/g);
  return matches?.[matches.length - 1];
}

export function matchesAddressHint(
  addressHint: string | undefined,
  tags: Record<string, string> | undefined,
): boolean {
  if (!addressHint || !tags) return false;
  const street = tags['addr:street'];
  const housenumber = tags['addr:housenumber']?.trim();
  if (!street || !housenumber) return false;
  const hintHousenumber = extractHousenumberToken(addressHint);
  if (!hintHousenumber || hintHousenumber !== housenumber) return false;
  return hasSpecificNameOverlap(
    normalizeGeoName(addressHint),
    normalizeGeoName(street),
  );
}

/**
 * Same "best in the whole pool, not first found" discipline the exact-match
 * branch above already applies, extended to the fuzzy branch -- real
 * regression: several real, unrelated OSM nodes sharing one generic token
 * with the hint (e.g. bare transit-stop nodes all named "Catedral" near the
 * real "Catedral Metropolitana" building) let the FIRST one in Overpass's
 * arbitrary result order silently steal a hint whose better real match sat
 * later in the same pool. Prefers, in order: a real address-hint match
 * (the strongest, most specific signal available -- an address is either
 * right or wrong, never approximately right), then more of the hint's
 * significant tokens matched, then a candidate carrying its own
 * `wikidata` tag (a real cross-reference, not a guess) over one without.
 * A full tie keeps the first candidate found -- stable and deterministic,
 * never an arbitrary reorder.
 */
function bestFuzzyMatch(
  needle: string,
  candidates: OsmCandidate[],
  addressHint?: string,
): OsmCandidate {
  const needleTokens = needle.split(' ').filter((token) => token.length >= 4);
  let best = candidates[0];
  let bestMatchedCount = matchedTokenCount(needleTokens, best);
  let bestHasWikidataTag = Boolean(best.tags?.wikidata?.trim());
  let bestHasAddressMatch = matchesAddressHint(addressHint, best.tags);

  for (const candidate of candidates.slice(1)) {
    const hasAddressMatch = matchesAddressHint(addressHint, candidate.tags);
    if (hasAddressMatch && !bestHasAddressMatch) {
      best = candidate;
      bestHasAddressMatch = true;
      bestMatchedCount = matchedTokenCount(needleTokens, candidate);
      bestHasWikidataTag = Boolean(candidate.tags?.wikidata?.trim());
      continue;
    }
    if (bestHasAddressMatch && !hasAddressMatch) continue;

    const matchedCount = matchedTokenCount(needleTokens, candidate);
    if (matchedCount > bestMatchedCount) {
      best = candidate;
      bestMatchedCount = matchedCount;
      bestHasWikidataTag = Boolean(candidate.tags?.wikidata?.trim());
      continue;
    }
    if (matchedCount < bestMatchedCount) continue;

    const hasWikidataTag = Boolean(candidate.tags?.wikidata?.trim());
    if (hasWikidataTag && !bestHasWikidataTag) {
      best = candidate;
      bestHasWikidataTag = true;
    }
  }
  return best;
}

function matchedTokenCount(
  needleTokens: string[],
  candidate: OsmCandidate,
): number {
  const haystackTokens = new Set(
    normalizeGeoName(candidate.name).split(' ').filter(Boolean),
  );
  return needleTokens.filter((token) => haystackTokens.has(token)).length;
}
