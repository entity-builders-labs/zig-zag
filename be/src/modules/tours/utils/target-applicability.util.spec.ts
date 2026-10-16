import { targetApplicability } from './target-applicability.util';
import { SemanticTarget } from '../preferences/preference-assertion.interface';

function target(dimension: string, key: string): SemanticTarget {
  return { dimension: dimension as SemanticTarget['dimension'], key };
}

describe('targetApplicability', () => {
  it('marks accessibility:wheelchair_access applicable', () => {
    expect(
      targetApplicability(target('accessibility', 'wheelchair_access')),
    ).toEqual({ kind: 'ENFORCEABLE' });
  });

  it('marks accessibility:avoid_stairs and limited_mobility without a producer', () => {
    for (const key of ['avoid_stairs', 'limited_mobility']) {
      expect(targetApplicability(target('accessibility', key))).toEqual({
        kind: 'UNENFORCEABLE',
        reason: 'TARGET_PRODUCER_UNAVAILABLE',
      });
    }
  });

  it('marks dietary_suitability:vegan not yet applicable', () => {
    expect(targetApplicability(target('dietary_suitability', 'vegan'))).toEqual(
      {
        kind: 'UNENFORCEABLE',
        reason: 'TARGET_APPLICABILITY_UNKNOWN',
      },
    );
  });

  it('marks theme and intent SOFT-only (no HARD-proof producer)', () => {
    for (const key of ['history', 'nightlife']) {
      expect(targetApplicability(target('theme', key))).toEqual({
        kind: 'UNENFORCEABLE',
        reason: 'TARGET_PRODUCER_UNAVAILABLE',
      });
    }
    expect(targetApplicability(target('intent', 'walk'))).toEqual({
      kind: 'UNENFORCEABLE',
      reason: 'TARGET_PRODUCER_UNAVAILABLE',
    });
  });

  it('marks remaining closed dimensions not yet applicable', () => {
    expect(targetApplicability(target('winery_scale', 'boutique'))).toEqual({
      kind: 'UNENFORCEABLE',
      reason: 'TARGET_APPLICABILITY_UNKNOWN',
    });
  });
});
