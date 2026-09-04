import { selectBoundedWindow } from './candidate-window-selection.util';
import { RankableCandidate, RankedCandidate } from './candidate-ranking.util';

type FixtureCandidate = RankableCandidate & {
  original: { id: string; intents: string[] };
};

function ranked(
  id: string,
  intents: string[],
  totalScore: number,
): RankedCandidate<FixtureCandidate> {
  return {
    candidate: { id, source: 'poi', original: { id, intents } },
    scoreBreakdown: {
      semanticSimilarity: null,
      qualityBonus: 0,
      proximityBonus: 0,
      diversityBonus: 0,
      totalScore,
    },
  };
}

const getIntents = (candidate: any) => candidate.original.intents as string[];

describe('selectBoundedWindow', () => {
  it('returns a plain top-N slice when nothing was requested', () => {
    const pool = [
      ranked('a', ['walk'], 0.9),
      ranked('b', ['visit'], 0.8),
      ranked('c', ['visit'], 0.7),
    ];

    const window = selectBoundedWindow(pool, getIntents, [], 2);

    expect(window.map((item) => item.candidate.id)).toEqual(['a', 'b']);
  });

  it('reserves slots for a requested intent that a plain top-N score cut would otherwise starve out', () => {
    // 20 high-scoring 'visit' POIs vs. a single lower-scoring 'walk' —
    // a plain top-N slice of window size 5 would never reach the walk.
    const visits = Array.from({ length: 20 }, (_, i) =>
      ranked(`visit-${i}`, ['visit'], 0.9 - i * 0.01),
    );
    const walk = ranked('walk-1', ['walk'], 0.3);
    const pool = [...visits, walk];

    const window = selectBoundedWindow(pool, getIntents, ['walk'], 5);

    expect(window.map((item) => item.candidate.id)).toContain('walk-1');
    expect(window).toHaveLength(5);
  });

  it('reserves up to minReservedPerIntent per requested intent, best-scoring first', () => {
    const walks = [
      ranked('walk-best', ['walk'], 0.5),
      ranked('walk-mid', ['walk'], 0.4),
      ranked('walk-worst', ['walk'], 0.1),
    ];
    const visits = Array.from({ length: 10 }, (_, i) =>
      ranked(`visit-${i}`, ['visit'], 0.95 - i * 0.01),
    );
    const pool = [...visits, ...walks];

    const window = selectBoundedWindow(pool, getIntents, ['walk'], 5, 2);

    const ids = window.map((item) => item.candidate.id);
    expect(ids).toContain('walk-best');
    expect(ids).toContain('walk-mid');
    expect(ids).not.toContain('walk-worst');
  });

  it('does not double-reserve a single candidate matching multiple requested intents', () => {
    // 'both' is the only real match for either 'walk' or 'route_like'. If it
    // were reserved once per matching intent instead of once overall, the
    // window would contain it twice (a real, observable duplicate-entry bug),
    // not just "waste" a slot.
    const both = ranked('both', ['route_like', 'walk'], 0.2);
    const visit = ranked('visit-1', ['visit'], 0.1);
    const pool = [both, visit];

    const window = selectBoundedWindow(
      pool,
      getIntents,
      ['walk', 'route_like'],
      2,
      1,
    );

    expect(window.map((item) => item.candidate.id)).toEqual([
      'both',
      'visit-1',
    ]);
  });

  it('gives each requested intent its own reserved candidate when the matches are disjoint', () => {
    const walkOnly = ranked('walk-only', ['walk'], 0.15);
    const routeOnly = ranked('route-only', ['route_like'], 0.14);
    const visits = Array.from({ length: 10 }, (_, i) =>
      ranked(`visit-${i}`, ['visit'], 0.95 - i * 0.01),
    );
    const pool = [...visits, walkOnly, routeOnly];

    const window = selectBoundedWindow(
      pool,
      getIntents,
      ['walk', 'route_like'],
      12,
      1,
    );

    const ids = window.map((item) => item.candidate.id);
    expect(ids).toContain('walk-only');
    expect(ids).toContain('route-only');
  });

  it('never reserves a slot for a requested intent with zero real matches in the pool', () => {
    const pool = [ranked('visit-1', ['visit'], 0.9)];

    const window = selectBoundedWindow(pool, getIntents, ['nightlife'], 3);

    // No fabricated candidate — the window is simply whatever real
    // candidates exist, unaffected by an intent nothing matches.
    expect(window.map((item) => item.candidate.id)).toEqual(['visit-1']);
  });

  it('fills remaining slots by score after reservations, and the whole window stays score-ordered', () => {
    const pool = [
      ranked('visit-a', ['visit'], 0.9),
      ranked('visit-b', ['visit'], 0.85),
      ranked('walk-1', ['walk'], 0.2),
      ranked('visit-c', ['visit'], 0.1),
    ];

    const window = selectBoundedWindow(pool, getIntents, ['walk'], 3, 1);

    expect(window.map((item) => item.candidate.id)).toEqual([
      'visit-a',
      'visit-b',
      'walk-1',
    ]);
  });
});
