import {
  selectBoundedWindow,
  MAX_VARIANTS_PER_FAMILY,
} from './candidate-window-selection.util';
import {
  RankableCandidate,
  RankedCandidate,
  CandidateScoreBreakdown,
} from './candidate-ranking.util';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';
import { ActivityKind } from '@prisma/client';

type Candidate = RankableCandidate & { familyId?: string | null };

function ranked(
  candidates: Candidate[],
  totalScoreById: Record<string, number> = {},
): RankedCandidate<Candidate>[] {
  // Caller supplies candidates already in descending-relevance order — this
  // mirrors what rankCandidatesByRelevance actually returns, since
  // selectBoundedWindow only ever receives an already-sorted pool.
  return candidates.map((candidate) => {
    const scoreBreakdown: CandidateScoreBreakdown = {
      semanticSimilarity: null,
      qualityBonus: 0,
      proximityBonus: 0,
      diversityBonus: 0,
      totalScore: totalScoreById[candidate.id] ?? 0,
    };
    return { candidate, scoreBreakdown };
  });
}

describe('selectBoundedWindow', () => {
  it('never lets plain ranking reduce a requested format to zero candidates in the window (PR 9 regression case)', () => {
    // 12 higher-scoring POIs would fill the window on rank alone, crowding
    // out both real NEIGHBORHOOD_WALKs even though the pool has them.
    const pois: Candidate[] = Array.from({ length: 12 }, (_, i) => ({
      id: `poi-${i}`,
      source: 'poi' as const,
      kind: ActivityKind.POI,
      weightedScore: 5,
    }));
    const walks: Candidate[] = [
      {
        id: 'walk-1',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
      {
        id: 'walk-2',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
    ];
    const rankedFull = ranked([...pois, ...walks]);

    const result = selectBoundedWindow(
      rankedFull,
      [ExperienceFormat.NEIGHBORHOOD_WALKS],
      12,
    );

    const windowKinds = result.window.map((r) => r.candidate.kind);
    expect(windowKinds).toContain(ActivityKind.NEIGHBORHOOD_WALK);
    expect(result.formatAvailability).toEqual([
      {
        format: ExperienceFormat.NEIGHBORHOOD_WALKS,
        fullPoolCount: 2,
        llmWindowCount: 1,
      },
    ]);
  });

  it('preserves at least one candidate for each of several requested formats when each has viable matches', () => {
    const rankedFull = ranked([
      {
        id: 'walk-1',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
      {
        id: 'walk-2',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
      { id: 'route-1', source: 'composite', kind: ActivityKind.ROUTE },
      {
        id: 'experience-1',
        source: 'composite',
        kind: ActivityKind.EXPERIENCE,
      },
      {
        id: 'experience-2',
        source: 'composite',
        kind: ActivityKind.EXPERIENCE,
      },
      {
        id: 'experience-3',
        source: 'composite',
        kind: ActivityKind.EXPERIENCE,
      },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `poi-${i}`,
        source: 'poi' as const,
        kind: ActivityKind.POI,
        weightedScore: 5,
      })),
    ]);

    const result = selectBoundedWindow(
      rankedFull,
      [
        ExperienceFormat.NEIGHBORHOOD_WALKS,
        ExperienceFormat.THEMATIC_ROUTES,
        ExperienceFormat.EXPERIENCES,
      ],
      15,
    );

    const windowKinds = new Set(result.window.map((r) => r.candidate.kind));
    expect(windowKinds.has(ActivityKind.NEIGHBORHOOD_WALK)).toBe(true);
    expect(windowKinds.has(ActivityKind.ROUTE)).toBe(true);
    expect(windowKinds.has(ActivityKind.EXPERIENCE)).toBe(true);
  });

  it('reports zero fullPoolCount for a requested format absent from the pool, never fabricating a window candidate', () => {
    const rankedFull = ranked([
      { id: 'poi-1', source: 'poi', kind: ActivityKind.POI, weightedScore: 4 },
    ]);

    const result = selectBoundedWindow(
      rankedFull,
      [ExperienceFormat.THEMATIC_ROUTES],
      15,
    );

    expect(result.formatAvailability).toEqual([
      {
        format: ExperienceFormat.THEMATIC_ROUTES,
        fullPoolCount: 0,
        llmWindowCount: 0,
      },
    ]);
    expect(result.window.map((r) => r.candidate.id)).toEqual(['poi-1']);
  });

  it('respects maxWindowSize even when reserving for more requested formats than there are slots', () => {
    const rankedFull = ranked([
      {
        id: 'walk-1',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
      { id: 'route-1', source: 'composite', kind: ActivityKind.ROUTE },
      {
        id: 'experience-1',
        source: 'composite',
        kind: ActivityKind.EXPERIENCE,
      },
    ]);

    const result = selectBoundedWindow(
      rankedFull,
      [
        ExperienceFormat.NEIGHBORHOOD_WALKS,
        ExperienceFormat.THEMATIC_ROUTES,
        ExperienceFormat.EXPERIENCES,
      ],
      2,
    );

    expect(result.window.length).toBe(2);
  });

  it('caps variants of the same family at MAX_VARIANTS_PER_FAMILY, counting the rest as dropped', () => {
    const rankedFull = ranked([
      {
        id: 'variant-1',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        familyId: 'family-a',
      },
      {
        id: 'variant-2',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        familyId: 'family-a',
      },
      {
        id: 'variant-3',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        familyId: 'family-a',
      },
    ]);

    const result = selectBoundedWindow(rankedFull, [], 15);

    const familyAInWindow = result.window.filter(
      (r) => r.candidate.familyId === 'family-a',
    );
    expect(familyAInWindow.length).toBe(MAX_VARIANTS_PER_FAMILY);
    expect(result.droppedForFamilyCapCount).toBe(3 - MAX_VARIANTS_PER_FAMILY);
  });

  it('still fills remaining slots with POIs when a composite format is requested — POIs are never banned', () => {
    const rankedFull = ranked([
      {
        id: 'walk-1',
        source: 'composite',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
      { id: 'poi-1', source: 'poi', kind: ActivityKind.POI, weightedScore: 4 },
      { id: 'poi-2', source: 'poi', kind: ActivityKind.POI, weightedScore: 4 },
    ]);

    const result = selectBoundedWindow(
      rankedFull,
      [ExperienceFormat.NEIGHBORHOOD_WALKS],
      15,
    );

    const windowIds = result.window.map((r) => r.candidate.id).sort();
    expect(windowIds).toEqual(['poi-1', 'poi-2', 'walk-1']);
  });
});
