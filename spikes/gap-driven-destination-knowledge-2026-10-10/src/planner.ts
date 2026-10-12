import dailyPlanningPolicyConfig from '../../../be/src/modules/tours/config/daily-planning-policy.config';
import {
  DailyPlanningSolution,
  PlanningExperienceCandidate,
} from '../../../be/src/modules/tours/interfaces/daily-planning.interface';
import { ApproximateTravelEstimateProvider } from '../../../be/src/modules/tours/services/approximate-travel-estimate.provider';
import { DestinationResolution } from '../../../be/src/modules/tours/services/destination-resolution.service';
import { GreedyDailyPlanningSolver } from '../../../be/src/modules/tours/services/greedy-daily-planning.solver';
import { plannerResidualCapacity } from '../../../be/src/modules/tours/utils/daily-planning-convergence.util';
import { toPlanningCandidate } from './composition/projection';
import { InterpretedRequest } from './contracts';
import { CapacityProbe } from './readiness';

/**
 * The real backend planner, unchanged: GreedyDailyPlanningSolver over the
 * network-free ApproximateTravelEstimateProvider with the production
 * daily-planning policy.
 */
export class SpikePlanner {
  readonly policy = dailyPlanningPolicyConfig();
  private readonly solver = new GreedyDailyPlanningSolver(
    new ApproximateTravelEstimateProvider(this.policy),
    this.policy,
  );

  constructor(private readonly destination: DestinationResolution) {}

  planningWindow() {
    return { ...this.policy.window };
  }

  solve(candidates: PlanningExperienceCandidate[], request: InterpretedRequest): Promise<DailyPlanningSolution> {
    return this.solver.solve({
      destination: this.destination,
      requestedDays: request.days,
      candidates,
      mobility: request.mobility,
      travelPace: request.mobility.travelPace,
      planningWindow: this.planningWindow(),
      startDates: [],
    });
  }

  /** PROVISIONAL plan over ACTIVE reusable Experiences; only residual capacity survives. */
  capacityProbe(): CapacityProbe {
    return async (snapshot, request) => {
      const candidates = Object.values(snapshot.experiences)
        .filter((e) => e.status === 'ACTIVE')
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((e) => toPlanningCandidate(e, request));
      const provisional = await this.solve(candidates, request);
      return plannerResidualCapacity(
        provisional,
        this.planningWindow(),
        this.policy.backfill.minimumUsefulResidualMinutes,
      );
    };
  }
}
