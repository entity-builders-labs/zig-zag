import { ApproximateTravelEstimateProvider } from './approximate-travel-estimate.provider';
import { buildPointFootprint } from '../utils/spatial-footprint.util';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

describe('ApproximateTravelEstimateProvider', () => {
  const policy: DailyPlanningPolicy = {
    paceTargets: {
      relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
      moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
      fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
    },
    travel: {
      detourFactor: 1.3,
      walkingSpeedKmh: 5,
      bikeSpeedKmh: 15,
      carUrbanSpeedKmh: 25,
    },
    internalWalking: { unknownFallbackMinutes: 20 },
    compositeDefaultDurationMinutes: 90,
    scoring: {
      semanticWeight: 1,
      qualityWeight: 0.5,
      formatWeight: 0.75,
      familyVariantPenaltyWeight: 0.5,
      dayBalanceWeight: 0.25,
    },
    localImprovement: { maxIterations: 50 },
    window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
  };
  const provider = new ApproximateTravelEstimateProvider(policy);
  const a = buildPointFootprint(-34.6037, -58.3816);
  const b = buildPointFootprint(-34.6158, -58.3734);

  it('always reports approximate: true', async () => {
    const estimate = await provider.estimate(a, b, [
      TransportationMode.WALKING,
    ]);
    expect(estimate.approximate).toBe(true);
  });

  it('prefers walking when allowed', async () => {
    const estimate = await provider.estimate(a, b, [
      TransportationMode.DRIVING,
      TransportationMode.WALKING,
    ]);
    expect(estimate.mode).toBe(TransportationMode.WALKING);
    expect(estimate.walkingMinutes).toBeGreaterThan(0);
  });

  it('uses the first allowed mode when walking is not allowed', async () => {
    const estimate = await provider.estimate(a, b, [
      TransportationMode.DRIVING,
    ]);
    expect(estimate.mode).toBe(TransportationMode.DRIVING);
    expect(estimate.walkingMinutes).toBe(0);
  });

  it('applies the detour factor to straight-line distance', async () => {
    const estimate = await provider.estimate(a, b, [
      TransportationMode.WALKING,
    ]);
    expect(estimate.distanceMeters).toBeGreaterThan(
      1000 * policy.travel.detourFactor,
    );
  });

  it('throws when no allowed modes are given', async () => {
    await expect(provider.estimate(a, b, [])).rejects.toThrow();
  });
});
