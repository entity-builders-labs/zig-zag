import { verifyAndDedupeActivities } from './activity-verification.util';

describe('verifyAndDedupeActivities', () => {
  it('keeps only activities that match a real candidate id', () => {
    const candidateIds = new Set(['real-1', 'real-2']);
    const raw = [
      { activityId: 'real-1', activityName: 'Real place' },
      { activityId: 'made-up-id', activityName: 'Hallucinated place' },
      { activityId: 'real-2', activityName: 'Another real place' },
    ];

    const result = verifyAndDedupeActivities(raw, candidateIds);

    expect(result.verified.map((a) => a.activityId)).toEqual([
      'real-1',
      'real-2',
    ]);
    expect(result.hallucinatedCount).toBe(1);
    expect(result.duplicateCount).toBe(0);
  });

  it('drops repeated picks of the same real candidate, keeping the first', () => {
    const candidateIds = new Set(['real-1']);
    const raw = [
      { activityId: 'real-1', activityName: 'First visit' },
      { activityId: 'real-1', activityName: 'Second visit (duplicate)' },
    ];

    const result = verifyAndDedupeActivities(raw, candidateIds);

    expect(result.verified).toHaveLength(1);
    expect(result.verified[0].activityName).toBe('First visit');
    expect(result.duplicateCount).toBe(1);
    expect(result.hallucinatedCount).toBe(0);
  });

  it('treats an activity with no activityId as hallucinated', () => {
    const candidateIds = new Set(['real-1']);
    const raw: { activityId?: string; activityName: string }[] = [
      { activityId: undefined, activityName: 'No id at all' },
    ];

    const result = verifyAndDedupeActivities(raw, candidateIds);

    expect(result.verified).toHaveLength(0);
    expect(result.hallucinatedCount).toBe(1);
  });

  it('returns an empty result for an empty input with no throw', () => {
    const result = verifyAndDedupeActivities([], new Set());
    expect(result).toEqual({
      verified: [],
      hallucinatedCount: 0,
      duplicateCount: 0,
    });
  });

  it('preserves original order among verified, unique activities', () => {
    const candidateIds = new Set(['a', 'b', 'c']);
    const raw = [
      { activityId: 'c' },
      { activityId: 'unknown' },
      { activityId: 'a' },
      { activityId: 'b' },
    ];

    const result = verifyAndDedupeActivities(raw, candidateIds);

    expect(result.verified.map((a) => a.activityId)).toEqual(['c', 'a', 'b']);
  });
});
