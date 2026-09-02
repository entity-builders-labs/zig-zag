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

    const score = plannedDays.reduce((sum, d) => sum + d.activities.length, 0);

    return {
      days: plannedDays,
      unselected,
      score,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: true,
        iterations,
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
