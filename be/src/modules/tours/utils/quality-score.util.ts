/**
 * Provider-neutral quality score (spec §10.1, plan Task B3, amended by
 * `docs/superpowers/plans/2026-09-12-b3-provider-neutral-quality-scoring-amendment.md`
 * / `docs/superpowers/specs/2026-09-12-provider-neutral-quality-scoring-clarification.md`).
 *
 * `computeQualityScore` derives one deterministic `0..5 | null` score from
 * whatever grounded quality evidence is actually available. It is a pure,
 * provider-neutral function: it consumes a normalized `QualityScoreInput`,
 * never an `IPlacesApiService`/`PLACES_PROVIDER` object, and never branches
 * on which provider produced the evidence.
 *
 * Hard invariants:
 * - Missing capability is UNKNOWN, never a negative signal. Geoapify
 *   intentionally leaves `PlaceData.rating`/`userRatingCount` unset --
 *   `undefined` there must never read as "rating 0" / "zero reviews as a
 *   popularity fact" / a quality penalty.
 * - No source is individually mandatory; a missing signal must never erase
 *   a valid signal from another source (each contributes independently).
 * - A multi-component Experience must never receive a flat/magic route
 *   score -- its quality tracks its actual resolved-component evidence.
 * - Zero usable grounded signals anywhere -> `null` (unknown), never a
 *   synthetic default.
 *
 * Architectural boundary: no provider calls (Google/Geoapify/Wikivoyage/
 * Wikidata), no agentic/research calls, no LLM-authored fallback rating, no
 * `PLACES_PROVIDER` inspection, no facet-matching/strong-weak changes
 * beyond the already-defined `DEFAULT_QUALITY_FLOOR` in
 * `preference-strong-match.util.ts` (deliberately not imported here -- this
 * module only produces the raw score, the floor comparison is that other
 * module's concern). Not wired into acquisition/persistence yet (B4's job).
 */

export interface QualityScoreInput {
  /** 0..5 star rating from the active Places provider, when it supplies one. */
  placesRating?: number | null;
  /** Review count backing `placesRating`, when the provider supplies one. */
  placesReviewCount?: number | null;
  /** Whether the Experience has a Wikivoyage listing. */
  wikivoyageListed?: boolean | null;
  /** Wikidata sitelink count (a real, measurable notability signal). */
  wikidataSitelinkCount?: number | null;
  /** Per-resolved-component quality (0..5), for a multi-component Experience. `null` entries mean "no signal for that component", never 0. */
  componentQualityScores?: Array<number | null>;
  /** Per-resolved-component notability counts (e.g. sitelink-like), as an alternative to a direct component quality score. */
  componentNotabilitySignals?: number[];
}

// -- Named policy constants --------------------------------------------

/** Relative weight of each independently-present signal in the final blend. */
const PLACES_WEIGHT = 1.0;
const WIKIVOYAGE_WEIGHT = 0.6;
const WIKIDATA_WEIGHT = 0.6;
const COMPONENT_DERIVED_WEIGHT = 0.8;

/**
 * Neutral shrinkage target (midpoint of the 0..5 scale) for a Places rating
 * backed by few/zero reviews -- a rating with low review-count confidence
 * is pulled toward this prior rather than trusted at face value.
 */
const QUALITY_NEUTRAL_PRIOR = 2.5;
/** Review counts near/beyond this saturate confidence toward 1. */
const REVIEW_COUNT_CONFIDENCE_SATURATION_CAP = 1000;

/** Fixed quality value contributed by a Wikivoyage listing alone. */
const WIKIVOYAGE_LISTED_QUALITY = 3.5;

/** Sitelink-count-derived quality band (used for both the standalone Wikidata signal and componentNotabilitySignals entries). */
const WIKIDATA_SITELINK_QUALITY_FLOOR = 2.5;
const WIKIDATA_SITELINK_QUALITY_CEILING = 4.5;
const WIKIDATA_SITELINK_SATURATION_CAP = 300;

// -- Sanitization helpers -------------------------------------------------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp05(value: number): number {
  return Math.min(5, Math.max(0, value));
}

/** A grounded, usable 0..5 rating -- never coerced from a malformed value. */
function isValidRating(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 5
  );
}

/** A grounded, usable non-negative count (0 counts as real evidence). */
function isValidNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Saturating log-like normalization: unbounded counts compress toward 1 near `cap`. */
function logSaturating(count: number, cap: number): number {
  if (count <= 0) return 0;
  return clamp01(Math.log10(1 + count) / Math.log10(1 + cap));
}

/** Maps a non-negative notability-style count into the shared Wikidata quality band. */
function notabilityCountToQuality(count: number): number {
  const saturation = logSaturating(count, WIKIDATA_SITELINK_SATURATION_CAP);
  return (
    WIKIDATA_SITELINK_QUALITY_FLOOR +
    (WIKIDATA_SITELINK_QUALITY_CEILING - WIKIDATA_SITELINK_QUALITY_FLOOR) *
      saturation
  );
}

// -- Per-signal components -------------------------------------------------

/**
 * Places rating + review-count confidence. Only contributes when a valid
 * rating is present. When the review count is genuinely absent (not just
 * zero), the raw rating is trusted as-is -- review-count confidence is an
 * OPTIONAL modifier, not a mandatory input. When present, it applies a
 * Bayesian-style shrinkage toward a neutral prior: low confidence (few or
 * zero reviews) pulls the rating toward the prior; high confidence (many
 * reviews) trusts the raw rating. This is what makes "same rating, many
 * reviews" score higher than "same rating, two reviews" for any rating
 * above the neutral prior.
 */
function computePlacesComponent(input: QualityScoreInput): number | null {
  if (!isValidRating(input.placesRating)) return null;
  const rating = input.placesRating;

  if (!isValidNonNegativeNumber(input.placesReviewCount)) {
    return rating;
  }

  const confidence = logSaturating(
    input.placesReviewCount,
    REVIEW_COUNT_CONFIDENCE_SATURATION_CAP,
  );
  return rating * confidence + QUALITY_NEUTRAL_PRIOR * (1 - confidence);
}

function computeWikivoyageComponent(input: QualityScoreInput): number | null {
  return input.wikivoyageListed === true ? WIKIVOYAGE_LISTED_QUALITY : null;
}

function computeWikidataComponent(input: QualityScoreInput): number | null {
  if (!isValidNonNegativeNumber(input.wikidataSitelinkCount)) return null;
  return notabilityCountToQuality(input.wikidataSitelinkCount);
}

/**
 * Component-derived quality for a multi-component Experience with no
 * direct rating of its own. Combines whichever of `componentQualityScores`
 * (direct per-component quality) and `componentNotabilitySignals`
 * (per-component notability counts, mapped through the same notability
 * band as the standalone Wikidata signal) are present into one robust mean
 * -- never a flat magic route score. Malformed/non-numeric entries are
 * silently dropped, never thrown on and never coerced.
 */
function computeComponentDerivedQuality(
  input: QualityScoreInput,
): number | null {
  const fromScores = (
    Array.isArray(input.componentQualityScores)
      ? input.componentQualityScores
      : []
  ).filter(isValidRating);

  const fromNotability = (
    Array.isArray(input.componentNotabilitySignals)
      ? input.componentNotabilitySignals
      : []
  )
    .filter(isValidNonNegativeNumber)
    .map(notabilityCountToQuality);

  const all = [...fromScores, ...fromNotability];
  if (all.length === 0) return null;

  return all.reduce((sum, value) => sum + value, 0) / all.length;
}

/**
 * Deterministic aggregation of every independently-available grounded
 * quality signal into one `0..5 | null` score. Each present signal
 * contributes a value + weight to a single weighted average; an absent
 * signal simply does not participate -- it never lowers or erases the
 * contribution of any other present signal. Returns `null` only when NO
 * signal produced a usable value.
 */
export function computeQualityScore(input: QualityScoreInput): number | null {
  if (!input || typeof input !== 'object') return null;

  const components: Array<{ value: number; weight: number }> = [];

  const places = computePlacesComponent(input);
  if (places !== null)
    components.push({ value: places, weight: PLACES_WEIGHT });

  const wikivoyage = computeWikivoyageComponent(input);
  if (wikivoyage !== null) {
    components.push({ value: wikivoyage, weight: WIKIVOYAGE_WEIGHT });
  }

  const wikidata = computeWikidataComponent(input);
  if (wikidata !== null) {
    components.push({ value: wikidata, weight: WIKIDATA_WEIGHT });
  }

  const componentDerived = computeComponentDerivedQuality(input);
  if (componentDerived !== null) {
    components.push({
      value: componentDerived,
      weight: COMPONENT_DERIVED_WEIGHT,
    });
  }

  if (components.length === 0) return null;

  const weightedSum = components.reduce(
    (sum, component) => sum + component.value * component.weight,
    0,
  );
  const totalWeight = components.reduce(
    (sum, component) => sum + component.weight,
    0,
  );
  return clamp05(weightedSum / totalWeight);
}
