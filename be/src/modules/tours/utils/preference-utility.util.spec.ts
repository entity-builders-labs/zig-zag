import { composableExperience } from '../fixtures/composable-experience.fixture';
import { derivePreferenceUtility } from './preference-utility.util';
import {
  ComposableExperience,
  RequestedFacet,
} from '../interfaces/preference-spec.interface';
import {
  dedupeAssertions,
  PreferenceAssertion,
} from '../preferences/preference-assertion.interface';
import { SemanticSimilarityResult } from '@shared/ai/interfaces/embedding-index.interface';

/**
 * The G-P7-U.A scenarios (spikes/planner-comparison-2026-10-12/g-p7-u-a,
 * scripts/encoding.py), with their expectations, against the production
 * preference-utility boundary. Facet keys are scenario labels matched as
 * typed theme facts; eligibility scenarios (F1 hard exclusion, G1
 * accessibility need) belong to the hard-constraint gate and task 25.3.
 */

type Provenance = 'DIRECT' | 'INFERRED';

/**
 * The spike's scenario labels as distinct theme keys of the typed schema.
 * The ranking scenarios only need distinct typed identities; labels that
 * are already schema keys map to themselves.
 */
const SCENARIO_KEY: Record<string, string> = {
  history: 'history',
  architecture: 'architecture',
  art: 'art',
  food: 'food',
  modern_art: 'photography',
  markets: 'shopping',
  family_friendly: 'family',
  parks: 'nature',
  street_art: 'music',
  cafes: 'gastronomy',
  bookshops: 'culture',
  museums: 'entertainment',
};
const schemaKey = (label: string) => SCENARIO_KEY[label] ?? label;
interface ScenarioFacet {
  key: string;
  provenance: Provenance;
  importance: number;
  confidence: number;
}
const W = (key: string): ScenarioFacet => ({
  key,
  provenance: 'DIRECT',
  importance: 1,
  confidence: 1,
});
const FTD = (key: string, importance: number, confidence: number) => ({
  key,
  provenance: 'DIRECT' as const,
  importance,
  confidence,
});
const FTI = (key: string, importance: number, confidence: number) => ({
  key,
  provenance: 'INFERRED' as const,
  importance,
  confidence,
});

interface ScenarioCandidate {
  id: string;
  matched: string[];
  sim: number | null;
  quality: number | null;
  anchor?: boolean;
}
const cand = (
  id: string,
  matched: string[],
  sim: number | null,
  quality: number | null,
  anchor = false,
): ScenarioCandidate => ({ id, matched, sim, quality, anchor });

type Expectation =
  | ['>', string, string]
  | ['not_last', string, string[]]
  | ['not_first', string, string[]]
  | ['stable_known', string];

interface Scenario {
  id: string;
  facets: ScenarioFacet[];
  candidates: ScenarioCandidate[];
  expect: Expectation[];
  semantic?: 'applied' | 'none' | 'unavailable';
}

/** Facets as the spec builder produces them: deduped, DIRECT first. */
function requestedFacets(facets: ScenarioFacet[]): RequestedFacet[] {
  const assertions: PreferenceAssertion[] = facets.map((f) => ({
    target: { dimension: 'theme', key: schemaKey(f.key) },
    polarity: 'INCLUDE',
    constraint: 'SOFT',
    provenance: f.provenance,
    importance: f.importance,
    confidence: f.confidence,
    evidence: [{ kind: 'USER_TEXT_SPAN', text: f.key }],
  }));
  return dedupeAssertions(assertions).map((a) => ({
    dimension: a.target.dimension,
    key: a.target.key,
    provenance: a.provenance,
    importance: a.importance,
    confidence: a.confidence,
    evidence: a.evidence,
    required: false,
  }));
}

function experience(c: ScenarioCandidate): ComposableExperience {
  return composableExperience({
    id: c.id,
    themes: c.matched.map(schemaKey),
    qualityScore: c.quality,
    components: [{ geoEntity: { latitude: 1, longitude: 2 } }],
  });
}

function order(scenario: Scenario, candidates = scenario.candidates) {
  const semantic: SemanticSimilarityResult | null =
    scenario.semantic === 'none'
      ? null
      : {
          status:
            scenario.semantic === 'unavailable' ? 'unavailable' : 'applied',
          scores: new Map(
            candidates
              .filter(
                (c) => c.sim !== null && scenario.semantic !== 'unavailable',
              )
              .map((c) => [c.id, c.sim!]),
          ),
          requestedCandidateCount: candidates.length,
          indexedCandidateCount: candidates.filter((c) => c.sim !== null)
            .length,
          identity: {
            provider: 'ollama',
            model: 'test',
            dimensions: 2,
            documentVersion: 1,
          },
        };
  return derivePreferenceUtility({
    experiences: candidates.map(experience),
    preferenceSpec: {
      facets: requestedFacets(scenario.facets),
      assertions: [],
    },
    softAnchorIds: new Set(candidates.filter((c) => c.anchor).map((c) => c.id)),
    semantic,
  }).order;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'A1',
    facets: [W('history'), W('architecture')],
    candidates: [
      cand('A', ['history', 'architecture'], 0.6, 3.5),
      cand('B', ['history'], 0.98, 5.0),
      cand('C', [], 0.99, 5.0),
    ],
    expect: [
      ['>', 'A', 'B'],
      ['>', 'A', 'C'],
      ['>', 'B', 'C'],
    ],
  },
  {
    id: 'A2',
    facets: [FTD('history', 0.7, 0.6), FTD('architecture', 0.7, 0.6)],
    candidates: [
      cand('A', ['history', 'architecture'], 0.6, 3.5),
      cand('B', ['history'], 0.98, 5.0),
      cand('C', [], 0.99, 5.0),
    ],
    expect: [
      ['>', 'A', 'B'],
      ['>', 'A', 'C'],
      ['>', 'B', 'C'],
    ],
  },
  {
    id: 'B1',
    facets: [W('modern_art')],
    candidates: [
      cand('A', ['modern_art'], 0.71, 3.2),
      cand('B', ['modern_art'], 0.44, 4.8),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'B2',
    facets: [W('modern_art')],
    candidates: [
      cand('A', ['modern_art'], 0.48, 3.2),
      cand('B', ['modern_art'], 0.44, 4.8),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'C1',
    facets: [W('food'), W('markets')],
    candidates: [
      cand('K1', ['food', 'markets'], 0.62, 4.0),
      cand('K2', ['food', 'markets'], 0.41, 4.2),
      cand('K3', ['food', 'markets'], 0.3, 3.6),
      cand('U', ['food', 'markets'], null, 4.5),
    ],
    expect: [
      ['>', 'K1', 'K2'],
      ['>', 'K2', 'K3'],
      ['not_last', 'U', ['K1', 'K2', 'K3']],
      ['not_first', 'U', ['K1', 'K2', 'K3']],
      ['stable_known', 'U'],
    ],
  },
  {
    id: 'C2',
    facets: [W('food'), W('markets')],
    candidates: [
      cand('K', ['food'], 0.95, 4.9),
      cand('U', ['food', 'markets'], null, 3.1),
    ],
    expect: [['>', 'U', 'K']],
  },
  {
    id: 'C3',
    facets: [W('food'), W('markets')],
    candidates: [
      cand('K1', ['food', 'markets'], 0.33, 4.0),
      cand('K2', ['food', 'markets'], 0.24, 4.2),
      cand('K3', ['food', 'markets'], 0.18, 3.6),
      cand('U', ['food', 'markets'], null, 4.5),
    ],
    expect: [
      ['>', 'K1', 'K2'],
      ['>', 'K2', 'K3'],
      ['not_last', 'U', ['K1', 'K2', 'K3']],
      ['not_first', 'U', ['K1', 'K2', 'K3']],
      ['stable_known', 'U'],
    ],
  },
  {
    id: 'D1',
    facets: [W('family_friendly'), FTD('parks', 1.0, 0.9)],
    candidates: [
      cand('A', ['family_friendly', 'parks'], null, 3.1),
      cand('B', ['family_friendly'], null, 4.9),
      cand('C', ['family_friendly'], null, 4.0),
    ],
    expect: [
      ['>', 'A', 'B'],
      ['>', 'A', 'C'],
      ['>', 'B', 'C'],
    ],
    semantic: 'none',
  },
  {
    id: 'E1d',
    facets: [
      W('history'),
      FTD('street_art', 0.5, 0.6),
      FTD('cafes', 0.5, 0.6),
      FTD('bookshops', 0.5, 0.6),
      FTD('parks', 0.5, 0.6),
    ],
    candidates: [
      cand('A', ['history'], 0.5, 4.0),
      cand('B', ['street_art', 'cafes', 'bookshops', 'parks'], 0.8, 4.5),
    ],
    expect: [['>', 'B', 'A']],
  },
  {
    id: 'E1i',
    facets: [
      W('history'),
      FTI('street_art', 0.5, 0.6),
      FTI('cafes', 0.5, 0.6),
      FTI('bookshops', 0.5, 0.6),
      FTI('parks', 0.5, 0.6),
    ],
    candidates: [
      cand('A', ['history'], 0.5, 4.0),
      cand('B', ['street_art', 'cafes', 'bookshops', 'parks'], 0.8, 4.5),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'E2d',
    facets: [
      W('history'),
      FTD('architecture', 1.0, 0.95),
      FTD('modern_art', 1.0, 0.95),
    ],
    candidates: [
      cand('A', ['history'], 0.5, 4.0),
      cand('B', ['architecture', 'modern_art'], 0.5, 4.0),
    ],
    expect: [['>', 'B', 'A']],
  },
  {
    id: 'E2i',
    facets: [
      W('history'),
      FTI('architecture', 1.0, 0.95),
      FTI('modern_art', 1.0, 0.95),
    ],
    candidates: [
      cand('A', ['history'], 0.5, 4.0),
      cand('B', ['architecture', 'modern_art'], 0.5, 4.0),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'E3',
    facets: [
      FTD('museums', 1.0, 0.9),
      FTD('markets', 0.7, 0.9),
      FTD('cafes', 0.5, 0.9),
      FTD('parks', 0.5, 0.9),
      FTD('bookshops', 0.5, 0.9),
    ],
    candidates: [
      cand('A', ['museums', 'markets'], 0.4, 4.0),
      cand('B', ['cafes', 'parks', 'bookshops'], 0.4, 4.0),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'K1',
    facets: [FTD('history', 0.5, 0.5), FTI('architecture', 1.0, 0.95)],
    candidates: [
      cand('A', ['history'], 0.3, 3.5),
      cand('B', ['architecture'], 0.9, 4.9),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'K2',
    facets: [
      FTD('history', 0.7, 0.9),
      FTI('history', 1.0, 0.95),
      FTD('architecture', 0.5, 0.6),
    ],
    candidates: [
      cand('A', ['history'], 0.4, 4.0),
      cand('B', ['architecture'], 0.4, 4.0),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'K3a',
    facets: [W('history'), FTD('architecture', 1.0, 1.0)],
    candidates: [
      cand('X', ['history'], 0.5, 4.0),
      cand('Y', ['architecture'], 0.7, 4.0),
    ],
    expect: [['>', 'Y', 'X']],
  },
  {
    id: 'K3b',
    facets: [FTD('history', 1.0, 1.0), W('architecture')],
    candidates: [
      cand('X', ['history'], 0.5, 4.0),
      cand('Y', ['architecture'], 0.7, 4.0),
    ],
    expect: [['>', 'Y', 'X']],
  },
  {
    id: 'K4',
    facets: [W('history'), FTD('architecture', 1.0, 0.6)],
    candidates: [
      cand('X', ['history'], 0.5, 4.0),
      cand('Y', ['architecture'], 0.7, 4.0),
    ],
    expect: [['>', 'Y', 'X']],
  },
  {
    id: 'K5',
    facets: [FTI('history', 1.0, 0.9), FTI('architecture', 1.0, 0.5)],
    candidates: [
      cand('A', ['history'], 0.4, 4.0),
      cand('B', ['architecture'], 0.8, 4.0),
    ],
    expect: [['>', 'A', 'B']],
  },
  {
    id: 'J1',
    facets: [W('history')],
    candidates: [
      cand('A', ['history'], 0.3, 3.5),
      cand('S', [], 0.95, 4.9, true),
    ],
    expect: [['>', 'A', 'S']],
  },
  {
    id: 'J2',
    facets: [FTI('history', 1.0, 0.8)],
    candidates: [
      cand('A', ['history'], 0.3, 3.5),
      cand('S', [], 0.95, 4.9, true),
    ],
    expect: [['>', 'A', 'S']],
  },
  {
    id: 'J3',
    facets: [W('food')],
    candidates: [
      cand('A', ['food'], 0.9, 4.9),
      cand('S', ['food'], 0.4, 3.5, true),
    ],
    expect: [['>', 'S', 'A']],
  },
  {
    id: 'G2',
    facets: [W('museums')],
    candidates: [
      cand('X', ['museums'], 0.5, 4.0),
      cand('Y', ['museums'], 0.9, 4.9),
    ],
    expect: [['>', 'Y', 'X']],
  },
  {
    id: 'H1',
    facets: [W('history'), W('architecture')],
    candidates: [
      cand('A', ['history', 'architecture'], null, 3.5),
      cand('B', ['history'], null, 4.9),
      cand('C', ['history'], null, 4.0),
      cand('D', [], null, 5.0),
    ],
    expect: [
      ['>', 'A', 'B'],
      ['>', 'B', 'C'],
      ['>', 'C', 'D'],
    ],
    semantic: 'unavailable',
  },
  {
    id: 'I1',
    facets: [],
    candidates: [
      cand('P', [], 0.55, 3.0),
      cand('Q', [], 0.31, 4.9),
      cand('R', [], null, 4.0),
      cand('S', [], null, null),
    ],
    expect: [
      ['>', 'P', 'Q'],
      ['not_last', 'R', ['P', 'Q']],
      ['not_first', 'R', ['P', 'Q']],
    ],
  },
];

describe('derivePreferenceUtility — G-P7-U.A scenarios', () => {
  it.each(SCENARIOS)('$id', (scenario) => {
    const ranked = order(scenario);
    const pos = new Map(ranked.map((id, index) => [id, index]));
    for (const expectation of scenario.expect) {
      const [kind] = expectation;
      if (kind === '>') {
        const [, a, b] = expectation;
        expect(pos.get(a)!).toBeLessThan(pos.get(b)!);
      } else if (kind === 'not_last') {
        const [, u, peers] = expectation;
        expect(peers.some((p) => pos.get(u)! < pos.get(p)!)).toBe(true);
      } else if (kind === 'not_first') {
        const [, u, peers] = expectation;
        expect(peers.some((p) => pos.get(u)! > pos.get(p)!)).toBe(true);
      } else {
        const [, u] = expectation;
        const without = order(
          scenario,
          scenario.candidates.filter((c) => c.id !== u),
        );
        expect(ranked.filter((id) => id !== u)).toEqual(without);
      }
    }
  });
});

describe('derivePreferenceUtility — breakdown, ranks and avoidance', () => {
  const geo = [{ geoEntity: { latitude: 1, longitude: 2 } }];
  const avoid = (
    key: string,
    provenance: Provenance,
    importance: number,
    confidence: number,
  ): PreferenceAssertion => ({
    target: { dimension: 'theme', key },
    polarity: 'EXCLUDE',
    constraint: 'SOFT',
    provenance,
    importance,
    confidence,
    evidence: [{ kind: 'USER_TEXT_SPAN', text: key }],
  });
  const derive = (
    experiences: Parameters<typeof composableExperience>[0][],
    facets: ScenarioFacet[],
    assertions: PreferenceAssertion[] = [],
  ) =>
    derivePreferenceUtility({
      experiences: experiences.map(composableExperience),
      preferenceSpec: { facets: requestedFacets(facets), assertions },
      softAnchorIds: new Set(),
      semantic: null,
    });

  it('reports UNKNOWN semantic and quality in the breakdown, never the projected median', () => {
    const result = derive(
      [{ id: 'u', themes: ['history'], components: geo, qualityScore: null }],
      [W('history')],
    );
    expect(result.byId.get('u')!.breakdown).toEqual({
      directEvidence: 0,
      inferredEvidence: 0,
      avoidance: { directConflict: 0, inferredConflict: 0 },
      softAnchor: false,
      semantic: { status: 'UNKNOWN', reason: 'EMPTY_QUERY' },
      quality: { status: 'UNKNOWN', reason: 'NO_QUALITY_SIGNAL' },
    });
  });

  it('weighs DIRECT by stated importance only and INFERRED by importance x confidence', () => {
    const result = derive(
      [
        {
          id: 'x',
          themes: ['history', 'art'],
          components: geo,
          qualityScore: 4,
        },
      ],
      [FTD('history', 0.7, 0.2), FTI('art', 0.5, 0.6)],
    );
    expect(result.byId.get('x')!.breakdown.directEvidence).toBeCloseTo(0.7);
    expect(result.byId.get('x')!.breakdown.inferredEvidence).toBeCloseTo(0.3);
    expect(result.byId.get('x')!.matchedFacets).toEqual([
      'theme:history',
      'theme:art',
    ]);
  });

  it('ranks a confirmed SOFT EXCLUDE conflict below an otherwise equal candidate (level 3)', () => {
    const result = derive(
      [
        {
          id: 'a-nightlife',
          themes: ['history', 'nightlife'],
          components: geo,
          qualityScore: 5,
        },
        {
          id: 'b-plain',
          themes: ['history'],
          components: geo,
          qualityScore: 3,
        },
      ],
      [W('history')],
      [avoid('nightlife', 'DIRECT', 1, 1)],
    );
    expect(result.order).toEqual(['b-plain', 'a-nightlife']);
    expect(result.byId.get('a-nightlife')!.breakdown.avoidance).toEqual({
      directConflict: 1,
      inferredConflict: 0,
    });
    expect(result.byId.get('a-nightlife')!.avoidedTargets).toEqual([
      'theme:nightlife',
    ]);
  });

  it('never lets avoidance outrank more positive explicit evidence, and never filters', () => {
    const result = derive(
      [
        {
          id: 'a-more-evidence',
          themes: ['history', 'art', 'nightlife'],
          components: geo,
          qualityScore: 4,
        },
        {
          id: 'b-plain',
          themes: ['history'],
          components: geo,
          qualityScore: 4,
        },
      ],
      [W('history'), W('art')],
      [avoid('nightlife', 'DIRECT', 1, 1)],
    );
    expect(result.order).toEqual(['a-more-evidence', 'b-plain']);
  });

  it('compares DIRECT conflict before INFERRED conflict, ascending', () => {
    const result = derive(
      [
        {
          id: 'a-direct-conflict',
          themes: ['nightlife'],
          components: geo,
          qualityScore: 4,
        },
        {
          id: 'b-inferred-conflict',
          themes: ['shopping'],
          components: geo,
          qualityScore: 4,
        },
      ],
      [],
      [
        avoid('nightlife', 'DIRECT', 0.5, 1),
        avoid('shopping', 'INFERRED', 1, 1),
      ],
    );
    expect(result.order).toEqual(['b-inferred-conflict', 'a-direct-conflict']);
  });

  it('treats an absent avoided fact as neutral, not as proof of avoidance', () => {
    const result = derive(
      [
        { id: 'a-unknown', themes: [], components: geo, qualityScore: 4 },
        { id: 'b-unknown', themes: [], components: geo, qualityScore: 4 },
      ],
      [],
      [avoid('nightlife', 'DIRECT', 1, 1)],
    );
    expect(result.byId.get('a-unknown')!.breakdown.avoidance).toEqual({
      directConflict: 0,
      inferredConflict: 0,
    });
    expect(result.byId.get('a-unknown')!.levelRank).toBe(
      result.byId.get('b-unknown')!.levelRank,
    );
  });

  it('gives a strict rank (id tie-break) and a shared level rank for equal levels', () => {
    const result = derive(
      [
        { id: 'b', themes: ['history'], components: geo, qualityScore: 4 },
        { id: 'a', themes: ['history'], components: geo, qualityScore: 4 },
        { id: 'c', themes: [], components: geo, qualityScore: 4 },
      ],
      [W('history')],
    );
    expect(result.order).toEqual(['a', 'b', 'c']);
    expect(
      ['a', 'b', 'c'].map((id) => [
        result.byId.get(id)!.rank,
        result.byId.get(id)!.levelRank,
      ]),
    ).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
  });

  it('is independent of input order', () => {
    const experiences: Parameters<typeof composableExperience>[0][] = [
      { id: 'x', themes: ['history'], components: geo, qualityScore: 3 },
      { id: 'y', themes: [], components: geo, qualityScore: 5 },
      { id: 'z', themes: ['history'], components: geo, qualityScore: 4 },
    ];
    expect(derive(experiences, [W('history')]).order).toEqual(
      derive([...experiences].reverse(), [W('history')]).order,
    );
  });

  it('counts only strong matches as explicit evidence (geography, quality floor, no text inference)', () => {
    const result = derive(
      [
        { id: 'strong', themes: ['history'], components: geo, qualityScore: 4 },
        {
          id: 'low-quality',
          themes: ['history'],
          components: geo,
          qualityScore: 2,
        },
        { id: 'no-geography', themes: ['history'], qualityScore: 4 },
        {
          id: 'text-only',
          canonicalName: 'Historic museum',
          description: 'A history experience',
          components: geo,
          qualityScore: 4,
        },
      ],
      [W('history')],
    );
    expect(
      ['strong', 'low-quality', 'no-geography', 'text-only'].map(
        (id) => result.byId.get(id)!.breakdown.directEvidence,
      ),
    ).toEqual([1, 0, 0, 0]);
  });

  it('keeps a SOFT accessibility preference neutral without a typed fact and positive with one; embeddings never decide it', () => {
    const facets: RequestedFacet[] = [
      {
        dimension: 'accessibility',
        key: 'avoid_stairs',
        provenance: 'DIRECT',
        importance: 0.7,
        confidence: 0.9,
        evidence: [{ kind: 'USER_TEXT_SPAN', text: 'evitar escaleras' }],
        required: false,
      },
    ];
    const result = derivePreferenceUtility({
      experiences: [
        composableExperience({
          id: 'a-step-free-fact',
          components: geo,
          qualityScore: 3,
          dimensionedTraits: [
            { dimension: 'accessibility', key: 'avoid_stairs' },
          ],
        }),
        composableExperience({
          id: 'b-unknown-similar-text',
          canonicalName: 'Step-free accessible museum',
          components: geo,
          qualityScore: 5,
        }),
      ],
      preferenceSpec: { facets, assertions: [] },
      softAnchorIds: new Set(),
      semantic: {
        status: 'applied',
        scores: new Map([['b-unknown-similar-text', 0.99]]),
        requestedCandidateCount: 2,
        indexedCandidateCount: 1,
        identity: {
          provider: 'ollama',
          model: 'test',
          dimensions: 2,
          documentVersion: 1,
        },
      },
    });
    expect(result.byId.get('a-step-free-fact')!.breakdown.directEvidence).toBe(
      0.7,
    );
    expect(
      result.byId.get('b-unknown-similar-text')!.breakdown.directEvidence,
    ).toBe(0);
    expect(result.order).toEqual([
      'a-step-free-fact',
      'b-unknown-similar-text',
    ]);
  });
});
