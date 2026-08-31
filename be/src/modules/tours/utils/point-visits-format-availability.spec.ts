import { ActivityKind } from '@prisma/client';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';
import { RankedCandidate, RankableCandidate } from './candidate-ranking.util';
import { selectBoundedWindow } from './candidate-window-selection.util';

type Candidate = RankableCandidate & { familyId?: string | null };

function rankedPoi(id: string): RankedCandidate<Candidate> {
  return {
    candidate: {
      id,
      source: 'poi',
      kind: ActivityKind.POI,
      weightedScore: 4,
    },
    scoreBreakdown: {
      semanticSimilarity: null,
      qualityBonus: 0,
      proximityBonus: 0,
      diversityBonus: 0,
      totalScore: 0,
    },
  };
}

describe('point_visits format availability', () => {
  it('counts POIs as point_visits in the full pool and offered window', () => {
    const rankedFull = Array.from({ length: 7 }, (_, index) =>
      rankedPoi(`poi-${index + 1}`),
    );

    const result = selectBoundedWindow(
      rankedFull,
      [ExperienceFormat.POINT_VISITS],
      15,
    );

    expect(result.formatAvailability).toEqual([
      {
        format: ExperienceFormat.POINT_VISITS,
        fullPoolCount: 7,
        llmWindowCount: 7,
      },
    ]);
    expect(result.window).toHaveLength(7);
  });
});
