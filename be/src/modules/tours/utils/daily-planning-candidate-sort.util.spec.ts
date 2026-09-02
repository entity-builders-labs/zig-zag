import {
  sortCandidatesDeterministically,
  selectDailyAnchors,
} from './daily-planning-candidate-sort.util';
import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';

function candidate(
  id: string,
  semanticScore: number,
  qualityScore?: number,
): PlanningExperienceCandidate {
  return {
    activityId: id,
    kind: 'POI',
    title: id,
    durationMinutes: 60,
    spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
    semanticScore,
    qualityScore,
  };
}

describe('sortCandidatesDeterministically', () => {
  it('sorts by semantic score descending', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('low', 0.2),
      candidate('high', 0.9),
    ]);
    expect(sorted.map((c) => c.activityId)).toEqual(['high', 'low']);
  });

  it('breaks a semantic tie by quality score descending', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('low-quality', 0.5, 1),
      candidate('high-quality', 0.5, 4),
    ]);
    expect(sorted.map((c) => c.activityId)).toEqual([
      'high-quality',
      'low-quality',
    ]);
  });

  it('breaks a full tie by activityId lexical ascending, stably', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('b', 0.5, 1),
      candidate('a', 0.5, 1),
    ]);
    expect(sorted.map((c) => c.activityId)).toEqual(['a', 'b']);
  });

  it('never treats an undefined qualityScore as worse than 0', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('zero-quality', 0.5, 0),
      candidate('unknown-quality', 0.5, undefined),
    ]);
    // unknown (0 fallback) ties with an explicit 0 — falls through to the
    // lexical tie-break, not an implicit penalty below the explicit 0.
    expect(sorted.map((c) => c.activityId)).toEqual([
      'unknown-quality',
      'zero-quality',
    ]);
  });
});

describe('selectDailyAnchors', () => {
  it('picks the top N sorted candidates as anchors, one per day', () => {
    const sorted = [
      candidate('a', 0.9),
      candidate('b', 0.8),
      candidate('c', 0.7),
    ];
    expect(selectDailyAnchors(sorted, 2).map((c) => c.activityId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns fewer anchors than requested when candidates run out', () => {
    const sorted = [candidate('a', 0.9)];
    expect(selectDailyAnchors(sorted, 3)).toHaveLength(1);
  });
});
