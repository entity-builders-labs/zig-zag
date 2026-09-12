/**
 * Evidence-backed exploration signals (spec §10.2, plan Task A7).
 *
 * `PreferenceSpec.explorationStyle` (`'iconic' | 'local_deep_dive' |
 * 'balanced'`) is a traveler-side meta-preference -- never a facet, never a
 * categorical property persisted on an Experience. This module models three
 * INDEPENDENT evidence-backed signals about an Experience instead of one
 * opaque `iconicity` scalar:
 *
 *   low prominence      != local character
 *   high prominence     != low quality
 *   unknown              != zero
 *   local_deep_dive tilt != 1 - prominence
 *
 * Phase-7 population boundary (spec §10.2.4, plan A7.6): `prominence` is
 * expected to be the only signal commonly computable from today's
 * catalog/source metadata. `tourismIntensity` and `localCharacter` are
 * intentionally forward-compatible plumbing for the later agentic/research
 * stage and may legitimately stay `value: null` for most Experiences right
 * now -- this module does not own discovery of that evidence and must never
 * invent a proxy merely to make them non-null. Traveler free text ("quiero
 * turismo local", "joyas escondidas") expresses a REQUEST-side ranking
 * preference, never Experience-side evidence; `ExplorationSignalInput` has
 * no field for it, so nothing outside its defined shape can ever reach these
 * signals.
 *
 * Architectural boundary (plan A7.9): no provider calls, no LLM calls, no
 * embeddings, no acquisition, no PostGIS/Prisma, no live orchestration
 * wiring, no effect on facet matching/strong-weak/sufficiency/acquisition.
 * This is ranking context only, consumed later by Checkpoint C.
 */

export interface ExplorationSignalEvidence {
  source: string;
  key: string;
  value?: string | number | boolean;
}

export interface EvidenceBackedExplorationSignal {
  /** Normalized 0..1 when known; `null` means insufficient grounded evidence -- never coerced to 0. */
  value: number | null;
  /** Normalized 0..1. May be > 0 even when value is null in principle, but this module always emits 0 for unknown. */
  confidence: number;
  evidence: ExplorationSignalEvidence[];
  reasonCodes: string[];
}

export interface ExplorationSignals {
  prominence: EvidenceBackedExplorationSignal;
  tourismIntensity: EvidenceBackedExplorationSignal;
  localCharacter: EvidenceBackedExplorationSignal;
}

export interface ExplorationSignalInput {
  placesReviewCount?: number | null;
  wikidataSitelinkCount?: number | null;
  wikipediaPresent?: boolean | null;
  wikivoyageListed?: boolean | null;
  heritageOrLandmark?: boolean | null;

  /** Forward-compatible plumbing for later agentic/research evidence (plan A7.6). */
  explicitTourismIntensityEvidence?: Array<{
    strength: number;
    evidenceKey: string;
    source: string;
  }>;

  /** Forward-compatible plumbing for later agentic/research evidence (plan A7.6). */
  explicitLocalCharacterEvidence?: Array<{
    strength: number;
    evidenceKey: string;
    source: string;
  }>;
}

// -- Reason codes (stable, engineering-facing identifiers) ------------------

const REASON_NO_PROMINENCE_EVIDENCE = 'no_prominence_evidence';
const REASON_REVIEW_COUNT = 'review_count_saturating';
const REASON_WIKIDATA_SITELINKS = 'wikidata_sitelink_count_saturating';
const REASON_WIKIPEDIA_PRESENT = 'wikipedia_present';
const REASON_WIKIVOYAGE_LISTED = 'wikivoyage_listed';
const REASON_HERITAGE_LANDMARK = 'heritage_or_landmark_modest_bonus';

const REASON_NO_EXPLICIT_TOURISM_EVIDENCE =
  'no_explicit_tourism_intensity_evidence';
const REASON_EXPLICIT_TOURISM_EVIDENCE = 'explicit_tourism_intensity_evidence';

const REASON_NO_EXPLICIT_LOCAL_EVIDENCE =
  'no_explicit_local_character_evidence';
const REASON_EXPLICIT_LOCAL_EVIDENCE = 'explicit_local_character_evidence';

const REASON_ICONIC_PROMINENCE_BONUS = 'iconic_prominence_bonus';
const REASON_ICONIC_PROMINENCE_UNKNOWN_NEUTRAL =
  'iconic_prominence_unknown_neutral';
const REASON_LOCAL_DEEP_DIVE_LOCAL_CHARACTER_BONUS =
  'local_deep_dive_local_character_bonus';
const REASON_LOCAL_DEEP_DIVE_LOCAL_CHARACTER_UNKNOWN_NEUTRAL =
  'local_deep_dive_local_character_unknown_neutral';
const REASON_LOCAL_DEEP_DIVE_TOURISM_INTENSITY_PENALTY =
  'local_deep_dive_tourism_intensity_penalty';
const REASON_LOCAL_DEEP_DIVE_TOURISM_INTENSITY_UNKNOWN_NEUTRAL =
  'local_deep_dive_tourism_intensity_unknown_neutral';

// -- Named policy constants ---------------------------------------------

/** Weighted contribution of the review-count signal toward prominence. */
const REVIEW_COUNT_WEIGHT = 0.5;
/** Saturation cap: counts near/beyond this move the score very little further. */
const REVIEW_COUNT_SATURATION_CAP = 500_000;

/** Weighted contribution of the Wikidata-sitelink signal toward prominence. */
const SITELINK_WEIGHT = 0.3;
const SITELINK_SATURATION_CAP = 300;

/** Modest fixed bonuses -- presence alone must never force a near-1 score. */
const WIKIPEDIA_PRESENT_BONUS = 0.1;
const WIKIVOYAGE_LISTED_BONUS = 0.1;
const HERITAGE_OR_LANDMARK_BONUS = 0.05;

/** Total independent prominence sources, for a simple deterministic confidence. */
const PROMINENCE_SOURCE_COUNT = 5;

/** Exploration-tilt weights (relative magnitudes only; ranking-only signal). */
const ICONIC_PROMINENCE_TILT_WEIGHT = 1.0;
const LOCAL_DEEP_DIVE_LOCAL_CHARACTER_TILT_WEIGHT = 1.0;
const LOCAL_DEEP_DIVE_TOURISM_INTENSITY_PENALTY_WEIGHT = 0.5;

// -- Sanitization helpers -------------------------------------------------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A grounded, usable non-negative finite count (0 counts as real evidence: "zero reviews" is still a fact). */
function isValidNonNegativeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A grounded, usable strength in the canonical 0..1 scale. */
function isValidStrength(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/** Saturating log-like normalization: unbounded counts compress toward 1 near `cap`. */
function logSaturating(count: number, cap: number): number {
  if (count <= 0) return 0;
  return clamp01(Math.log10(1 + count) / Math.log10(1 + cap));
}

// -- Prominence ------------------------------------------------------------

function computeProminence(
  input: ExplorationSignalInput,
): EvidenceBackedExplorationSignal {
  const evidence: ExplorationSignalEvidence[] = [];
  const reasonCodes: string[] = [];
  let score = 0;
  let sourceCount = 0;

  if (isValidNonNegativeCount(input.placesReviewCount)) {
    const contribution =
      REVIEW_COUNT_WEIGHT *
      logSaturating(input.placesReviewCount, REVIEW_COUNT_SATURATION_CAP);
    score += contribution;
    sourceCount += 1;
    evidence.push({
      source: 'google_places',
      key: 'review_count',
      value: input.placesReviewCount,
    });
    reasonCodes.push(REASON_REVIEW_COUNT);
  }

  if (isValidNonNegativeCount(input.wikidataSitelinkCount)) {
    const contribution =
      SITELINK_WEIGHT *
      logSaturating(input.wikidataSitelinkCount, SITELINK_SATURATION_CAP);
    score += contribution;
    sourceCount += 1;
    evidence.push({
      source: 'wikidata',
      key: 'sitelink_count',
      value: input.wikidataSitelinkCount,
    });
    reasonCodes.push(REASON_WIKIDATA_SITELINKS);
  }

  if (input.wikipediaPresent === true) {
    score += WIKIPEDIA_PRESENT_BONUS;
    sourceCount += 1;
    evidence.push({ source: 'wikipedia', key: 'present', value: true });
    reasonCodes.push(REASON_WIKIPEDIA_PRESENT);
  }

  if (input.wikivoyageListed === true) {
    score += WIKIVOYAGE_LISTED_BONUS;
    sourceCount += 1;
    evidence.push({ source: 'wikivoyage', key: 'listed', value: true });
    reasonCodes.push(REASON_WIKIVOYAGE_LISTED);
  }

  if (input.heritageOrLandmark === true) {
    score += HERITAGE_OR_LANDMARK_BONUS;
    sourceCount += 1;
    evidence.push({ source: 'heritage', key: 'landmark', value: true });
    reasonCodes.push(REASON_HERITAGE_LANDMARK);
  }

  if (sourceCount === 0) {
    return {
      value: null,
      confidence: 0,
      evidence: [],
      reasonCodes: [REASON_NO_PROMINENCE_EVIDENCE],
    };
  }

  return {
    value: clamp01(score),
    confidence: clamp01(sourceCount / PROMINENCE_SOURCE_COUNT),
    evidence,
    reasonCodes,
  };
}

// -- Explicit-evidence-only signals (tourismIntensity / localCharacter) ---

function computeExplicitEvidenceSignal(
  entries:
    | Array<{ strength: number; evidenceKey: string; source: string }>
    | undefined,
  emptyReasonCode: string,
  presentReasonCode: string,
): EvidenceBackedExplorationSignal {
  const validEntries = (entries ?? []).filter((entry) =>
    isValidStrength(entry?.strength),
  );

  if (validEntries.length === 0) {
    return {
      value: null,
      confidence: 0,
      evidence: [],
      reasonCodes: [emptyReasonCode],
    };
  }

  const meanStrength =
    validEntries.reduce((sum, entry) => sum + entry.strength, 0) /
    validEntries.length;

  return {
    value: clamp01(meanStrength),
    // A single corroborating claim is already meaningful (this is explicit
    // grounded evidence, not an inferred proxy), but more independent
    // entries raise confidence, capped at 1.
    confidence: clamp01(validEntries.length / 3),
    evidence: validEntries.map((entry) => ({
      source: entry.source,
      key: entry.evidenceKey,
      value: entry.strength,
    })),
    reasonCodes: [presentReasonCode],
  };
}

// -- Public API -------------------------------------------------------------

export function computeExplorationSignals(
  input: ExplorationSignalInput,
): ExplorationSignals {
  return {
    prominence: computeProminence(input),
    tourismIntensity: computeExplicitEvidenceSignal(
      input.explicitTourismIntensityEvidence,
      REASON_NO_EXPLICIT_TOURISM_EVIDENCE,
      REASON_EXPLICIT_TOURISM_EVIDENCE,
    ),
    localCharacter: computeExplicitEvidenceSignal(
      input.explicitLocalCharacterEvidence,
      REASON_NO_EXPLICIT_LOCAL_EVIDENCE,
      REASON_EXPLICIT_LOCAL_EVIDENCE,
    ),
  };
}

export interface ExplorationTilt {
  score: number;
  contributions: Array<{
    signal: 'prominence' | 'tourismIntensity' | 'localCharacter';
    contribution: number;
    reasonCode: string;
  }>;
}

/**
 * Pure, deterministic ranking-only projection of the traveler's
 * `explorationStyle` meta-preference over already-computed
 * `ExplorationSignals`. Never a hard filter, never coverage/sufficiency
 * input -- Checkpoint C consumes this as one ranking tilt among several.
 */
export function computeExplorationTilt(
  style: 'iconic' | 'local_deep_dive' | 'balanced',
  signals: ExplorationSignals,
): ExplorationTilt {
  if (style === 'balanced') {
    return { score: 0, contributions: [] };
  }

  if (style === 'iconic') {
    const known = signals.prominence.value !== null;
    const contribution = known
      ? ICONIC_PROMINENCE_TILT_WEIGHT * signals.prominence.value!
      : 0;
    return {
      score: contribution,
      contributions: [
        {
          signal: 'prominence',
          contribution,
          reasonCode: known
            ? REASON_ICONIC_PROMINENCE_BONUS
            : REASON_ICONIC_PROMINENCE_UNKNOWN_NEUTRAL,
        },
      ],
    };
  }

  // local_deep_dive: localCharacter contributes positively; tourismIntensity
  // moderates/penalizes. Prominence NEVER contributes here directly -- low
  // or unknown prominence by itself gives no bonus (never `1 - prominence`).
  const knownLocalCharacter = signals.localCharacter.value !== null;
  const localCharacterContribution = knownLocalCharacter
    ? LOCAL_DEEP_DIVE_LOCAL_CHARACTER_TILT_WEIGHT *
      signals.localCharacter.value!
    : 0;

  const knownTourismIntensity = signals.tourismIntensity.value !== null;
  const tourismIntensityContribution = knownTourismIntensity
    ? -LOCAL_DEEP_DIVE_TOURISM_INTENSITY_PENALTY_WEIGHT *
      signals.tourismIntensity.value!
    : 0;

  return {
    score: localCharacterContribution + tourismIntensityContribution,
    contributions: [
      {
        signal: 'localCharacter',
        contribution: localCharacterContribution,
        reasonCode: knownLocalCharacter
          ? REASON_LOCAL_DEEP_DIVE_LOCAL_CHARACTER_BONUS
          : REASON_LOCAL_DEEP_DIVE_LOCAL_CHARACTER_UNKNOWN_NEUTRAL,
      },
      {
        signal: 'tourismIntensity',
        contribution: tourismIntensityContribution,
        reasonCode: knownTourismIntensity
          ? REASON_LOCAL_DEEP_DIVE_TOURISM_INTENSITY_PENALTY
          : REASON_LOCAL_DEEP_DIVE_TOURISM_INTENSITY_UNKNOWN_NEUTRAL,
      },
    ],
  };
}
