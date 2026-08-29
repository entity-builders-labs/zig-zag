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

/** Deterministic V1 daily-planning solver: sort candidates (Task 6), greedily
 * place them into requested-day buckets under hard constraints + soft
 * scoring (Task 7), run bounded local improvement across days (Task 9), then
 * order/schedule each day independently (Task 8). No randomization anywhere
 * in the pipeline, so identical input always yields a deep-equal solution. */
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
      requestedFormats: input.requestedFormats ?? [],
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

    // Total scheduled activities across the whole solution — a simple,
    // deterministic proxy for "how much of the requested itinerary got
    // filled." Not a weighted quality score; V1 has no such concept yet.
    const score = plannedDays.reduce((sum, d) => sum + d.activities.length, 0);

    return {
      days: plannedDays,
      unselected,
      score,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: true,
        iterations,
      },
    };
  }
}
