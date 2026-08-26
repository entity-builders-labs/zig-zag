import { Injectable } from '@nestjs/common';
import {
  TourFormatCoverageInput,
  TourFormatCoverageIssue,
  TourFormatCoverageResult,
} from '../interfaces/tour-format-coverage.interface';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from '../utils/experience-format-kind.util';

/**
 * Deterministic gate answering a question nothing else in the pipeline
 * asks: did the itinerary respect the user's requested experience format
 * (neighborhood walk, thematic route, experience), not just their themes?
 * A tour can perfectly satisfy every requested theme while silently
 * ignoring an explicitly requested format the user cared about how to
 * experience the destination through.
 *
 * Only flags a format when viable candidates for it existed in the offered
 * pool and none were selected — a format the pool never had at all is
 * CoverageAnalyzer/acquisition's concern, not a selection failure. Never
 * flags per-day; format coverage is a tour-level requirement.
 */
@Injectable()
export class TourFormatCoverageValidator {
  validate(input: TourFormatCoverageInput): TourFormatCoverageResult {
    const issues: TourFormatCoverageIssue[] = [];

    for (const format of input.requestedExperienceFormats) {
      const kind = EXPERIENCE_FORMAT_ACTIVITY_KIND[format];
      if (!kind) continue; // point_visits or unmapped — no gate

      const availableCandidateCount = input.availableCandidateActivities.filter(
        (c) => c.kind === kind,
      ).length;
      if (availableCandidateCount === 0) continue; // acquisition's job, not selection's

      const selectedCandidateCount = input.selectedActivities.filter(
        (a) => a.kind === kind,
      ).length;
      if (selectedCandidateCount === 0) {
        issues.push({
          code: 'REQUESTED_FORMAT_MISSING',
          requestedFormat: format,
          availableCandidateCount,
          selectedCandidateCount,
          message:
            `Requested format "${format}" had ${availableCandidateCount} ` +
            `viable candidate(s) of kind ${kind} available, but the final ` +
            `itinerary selected none of them.`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
