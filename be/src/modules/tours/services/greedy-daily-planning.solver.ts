import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  DailyPlanningSolver,
  PlannedDay,
  PlanningExperienceCandidate,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import { sortCandidatesDeterministically } from '../utils/daily-planning-candidate-sort.util';
import {
  PlacementContext,
  placeCandidates,
} from '../utils/daily-planning-placement.util';
import { runBoundedLocalImprovement } from '../utils/daily-planning-local-improvement.util';
import { orderAndScheduleDayWithRepair } from '../utils/daily-planning-ordering.util';
import { partitionMustIncludeCandidates } from '../utils/must-anchor-placement.util';

@Injectable()
export class GreedyDailyPlanningSolver implements DailyPlanningSolver {
  constructor(
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelEstimateProvider: TravelEstimateProvider,
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async solve(input: DailyPlanningInput): Promise<DailyPlanningSolution> {
    const routedCandidates = await Promise.all(
      input.candidates.map((candidate) =>
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
      planningWindow: input.planningWindow,
      travelEstimateProvider: this.travelEstimateProvider,
      startDates: input.startDates,
    };

    const { days, unselected } = await placeCandidates(
      [...partitioned.must, ...partitioned.regular],
      input.requestedDays,
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
          planningWindow: input.planningWindow,
          allowedTransportationModes: input.mobility.allowedTransportationModes,
          startDates: input.startDates,
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
        .filter(
          (estimate): estimate is NonNullable<typeof estimate> => !!estimate,
        ),
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
      score,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: approximateEstimateCount > 0,
        iterations,
        routing: {
          externalEstimateCount: externalEstimates.length,
          internalEstimateCount,
          approximateEstimateCount,
          fallbackCount,
          providerCounts,
        },
        constraints: {
          requestedDays: input.requestedDays,
          planningWindow: input.planningWindow,
          allowedTransportationModes: [
            ...input.mobility.allowedTransportationModes,
          ],
          maxWalkingDistancePerDayMeters:
            input.mobility.maxWalkingDistancePerDayMeters,
          maxContinuousWalkingDistanceMeters:
            input.mobility.maxContinuousWalkingDistanceMeters,
          travelPace: input.travelPace,
          startDates: [...input.startDates],
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
      (candidate.componentFootprints?.length ?? 0) < 2
    ) {
      return candidate;
    }

    let internalTravelMinutes = 0;
    let internalWalkingMinutes = 0;
    let internalWalkingDistanceMeters = 0;
    let maxInternalContinuousWalkingDistanceMeters = 0;
    let routingFallbackCount = 0;
    const routingProviderCounts: Record<string, number> = {};
    const footprints = candidate.componentFootprints!;

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
        routingProviderCounts,
        routingFallbackCount,
      },
    };
  }
}
