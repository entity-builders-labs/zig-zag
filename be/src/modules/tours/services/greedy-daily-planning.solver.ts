import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import { GREEDY_PLANNING_POLICY_VERSIONS } from '../constants/planning-policy-versions';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  DailyPlanningSolver,
  PlannedDay,
  PlannedLegSummary,
  PlanningExperienceCandidate,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimate,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { sortCandidatesDeterministically } from '../utils/daily-planning-candidate-sort.util';
import {
  PlacementContext,
  placeCandidates,
} from '../utils/daily-planning-placement.util';
import { runBoundedLocalImprovement } from '../utils/daily-planning-local-improvement.util';
import { orderAndScheduleDayWithRepair } from '../utils/daily-planning-ordering.util';
import { partitionMustIncludeCandidates } from '../utils/must-anchor-placement.util';
import { collapsedVisitFacts } from '../utils/planning-candidate-facts.util';
import {
  InvalidPlanningInputError,
  validatePlanningInput,
} from '../utils/planning-input-validation.util';

/**
 * Valid planning input this solver cannot plan without breaking a hard
 * constraint or misreporting its policy. Raised before planning, never
 * silently ignored; the OR-Tools optimizer (task 33.1) replaces this solver.
 */
export class UnsupportedPlanningInputError extends Error {
  constructor(detail: string) {
    super(`GreedyDailyPlanningSolver cannot plan this input: ${detail}`);
    this.name = 'UnsupportedPlanningInputError';
  }
}

function assertSupportedByGreedy(
  input: DailyPlanningInput,
  candidates: PlanningExperienceCandidate[],
): void {
  const policies = input.policies;
  const supported = GREEDY_PLANNING_POLICY_VERSIONS;
  if (
    policies.objectivePolicyVersion !== supported.objectivePolicyVersion ||
    policies.unknownOpeningHours.mode !== supported.unknownOpeningHours.mode ||
    policies.unknownOpeningHours.version !==
      supported.unknownOpeningHours.version
  ) {
    throw new UnsupportedPlanningInputError(
      `objective ${policies.objectivePolicyVersion} / UNKNOWN-hours ${policies.unknownOpeningHours.mode}@${policies.unknownOpeningHours.version}`,
    );
  }
  if (
    input.days.some(
      (day) =>
        day.startAnchor || day.endAnchor || day.unavailableWindows.length > 0,
    )
  ) {
    throw new UnsupportedPlanningInputError(
      'day anchors and user unavailable windows',
    );
  }
  const composite = candidates.find(
    (candidate) => !collapsedVisitFacts(candidate),
  );
  if (composite) {
    throw new UnsupportedPlanningInputError(
      `composite internal timeline of Experience ${composite.experienceId}`,
    );
  }
}

function summarizeLegs(estimates: TravelEstimate[]): PlannedLegSummary {
  const byMode: Partial<Record<TransportationMode, number>> = {};
  for (const estimate of estimates) {
    byMode[estimate.mode] = (byMode[estimate.mode] ?? 0) + 1;
  }
  const approximate = estimates.filter(
    (estimate) => estimate.approximate,
  ).length;
  return {
    byMode,
    providerBacked: estimates.length - approximate,
    approximate,
  };
}

@Injectable()
export class GreedyDailyPlanningSolver implements DailyPlanningSolver {
  constructor(
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelEstimateProvider: TravelEstimateProvider,
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async solve(input: DailyPlanningInput): Promise<DailyPlanningSolution> {
    const validation = validatePlanningInput(input);
    if (validation.requestErrors.length > 0) {
      throw new InvalidPlanningInputError(validation.requestErrors);
    }
    assertSupportedByGreedy(input, validation.validCandidates);

    const routedCandidates = await Promise.all(
      validation.validCandidates.map((candidate) =>
        this.withInternalRouting(
          candidate,
          input.mobility.allowedTransportationModes,
        ),
      ),
    );
    const sorted = sortCandidatesDeterministically(routedCandidates, {
      semanticWeight: this.policy.scoring.semanticWeight,
      qualityWeight: this.policy.scoring.qualityWeight,
    });
    const partitioned = partitionMustIncludeCandidates(sorted);
    const context: PlacementContext = {
      policy: this.policy,
      mobility: input.mobility,
      days: input.days,
      travelEstimateProvider: this.travelEstimateProvider,
    };

    const { days, unselected } = await placeCandidates(
      [...partitioned.must, ...partitioned.regular],
      context,
    );
    const { iterations } = await runBoundedLocalImprovement(days, context);

    const plannedDays: PlannedDay[] = [];
    const routedRepairUnselected: UnselectedPlanningCandidate[] = [];
    for (const [dayNumber, acc] of days) {
      const repaired = await orderAndScheduleDayWithRepair(
        dayNumber,
        acc.assigned,
        {
          travelEstimateProvider: this.travelEstimateProvider,
          days: input.days,
          mobility: input.mobility,
          policy: this.policy,
        },
      );
      plannedDays.push(repaired.day);
      routedRepairUnselected.push(...repaired.unselected);
    }
    plannedDays.sort((a, b) => a.dayNumber - b.dayNumber);

    const score = plannedDays.reduce(
      (sum, day) => sum + day.experiences.length,
      0,
    );
    const externalEstimates = plannedDays.flatMap((day) =>
      day.experiences
        .map((experience) => experience.travelFromPrevious)
        .filter((estimate): estimate is TravelEstimate => !!estimate),
    );
    const internalEstimateCount = routedCandidates.reduce(
      (sum, candidate) =>
        sum +
        Object.values(candidate.mobility?.routingProviderCounts ?? {}).reduce(
          (candidateSum, count) => candidateSum + count,
          0,
        ),
      0,
    );
    const internalFallbackCount = routedCandidates.reduce(
      (sum, candidate) => sum + (candidate.mobility?.routingFallbackCount ?? 0),
      0,
    );
    const providerCounts: Record<string, number> = {};
    for (const estimate of externalEstimates) {
      const provider = estimate.provider ?? 'unknown';
      providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
    }
    for (const candidate of routedCandidates) {
      for (const [provider, count] of Object.entries(
        candidate.mobility?.routingProviderCounts ?? {},
      )) {
        providerCounts[provider] = (providerCounts[provider] ?? 0) + count;
      }
    }
    const externalFallbackCount = externalEstimates.filter(
      (estimate) => estimate.approximate || !!estimate.fallbackReason,
    ).length;
    const approximateEstimateCount =
      externalEstimates.filter((estimate) => estimate.approximate).length +
      internalFallbackCount;
    const fallbackCount = externalFallbackCount + internalFallbackCount;

    return {
      days: plannedDays,
      unselected: [...unselected, ...routedRepairUnselected],
      inputErrors: validation.candidateErrors,
      score,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        policies: input.policies,
        approximateTravel: approximateEstimateCount > 0,
        iterations,
        routing: {
          externalEstimateCount: externalEstimates.length,
          internalEstimateCount,
          approximateEstimateCount,
          fallbackCount,
          providerCounts,
        },
        legs: summarizeLegs(externalEstimates),
        constraints: {
          days: input.days.map((day) => ({ ...day })),
          allowedTransportationModes: [
            ...input.mobility.allowedTransportationModes,
          ],
          maxWalkingDistancePerDayMeters:
            input.mobility.maxWalkingDistancePerDayMeters,
          maxContinuousWalkingDistanceMeters:
            input.mobility.maxContinuousWalkingDistanceMeters,
          cycling: input.mobility.cycling,
          travelPace: input.travelPace,
        },
      },
    };
  }

  private async withInternalRouting(
    candidate: PlanningExperienceCandidate,
    allowedModes: DailyPlanningInput['mobility']['allowedTransportationModes'],
  ): Promise<PlanningExperienceCandidate> {
    if (
      candidate.mobility?.internalTravelMinutes !== undefined ||
      candidate.components.length < 2
    ) {
      return candidate;
    }

    let internalTravelMinutes = 0;
    let internalWalkingMinutes = 0;
    let internalWalkingDistanceMeters = 0;
    let maxInternalContinuousWalkingDistanceMeters = 0;
    let internalCyclingMinutes = 0;
    let maxInternalContinuousCyclingMinutes = 0;
    let routingFallbackCount = 0;
    const routingProviderCounts: Record<string, number> = {};
    const footprints = candidate.components.map(
      (component) => component.footprint,
    );

    for (let index = 1; index < footprints.length; index++) {
      const estimate = await this.travelEstimateProvider.estimate(
        footprints[index - 1],
        footprints[index],
        allowedModes,
      );
      internalTravelMinutes += estimate.durationMinutes;
      internalWalkingMinutes += estimate.walkingMinutes;
      internalWalkingDistanceMeters += estimate.walkingDistanceMeters;
      maxInternalContinuousWalkingDistanceMeters = Math.max(
        maxInternalContinuousWalkingDistanceMeters,
        estimate.walkingDistanceMeters,
      );
      if (estimate.mode === TransportationMode.CYCLING) {
        internalCyclingMinutes += estimate.durationMinutes;
        maxInternalContinuousCyclingMinutes = Math.max(
          maxInternalContinuousCyclingMinutes,
          estimate.durationMinutes,
        );
      }
      const provider = estimate.provider ?? 'unknown';
      routingProviderCounts[provider] =
        (routingProviderCounts[provider] ?? 0) + 1;
      if (estimate.approximate || estimate.fallbackReason) {
        routingFallbackCount++;
      }
    }

    return {
      ...candidate,
      mobility: {
        ...candidate.mobility,
        internalTravelMinutes,
        internalWalkingMinutes,
        internalWalkingDistanceMeters,
        maxInternalContinuousWalkingDistanceMeters,
        internalCyclingMinutes,
        maxInternalContinuousCyclingMinutes,
        routingProviderCounts,
        routingFallbackCount,
      },
    };
  }
}
