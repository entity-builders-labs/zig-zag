import { TravelPace } from './tour-generation.interface';

export type TourCompletenessIssueCode =
  | 'UNDERFILLED_DAY'
  | 'UNMET_REQUESTED_FORMAT';

export interface UnderfilledDayIssue {
  code: 'UNDERFILLED_DAY';
  dayNumber: number;
  selectedExperienceCount: number;
  selectedExperienceHours: number;
  viableUnusedCandidateCount: number;
  travelPace: TravelPace;
  message: string;
}

/**
 * A requested soft facet (walk/route_like/day_trip/visit/...) that no
 * selected Experience in the final itinerary actually carries. First
 * version, deliberately simple: it does not yet distinguish "acquisition
 * never found a real candidate for this format" (CoverageAnalyzer's concern)
 * from "one existed in the offered pool but the solver didn't pick it" —
 * both produce the same user-visible symptom ("I asked for X and didn't get
 * it"), and this re-derives only from the final selected set, independent
 * of any earlier stage's own bookkeeping. Splitting the two causes apart is
 * a natural next iteration, not required for a first version.
 */
export interface UnmetRequestedFormatIssue {
  code: 'UNMET_REQUESTED_FORMAT';
  requestedIntent: string;
  message: string;
}

export type TourCompletenessIssue =
  | UnderfilledDayIssue
  | UnmetRequestedFormatIssue;

export interface TourCompletenessSelectedExperience {
  experienceId: string;
  dayNumber: number;
  durationHours: number;
  /** Activity.type === 'food' — the only structured meal signal available
   * at this stage; never inferred from the activity name. */
  isMeal: boolean;
  /** Soft Experience facets this selected Experience actually carries
   * (walk/route_like/day_trip/visit/...) — used only to check requested
   * formats were honored, never for scheduling. Optional for callers/tests
   * that predate this check. */
  intents?: string[];
}

export interface TourCompletenessInput {
  requestedDays: number;
  travelPace: TravelPace;
  /** True only when the whole request is food-centric (a single 'food'
   * interest), not merely when 'food' is one of several themes — see
   * TourCompletenessValidator for the exact heuristic and its rationale. */
  isFoodFocusedIntent: boolean;
  selectedExperiences: TourCompletenessSelectedExperience[];
  /** Offered-minus-selected candidates, global across the whole tour — not
   * per day. The system has no deterministic day assignment for unused
   * candidates yet (that's spatial/temporal feasibility, later work), so a
   * day is only ever cleared from "genuinely can't do more" using this
   * global count. */
  viableUnusedCandidateCount: number;
  /** Soft facets the user actually requested (wizard intents + LLM-derived
   * preferredIntents, unioned) — never structural planner/proposal kinds.
   * Optional/defaults to none checked, so existing callers/tests that
   * predate this check are unaffected. */
  requestedIntents?: string[];
}

export interface TourCompletenessResult {
  complete: boolean;
  issues: TourCompletenessIssue[];
}
