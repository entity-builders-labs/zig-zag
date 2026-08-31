import { Injectable } from '@nestjs/common';
import {
  TourFormatCoverageInput,
  TourFormatCoverageIssue,
  TourFormatCoverageResult,
} from '../interfaces/tour-format-coverage.interface';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from '../utils/experience-format-kind.util';

/**
 * Deterministic tour-level format gate.
 *
 * There are two distinct failures:
 * 1) a viable requested format existed but planning selected none;
 * 2) acquisition never produced any viable candidate for an explicitly
 *    requested mapped structural format.
 *
 * Case (2) used to be silently skipped here, which made traces say
 * FORMAT_COVERAGE_VALID even after CoverageAnalyzer had reported ROUTE /
 * EXPERIENCE as blocking deficits. That is misleading: zero availability is
 * an acquisition failure, not successful format coverage.
 */
@Injectable()
export class TourFormatCoverageValidator {
  validate(input: TourFormatCoverageInput): TourFormatCoverageResult {
    const issues: TourFormatCoverageIssue[] = [];

    for (const format of input.requestedExperienceFormats) {
      const kind = EXPERIENCE_FORMAT_ACTIVITY_KIND[format];
      if (!kind) continue; // point_visits or unmapped — no structural gate

      const availableCandidateCount = input.availableCandidateActivities.filter(
        (candidate) => candidate.kind === kind,
      ).length;
      const selectedCandidateCount = input.selectedActivities.filter(
        (activity) => activity.kind === kind,
      ).length;

      if (availableCandidateCount === 0) {
        issues.push({
          code: 'REQUESTED_FORMAT_UNAVAILABLE',
          requestedFormat: format,
          availableCandidateCount,
          selectedCandidateCount,
          message:
            `Requested format "${format}" requires kind ${kind}, but acquisition ` +
            'produced zero viable candidates for that kind. The request must not ' +
            'be reported as valid format coverage.',
        });
        continue;
      }

      if (selectedCandidateCount === 0) {
        issues.push({
          code: 'REQUESTED_FORMAT_MISSING',
          requestedFormat: format,
          availableCandidateCount,
          selectedCandidateCount,
          message:
            `Requested format "${format}" had ${availableCandidateCount} ` +
            `viable candidate(s) of kind ${kind} available, but the final ` +
            'itinerary selected none of them.',
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
