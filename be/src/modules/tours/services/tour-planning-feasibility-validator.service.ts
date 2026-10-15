import { Injectable } from '@nestjs/common';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  PlanningFeasibilityIssue,
  PlanningFeasibilityResult,
  TourPlanningFeasibilityValidator,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { evaluateVisitOpeningHours } from '../utils/normalized-opening-hours.util';
import {
  collapsedVisitFacts,
  visitOpeningHoursOnDay,
} from '../utils/planning-candidate-facts.util';

@Injectable()
export class TourPlanningFeasibilityValidatorService
  implements TourPlanningFeasibilityValidator
{
  validate(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
  ): PlanningFeasibilityResult {
    const issues: PlanningFeasibilityIssue[] = [];

    if (solution.days.length !== input.days.length) {
      issues.push({
        code: 'DAY_COUNT_MISMATCH',
        message: `Expected ${input.days.length} days, got ${solution.days.length}.`,
      });
    }
    const cycling = input.mobility.cycling;

    const seenExperienceIds = new Set<string>();

    for (const day of solution.days) {
      if (day.dayNumber < 1 || day.dayNumber > input.days.length) {
        issues.push({
          code: 'INVALID_DAY_NUMBER',
          message: `Day number ${day.dayNumber} is outside the requested range.`,
        });
        continue;
      }
      const planningDay = input.days[day.dayNumber - 1];
      let cursor = planningDay.window.startMinutesFromMidnight;
      let dayWalkingMeters = 0;
      let dayCyclingMinutes = 0;

      for (const experience of day.experiences) {
        const experienceId = experience.experienceId;
        if (seenExperienceIds.has(experienceId)) {
          issues.push({
            code: 'DUPLICATE_EXPERIENCE',
            message: `Experience ${experience.experienceId} is scheduled more than once.`,
          });
        }
        seenExperienceIds.add(experienceId);

        if (experience.startMinutesFromMidnight < cursor) {
          issues.push({
            code: 'CHRONOLOGICAL_ORDER_VIOLATION',
            message: `Day ${day.dayNumber}: Experience ${experience.experienceId} starts before the previous Experience ends.`,
          });
        }
        cursor = experience.endMinutesFromMidnight;

        const candidate = input.candidates.find(
          (candidate) => candidate.experienceId === experienceId,
        );
        if (!candidate) {
          issues.push({
            code: 'UNKNOWN_EXPERIENCE',
            message: `Experience ${experience.experienceId} is not part of the offered candidate pool.`,
          });
          continue;
        }

        const facts = collapsedVisitFacts(candidate);
        if (!facts) {
          issues.push({
            code: 'UNCHECKABLE_COMPOSITE_TIMELINE',
            message: `Day ${day.dayNumber}: Experience ${experience.experienceId} has no single-visit facts to check its schedule against.`,
          });
        } else if (
          !evaluateVisitOpeningHours(
            visitOpeningHoursOnDay(facts, day.dayNumber),
            experience.startMinutesFromMidnight,
            experience.endMinutesFromMidnight,
          )
        ) {
          issues.push({
            code: 'OPENING_HOURS_INCOMPATIBLE',
            message: `Day ${day.dayNumber}: Experience ${experience.experienceId} is scheduled outside its known opening hours.`,
          });
        }

        if (experience.travelFromPrevious) {
          dayWalkingMeters +=
            experience.travelFromPrevious.walkingDistanceMeters;
          if (
            !input.mobility.allowedTransportationModes.includes(
              experience.travelFromPrevious.mode,
            )
          ) {
            issues.push({
              code: 'DISALLOWED_TRAVEL_MODE',
              message: `Day ${day.dayNumber}: the leg into Experience ${experience.experienceId} used a disallowed transportation mode.`,
            });
          }
          if (
            experience.travelFromPrevious.walkingDistanceMeters >
            input.mobility.maxContinuousWalkingDistanceMeters
          ) {
            issues.push({
              code: 'MAX_CONTINUOUS_WALKING_EXCEEDED',
              message: `Day ${day.dayNumber}: the leg into Experience ${experience.experienceId} exceeds the continuous walking limit.`,
            });
          }
          if (
            experience.travelFromPrevious.mode === TransportationMode.CYCLING
          ) {
            dayCyclingMinutes += experience.travelFromPrevious.durationMinutes;
            if (
              !cycling ||
              experience.travelFromPrevious.durationMinutes >
                cycling.maxContinuousCyclingMinutes
            ) {
              issues.push({
                code: 'CYCLING_LIMIT',
                message: `Day ${day.dayNumber}: the bicycle leg into Experience ${experience.experienceId} exceeds the cycling limit.`,
              });
            }
          }
        }
        dayCyclingMinutes += candidate.mobility?.internalCyclingMinutes ?? 0;
        if (
          cycling &&
          (candidate.mobility?.maxInternalContinuousCyclingMinutes ?? 0) >
            cycling.maxContinuousCyclingMinutes
        ) {
          issues.push({
            code: 'CYCLING_LIMIT',
            message: `Day ${day.dayNumber}: Experience ${experience.experienceId} contains an internal bicycle leg that exceeds the cycling limit.`,
          });
        }

        const internalWalkingDistanceMeters =
          candidate.mobility?.internalWalkingDistanceMeters ?? 0;
        dayWalkingMeters += internalWalkingDistanceMeters;
        const maxInternalContinuousWalkingDistanceMeters =
          candidate.mobility?.maxInternalContinuousWalkingDistanceMeters ??
          internalWalkingDistanceMeters;
        if (
          maxInternalContinuousWalkingDistanceMeters >
          input.mobility.maxContinuousWalkingDistanceMeters
        ) {
          issues.push({
            code: 'MAX_CONTINUOUS_WALKING_EXCEEDED',
            message: `Day ${day.dayNumber}: Experience ${experience.experienceId} contains an internal walking leg that exceeds the continuous walking limit.`,
          });
        }
      }

      if (
        cycling?.maxDailyCyclingMinutes != null &&
        dayCyclingMinutes > cycling.maxDailyCyclingMinutes
      ) {
        issues.push({
          code: 'CYCLING_LIMIT',
          message: `Day ${day.dayNumber} exceeds the daily cycling limit.`,
        });
      }
      if (cursor > planningDay.window.endMinutesFromMidnight) {
        issues.push({
          code: 'DAILY_TIME_CAPACITY_EXCEEDED',
          message: `Day ${day.dayNumber} runs past the planning window.`,
        });
      }
      if (dayWalkingMeters > input.mobility.maxWalkingDistancePerDayMeters) {
        issues.push({
          code: 'MAX_WALKING_PER_DAY_EXCEEDED',
          message: `Day ${day.dayNumber} exceeds the daily walking limit.`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
