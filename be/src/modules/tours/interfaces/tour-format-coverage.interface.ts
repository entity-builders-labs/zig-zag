import { ActivityKind } from '@prisma/client';
import { ExperienceFormat } from './tour-generation.interface';

export type TourFormatCoverageIssueCode = 'REQUESTED_FORMAT_MISSING';

export interface TourFormatCoverageIssue {
  code: TourFormatCoverageIssueCode;
  requestedFormat: ExperienceFormat;
  availableCandidateCount: number;
  selectedCandidateCount: number;
  message: string;
}

export interface TourFormatCoverageActivityRef {
  activityId: string;
  kind: ActivityKind;
}

export interface TourFormatCoverageInput {
  requestedExperienceFormats: ExperienceFormat[];
  selectedActivities: TourFormatCoverageActivityRef[];
  /** The full offered candidate pool (not just what was selected) — used to
   * tell "the LLM ignored an available format" apart from "the format was
   * never acquired in the first place", which is CoverageAnalyzer's job to
   * flag, not this validator's. */
  availableCandidateActivities: TourFormatCoverageActivityRef[];
}

export interface TourFormatCoverageResult {
  valid: boolean;
  issues: TourFormatCoverageIssue[];
}
