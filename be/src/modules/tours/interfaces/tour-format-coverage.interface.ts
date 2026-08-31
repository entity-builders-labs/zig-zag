import { ActivityKind } from '@prisma/client';
import { ExperienceFormat } from './tour-generation.interface';

export type TourFormatCoverageIssueCode =
  | 'REQUESTED_FORMAT_MISSING'
  | 'REQUESTED_FORMAT_UNAVAILABLE';

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
  /** The full offered candidate pool (not just what was selected). A requested
   * mapped structural format with zero available candidates is NOT a valid
   * coverage result: acquisition failed to satisfy that explicit user intent. */
  availableCandidateActivities: TourFormatCoverageActivityRef[];
}

export interface TourFormatCoverageResult {
  valid: boolean;
  issues: TourFormatCoverageIssue[];
}
