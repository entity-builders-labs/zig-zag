import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';
import { TransportationMode } from 'src/modules/tours/interfaces/tour-generation.interface';

describe('PBT-04: Mobility Budgets & Allowed Modes Invariant (TC-PBT-04)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('never exceeds walking budgets or uses forbidden transportation modes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        arbitraryCandidatePool(4, 20),
        fc.integer({ min: 2000, max: 10000 }),
        fc.integer({ min: 500, max: 2000 }),
        async (days, pool, maxDailyWalking, maxContinuousWalking) => {
          const input = new TourInputBuilder()
            .withDays(days)
            .withCandidates(pool)
            .withMobility({
              allowedTransportationModes: [
                TransportationMode.WALKING,
                TransportationMode.PUBLIC_TRANSPORT,
              ],
              maxWalkingDistancePerDayMeters: maxDailyWalking,
              maxContinuousWalkingDistanceMeters: maxContinuousWalking,
            })
            .build();

          const solution = await solver.solve(input);

          for (const day of solution.days) {
            let dayWalking = 0;
            for (const act of day.activities) {
              if (act.travelFromPrevious) {
                const legWalking = act.travelFromPrevious.walkingDistanceMeters ?? 0;
                expect(legWalking).toBeLessThanOrEqual(maxContinuousWalking);
                dayWalking += legWalking;

                expect(
                  input.mobility.allowedTransportationModes,
                ).toContain(act.travelFromPrevious.mode);
              }
            }
            expect(dayWalking).toBeLessThanOrEqual(maxDailyWalking);
          }

          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 25 },
    );
  });
});
