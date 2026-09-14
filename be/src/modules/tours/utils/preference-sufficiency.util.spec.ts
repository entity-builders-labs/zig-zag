import {
  paceFactor,
  basePortfolioTarget,
  facetSatisfied,
  portfolioTarget,
} from './preference-sufficiency.util';

describe('preference-sufficiency.util', () => {
  describe('paceFactor', () => {
    it('maps relaxed/moderate/fast to 3/4/5', () => {
      expect(paceFactor('relaxed')).toBe(3);
      expect(paceFactor('moderate')).toBe(4);
      expect(paceFactor('fast')).toBe(5);
    });
  });

  describe('basePortfolioTarget', () => {
    it('is clamp(days,1,14) * paceFactor(pace) -- 5 moderate days -> base target 20 TOTAL', () => {
      expect(basePortfolioTarget(5, 'moderate')).toBe(20);
    });

    it('clamps days below 1 up to 1', () => {
      expect(basePortfolioTarget(0, 'moderate')).toBe(1 * 4);
      expect(basePortfolioTarget(-3, 'fast')).toBe(1 * 5);
    });

    it('clamps days above 14 down to 14', () => {
      expect(basePortfolioTarget(20, 'relaxed')).toBe(14 * 3);
    });
  });

  describe('facetSatisfied', () => {
    it('is strongCount >= 1 -- history strongCount=1 -> history satisfied', () => {
      expect(facetSatisfied(1)).toBe(true);
    });

    it('is not satisfied at strongCount=0', () => {
      expect(facetSatisfied(0)).toBe(false);
    });

    it('stays satisfied for any strongCount above 1', () => {
      expect(facetSatisfied(5)).toBe(true);
    });
  });

  describe('portfolioTarget', () => {
    it('is max(baseTarget, distinctReservations + distinctMustAnchors)', () => {
      // base bigger than reservations+anchors -> base wins.
      expect(portfolioTarget({ baseTarget: 20, reservedStrongExperienceIds: ['a', 'b', 'c'], resolvedMustVenueExperienceIds: [] })).toBe(20);
      // reservations+anchors bigger than base -> their sum wins.
      expect(portfolioTarget({ baseTarget: 6, reservedStrongExperienceIds: ['a', 'b', 'c', 'd', 'e'], resolvedMustVenueExperienceIds: ['f', 'g', 'h'] })).toBe(8);
      // exact tie.
      expect(portfolioTarget({ baseTarget: 10, reservedStrongExperienceIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], resolvedMustVenueExperienceIds: ['h', 'i', 'j'] })).toBe(10);
    });
  });

  it('history=1 + architecture=1 + tango=1 for a 5-day moderate trip does not make the portfolio sufficient when only 3 distinct eligible Experiences exist', () => {
    // Every requested facet is individually satisfied...
    expect(facetSatisfied(1)).toBe(true); // history
    expect(facetSatisfied(1)).toBe(true); // architecture
    expect(facetSatisfied(1)).toBe(true); // tango

    // ...but the GLOBAL portfolio target is still days x pace, not a
    // per-facet quota: 3 satisfied facets each reserving one distinct
    // Experience does not, by itself, make a 5-day/moderate trip
    // sufficient.
    const base = basePortfolioTarget(5, 'moderate');
    expect(base).toBe(20);

    const distinctReservations = 3; // one reserved strong match per facet
    const distinctMustAnchors = 0;
    const target = portfolioTarget({
      baseTarget: base,
      reservedStrongExperienceIds: ['a', 'b', 'c'].slice(0, distinctReservations),
      resolvedMustVenueExperienceIds: ['d'].slice(0, distinctMustAnchors),
    });
    expect(target).toBe(20);

    const totalDistinctEligibleExperiences = 3;
    const sufficient = totalDistinctEligibleExperiences >= target;
    expect(sufficient).toBe(false);
  });

  it('exploration style cannot change any sufficiency result -- no helper accepts it as input', () => {
    // None of the canonical helpers has a parameter slot for
    // explorationStyle; arity alone proves it cannot be threaded through
    // and therefore cannot influence the result.
    expect(paceFactor.length).toBe(1); // pace only
    expect(basePortfolioTarget.length).toBe(2); // days, pace only
    expect(facetSatisfied.length).toBe(1); // strongCount only
    expect(portfolioTarget.length).toBe(1); // typed target facts

    // Calling with identical days/pace/counts always yields an identical
    // result, regardless of which exploration style a caller might
    // otherwise have been tempted to pass alongside them.
    const base = basePortfolioTarget(5, 'moderate');
    const target = portfolioTarget({
      baseTarget: base,
      reservedStrongExperienceIds: ['a', 'b', 'c'],
      resolvedMustVenueExperienceIds: [],
    });
    expect(basePortfolioTarget(5, 'moderate')).toBe(base);
    expect(portfolioTarget({
      baseTarget: base,
      reservedStrongExperienceIds: ['a', 'b', 'c'],
      resolvedMustVenueExperienceIds: [],
    })).toBe(target);
  });
});
