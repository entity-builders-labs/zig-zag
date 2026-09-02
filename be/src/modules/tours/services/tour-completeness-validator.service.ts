import { Injectable } from '@nestjs/common';
import {
  TourCompletenessInput,
  TourCompletenessIssue,
  TourCompletenessResult,
} from '../interfaces/tour-completeness.interface';
import {
  MEAL_HOURS_CAP_WHEN_NOT_FOCUSED,
  SUBSTANTIAL_EXPERIENCE_HOURS,
  TOUR_DENSITY_POLICY,
} from '../utils/tour-density-policy.util';

/**
 * Deterministic gate answering a question nothing else in the pipeline
 * asks: did the generated itinerary make reasonable use of the requested
 * day(s)? CoverageAnalyzer only judges the candidate *pool* offered to the
 * LLM; verifyAndDedupeActivities/auditGeneration only judge whether the
 * LLM's picks are real, non-duplicated, and individually schedulable. None
 * of them notice a valid, real, non-duplicated itinerary that is simply too
 * thin for the day it was asked to fill.
 */
@Injectable()
export class TourCompletenessValidator {
  validate(input: TourCompletenessInput): TourCompletenessResult {
    const policy = TOUR_DENSITY_POLICY[input.travelPace];
    const issues: TourCompletenessIssue[] = [];

    for (let dayNumber = 1; dayNumber <= input.requestedDays; dayNumber++) {
      const dayExperiences = input.selectedExperiences.filter(
        (experience) => experience.dayNumber === dayNumber,
      );

      let meaningfulHours = 0;
      let substantialCount = 0;
      for (const experience of dayExperiences) {
        // A meal stop that isn't the trip's focus is capped so it can't,
        // on its own, make an otherwise thin day look complete, and never
        // counts toward the "substantial experience" count either.
        const isComplementaryMeal =
          experience.isMeal && !input.isFoodFocusedIntent;
        meaningfulHours += isComplementaryMeal
          ? Math.min(experience.durationHours, MEAL_HOURS_CAP_WHEN_NOT_FOCUSED)
          : experience.durationHours;
        if (
          !isComplementaryMeal &&
          experience.durationHours >= SUBSTANTIAL_EXPERIENCE_HOURS
        ) {
          substantialCount += 1;
        }
      }

      const meetsDensity =
        meaningfulHours >= policy.minMeaningfulHours ||
        substantialCount >= policy.minSubstantialExperiences;

      // A genuinely exhausted pool is a CoverageAnalyzer/refill concern,
      // not a completeness one — never flag a day (including a fully
      // empty one) when there is nothing viable left to add.
      if (!meetsDensity && input.viableUnusedCandidateCount > 0) {
        issues.push(
          this.buildIssue(
            dayNumber,
            dayExperiences.length,
            meaningfulHours,
            input,
          ),
        );
      }
    }

    return { complete: issues.length === 0, issues };
  }

  private buildIssue(
    dayNumber: number,
    selectedExperienceCount: number,
    meaningfulHours: number,
    input: TourCompletenessInput,
  ): TourCompletenessIssue {
    const selectedExperienceHours = Number(meaningfulHours.toFixed(2));
    return {
      code: 'UNDERFILLED_DAY',
      dayNumber,
      selectedExperienceCount,
      selectedExperienceHours,
      viableUnusedCandidateCount: input.viableUnusedCandidateCount,
      travelPace: input.travelPace,
      message:
        `Day ${dayNumber} has ${selectedExperienceCount} experience(s) ` +
        `totaling ~${selectedExperienceHours}h of meaningful time, below the ` +
        `"${input.travelPace}" pace guideline, while ` +
        `${input.viableUnusedCandidateCount} viable candidate(s) remain unused.`,
    };
  }
}
