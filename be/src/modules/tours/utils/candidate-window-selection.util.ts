import { RankableCandidate, RankedCandidate } from './candidate-ranking.util';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from './experience-format-kind.util';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';

// PR 9: a plain sortBy(score).slice(0, N) over a ranked pool can legitimately
// drop every candidate of a requested experience format when enough
// higher-scoring POIs exist — the LLM is then never offered a format the
// user explicitly asked for, and PR 7.4's format-coverage validator can't
// catch it (the model was never given the option). This module reserves
// window slots for requested formats and caps near-duplicate family
// variants before filling the remainder by plain rank — see
// docs/superpowers/plans/2026-08-21-activity-engine-quality-discovery-mobility.md,
// "PR 9: Unified candidate pool", "FORMAT-AWARE BOUNDED WINDOW" /
// "FAMILY / VARIANT HANDLING".

/** At most this many variants of the same ActivityFamily enter one window — avoids flooding it with near-identical composite variants. Centralized/named/documented per the plan's weight-hygiene rule. */
export const MAX_VARIANTS_PER_FAMILY = 1;
// "reserve at least one or more top candidates... when available" — one is
// the minimum that satisfies the rule without crowding out other requested
// formats sharing the same bounded window.
const RESERVED_PER_REQUESTED_FORMAT = 1;

export interface FormatAvailability {
  format: ExperienceFormat;
  /** How many real candidates of this format exist in the full ranked pool, before windowing. */
  fullPoolCount: number;
  /** How many made it into the bounded window actually offered to the LLM. */
  llmWindowCount: number;
}

export interface WindowSelectionResult<T extends RankableCandidate> {
  window: RankedCandidate<T>[];
  formatAvailability: FormatAvailability[];
  droppedForFamilyCapCount: number;
}

/**
 * Builds the bounded candidate window offered to the itinerary LLM from an
 * already-ranked full pool (descending relevance, as returned by
 * `rankCandidatesByRelevance`). Reserves top slots for every requested
 * experience format that has real matches, caps repeated family variants,
 * then fills remaining slots by plain rank order. Never invents or
 * reorders candidates beyond selecting a subset — every entry in `window`
 * is a real candidate already present in `rankedFull`.
 */
export function selectBoundedWindow<
  T extends RankableCandidate & { familyId?: string | null },
>(
  rankedFull: RankedCandidate<T>[],
  requestedExperienceFormats: ExperienceFormat[],
  maxWindowSize: number,
): WindowSelectionResult<T> {
  const windowIds = new Set<string>();
  const window: RankedCandidate<T>[] = [];
  const familyCounts = new Map<string, number>();
  let droppedForFamilyCapCount = 0;

  const canAdd = (candidate: T): boolean =>
    !candidate.familyId ||
    (familyCounts.get(candidate.familyId) ?? 0) < MAX_VARIANTS_PER_FAMILY;

  const add = (ranked: RankedCandidate<T>): void => {
    window.push(ranked);
    windowIds.add(ranked.candidate.id);
    if (ranked.candidate.familyId) {
      familyCounts.set(
        ranked.candidate.familyId,
        (familyCounts.get(ranked.candidate.familyId) ?? 0) + 1,
      );
    }
  };

  // 1. Reserve top candidate(s) per requested format. rankedFull is already
  //    sorted by relevance, so "top" is just "first N matches of that kind".
  const formatAvailability: FormatAvailability[] =
    requestedExperienceFormats.map((format) => {
      const kind = EXPERIENCE_FORMAT_ACTIVITY_KIND[format];
      const matches = kind
        ? rankedFull.filter((ranked) => ranked.candidate.kind === kind)
        : [];

      let reserved = 0;
      for (const ranked of matches) {
        if (
          reserved >= RESERVED_PER_REQUESTED_FORMAT ||
          window.length >= maxWindowSize
        ) {
          break;
        }
        if (windowIds.has(ranked.candidate.id)) {
          reserved++;
          continue;
        }
        if (!canAdd(ranked.candidate)) continue;
        add(ranked);
        reserved++;
      }

      // llmWindowCount is finalized in step 3, once the window is complete —
      // a later requested format's reservation, or the fill pass, can still
      // add more candidates of this same kind.
      return { format, fullPoolCount: matches.length, llmWindowCount: 0 };
    });

  // 2. Fill remaining slots from the global ranking.
  for (const ranked of rankedFull) {
    if (window.length >= maxWindowSize) break;
    if (windowIds.has(ranked.candidate.id)) continue;
    if (!canAdd(ranked.candidate)) {
      droppedForFamilyCapCount++;
      continue;
    }
    add(ranked);
  }

  // 3. Now that the window is final, compute the real per-format counts.
  for (const availability of formatAvailability) {
    const kind = EXPERIENCE_FORMAT_ACTIVITY_KIND[availability.format];
    availability.llmWindowCount = kind
      ? window.filter((ranked) => ranked.candidate.kind === kind).length
      : 0;
  }

  return { window, formatAvailability, droppedForFamilyCapCount };
}
