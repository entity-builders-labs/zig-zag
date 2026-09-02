import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  DailyPlanningSolver,
  PlannedDay,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { sortCandidatesDeterministically } from '../utils/daily-planning-candidate-sort.util';
import {
  PlacementContext,
  placeCandidates,
} from '../utils/daily-planning-placement.util';
import { runBoundedLocalImprovement } from '../utils/daily-planning-local-improvement.util';
import { orderAndScheduleDay } from '../utils/daily-planning-ordering.util';

@Injectable()
export class GreedyDailyPlanningSolver implements DailyPlanningSolver {
  constructor(
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelEstimateProvider: TravelEstimateProvider,
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async solve(input: DailyPlanningInput): Promise<DailyPlanningSolution> {
    const sorted = sortCandidatesDeterministically(input.candidates);
    const context: PlacementContext = {
      policy: this.policy,
      mobility: input.mobility,
      planningWindow: input.planningWindow,
      travelEstimateProvider: this.travelEstimateProvider,
      startDates: input.startDates,
    };

    const { days, unselected } = await placeCandidates(
      sorted,
      input.requestedDays,
      context,
    );
    const { iterations } = await runBoundedLocalImprovement(days, context);

    const plannedDays: PlannedDay[] = [];
    for (const [dayNumber, acc] of days) {
      const planned = await orderAndScheduleDay(dayNumber, acc.assigned, {
        travelEstimateProvider: this.travelEstimateProvider,
        planningWindow: input.planningWindow,
        allowedTransportationModes: input.mobility.allowedTransportationModes,
        startDates: input.startDates,
      });
      plannedDays.push(planned);
    }
    plannedDays.sort((a, b) => a.dayNumber - b.dayNumber);

    const score = plannedDays.reduce(
      (sum, day) => sum + day.experiences.length,
      0,
    );
    const externalEstimates = plannedDays.flatMap((day) =>
      day.experiences
        .map((experience) => experience.travelFromPrevious)
        .filter((estimate): estimate is NonNullable<typeof estimate> => !!estimate),
    );
    const internalEstimateCount = input.candidates.reduce(
      (sum, candidate) =>
        sum +
        Object.values(candidate.mobility?.routingProviderCounts ?? {}).reduce(
          (candidateSum, count) => candidateSum + count,
          0,
        ),
      0,
    );
    const internalFallbackCount = input.candidates.reduce(
      (sum, candidate) => sum + (candidate.mobility?.routingFallbackCount ?? 0),
      0,
    );
    const providerCounts: Record<string, number> = {};
    for (const estimate of externalEstimates) {
      const provider = estimate.provider ?? 'unknown';
      providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
    }
    for (const candidate of input.candidates) {
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
      unselected,
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
}
