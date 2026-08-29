import dailyPlanningPolicyConfig from './daily-planning-policy.config';

describe('dailyPlanningPolicyConfig', () => {
  afterEach(() => {
    delete process.env.DAILY_PLANNING_WALKING_SPEED_KMH;
  });

  it('provides sane defaults', () => {
    const policy = dailyPlanningPolicyConfig();
    expect(policy.travel.walkingSpeedKmh).toBeGreaterThan(0);
    expect(policy.travel.detourFactor).toBeGreaterThanOrEqual(1);
    expect(policy.paceTargets.fast.preferredActivitiesMax).toBeGreaterThan(
      policy.paceTargets.relaxed.preferredActivitiesMax,
    );
    expect(policy.localImprovement.maxIterations).toBeGreaterThan(0);
  });

  it('reads walking speed from env', () => {
    process.env.DAILY_PLANNING_WALKING_SPEED_KMH = '6';
    const policy = dailyPlanningPolicyConfig();
    expect(policy.travel.walkingSpeedKmh).toBe(6);
  });
});
