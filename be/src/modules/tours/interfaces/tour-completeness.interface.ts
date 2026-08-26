import { TravelPace } from './tour-generation.interface';

export type TourCompletenessIssueCode = 'UNDERFILLED_DAY';

export interface TourCompletenessIssue {
  code: TourCompletenessIssueCode;
  dayNumber: number;
  selectedActivityCount: number;
  selectedActivityHours: number;
  viableUnusedCandidateCount: number;
  travelPace: TravelPace;
  message: string;
}

export interface TourCompletenessSelectedActivity {
  activityId: string;
  dayNumber: number;
  durationHours: number;
  /** Activity.type === 'food' — the only structured meal signal available
   * at this stage; never inferred from the activity name. */
  isMeal: boolean;
}

export interface TourCompletenessInput {
  requestedDays: number;
  travelPace: TravelPace;
  /** True only when the whole request is food-centric (a single 'food'
   * interest), not merely when 'food' is one of several themes — see
   * TourCompletenessValidator for the exact heuristic and its rationale. */
  isFoodFocusedIntent: boolean;
  selectedActivities: TourCompletenessSelectedActivity[];
  /** Offered-minus-selected candidates, global across the whole tour — not
   * per day. The system has no deterministic day assignment for unused
   * candidates yet (that's spatial/temporal feasibility, later work), so a
   * day is only ever cleared from "genuinely can't do more" using this
   * global count. */
  viableUnusedCandidateCount: number;
}

export interface TourCompletenessResult {
  complete: boolean;
  issues: TourCompletenessIssue[];
}
