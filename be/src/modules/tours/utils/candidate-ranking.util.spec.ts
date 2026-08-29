import {
  rankCandidatesByRelevance,
  RankableCandidate,
} from './candidate-ranking.util';

describe('rankCandidatesByRelevance', () => {
  it('falls back to weightedScore-only order when similarityById is null (no interests supplied)', () => {
    const candidates: RankableCandidate[] = [
      { id: 'low', source: 'poi', weightedScore: 3.5 },
      { id: 'high', source: 'poi', weightedScore: 4.8 },
    ];

    const result = rankCandidatesByRelevance(candidates, null);

    expect(result.map((r) => r.candidate.id)).toEqual(['high', 'low']);
  });

  it('ranks a lower-rated POI above a higher-rated one when its interest similarity is higher', () => {
    const candidates: RankableCandidate[] = [
      { id: 'high-rated-irrelevant', source: 'poi', weightedScore: 4.9 },
      { id: 'lower-rated-relevant', source: 'poi', weightedScore: 4.0 },
    ];
    const similarityById = new Map([
      ['high-rated-irrelevant', 0.1],
      ['lower-rated-relevant', 0.9],
    ]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    expect(result.map((r) => r.candidate.id)).toEqual([
      'lower-rated-relevant',
      'high-rated-irrelevant',
    ]);
  });

  it('gives a curated composite a fixed quality bonus instead of a fake rating', () => {
    const candidates: RankableCandidate[] = [
      { id: 'curated-walk', source: 'composite', isCurated: true },
      { id: 'adhoc-walk', source: 'composite', isCurated: false },
    ];
    const similarityById = new Map([
      ['curated-walk', 0.5],
      ['adhoc-walk', 0.5],
    ]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    expect(result.map((r) => r.candidate.id)).toEqual([
      'curated-walk',
      'adhoc-walk',
    ]);
  });

  it('keeps a missing embedding explicit and after the measured semantic tier', () => {
    const candidates: RankableCandidate[] = [
      { id: 'has-embedding', source: 'poi', weightedScore: 3.0 },
      { id: 'no-embedding', source: 'poi', weightedScore: 3.0 },
    ];
    const similarityById = new Map([['has-embedding', 0.8]]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    expect(result.map((r) => r.candidate.id)).toEqual([
      'has-embedding',
      'no-embedding',
    ]);
  });

  it('does not confuse an indexed zero similarity with a missing measurement', () => {
    const candidates: RankableCandidate[] = [
      { id: 'missing-high-rating', source: 'poi', weightedScore: 5 },
      { id: 'measured-zero', source: 'poi', weightedScore: 3 },
    ];

    const result = rankCandidatesByRelevance(
      candidates,
      new Map([['measured-zero', 0]]),
    );

    expect(result.map((r) => r.candidate.id)).toEqual([
      'measured-zero',
      'missing-high-rating',
    ]);
  });

  it('uses proximity as a bounded tie-breaker within the semantic tier', () => {
    const candidates: RankableCandidate[] = [
      {
        id: 'far',
        source: 'poi',
        weightedScore: 4,
        distanceKm: 10,
      },
      {
        id: 'near',
        source: 'poi',
        weightedScore: 4,
        distanceKm: 1,
      },
    ];
    const similarityById = new Map([
      ['far', 0.7],
      ['near', 0.7],
    ]);

    expect(
      rankCandidatesByRelevance(candidates, similarityById).map(
        (r) => r.candidate.id,
      ),
    ).toEqual(['near', 'far']);
  });

  it('softly rewards a non-redundant subtype without overriding strong relevance', () => {
    const candidates: RankableCandidate[] = [
      { id: 'museum-1', source: 'poi', subtype: 'museum' },
      { id: 'museum-2', source: 'poi', subtype: 'museum' },
      { id: 'historic-site', source: 'poi', subtype: 'historic_site' },
    ];
    const similarityById = new Map([
      ['museum-1', 0.8],
      ['museum-2', 0.79],
      ['historic-site', 0.78],
    ]);

    expect(
      rankCandidatesByRelevance(candidates, similarityById).map(
        (r) => r.candidate.id,
      ),
    ).toEqual(['museum-1', 'historic-site', 'museum-2']);
  });

  it('lets a POI and a composite compete on the same scale given equal interest similarity', () => {
    const candidates: RankableCandidate[] = [
      { id: 'mediocre-poi', source: 'poi', weightedScore: 3.0 },
      { id: 'curated-walk', source: 'composite', isCurated: true },
    ];
    const similarityById = new Map([
      ['mediocre-poi', 0.5],
      ['curated-walk', 0.5],
    ]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    // 0.5 + (3.0/5 * 0.2) = 0.62 for the POI vs 0.5 + 0.15 = 0.65 for the
    // curated composite — the composite wins on a mediocre-but-real rating.
    expect(result.map((r) => r.candidate.id)).toEqual([
      'curated-walk',
      'mediocre-poi',
    ]);
  });

  it('exposes the diversity bonus actually applied at selection time, not recomputed after the fact', () => {
    // Same fixture/order as the subtype test above: museum-1 selected 1st
    // (first 'poi' kind seen + first 'museum' subtype seen), historic-site
    // 2nd (kind already seen, but first 'historic_site' subtype), museum-2
    // 3rd (kind already seen, 'museum' subtype now repeated -> penalty).
    // Recomputing after the full loop finished (using final selectedKinds/
    // subtypeCounts) would wrongly zero out museum-1's and historic-site's
    // kind/subtype bonuses, since by then every kind/subtype looks "already
    // seen".
    const candidates: RankableCandidate[] = [
      { id: 'museum-1', source: 'poi', subtype: 'museum' },
      { id: 'museum-2', source: 'poi', subtype: 'museum' },
      { id: 'historic-site', source: 'poi', subtype: 'historic_site' },
    ];
    const similarityById = new Map([
      ['museum-1', 0.8],
      ['museum-2', 0.79],
      ['historic-site', 0.78],
    ]);

    const result = rankCandidatesByRelevance(candidates, similarityById);
    const byId = new Map(result.map((r) => [r.candidate.id, r.scoreBreakdown]));

    // First-of-its-kind AND first-of-its-subtype: both bonuses apply.
    expect(byId.get('museum-1')?.diversityBonus).toBeCloseTo(0.04 + 0.03);
    // Kind ('poi') already seen by now, but first 'historic_site' subtype.
    expect(byId.get('historic-site')?.diversityBonus).toBeCloseTo(0.03);
    // Kind already seen, and 'museum' subtype now repeated once -> penalty.
    expect(byId.get('museum-2')?.diversityBonus).toBeCloseTo(-0.02);
  });
});
