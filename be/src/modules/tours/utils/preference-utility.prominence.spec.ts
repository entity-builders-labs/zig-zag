import { composableExperience } from '../fixtures/composable-experience.fixture';
import { derivePreferenceUtility } from './preference-utility.util';
import { RequestedFacet } from '../interfaces/preference-spec.interface';
import {
  ProminenceEvidenceFact,
  prominenceProfile,
  STRUCTURED_PROMINENCE_POLICY_VERSION,
} from '../prominence/structured-prominence.policy';
import { SemanticSimilarityResult } from '@shared/ai/interfaces/embedding-index.interface';

const observedAt = new Date('2026-10-23T00:00:00Z');
const fact = (
  kind: ProminenceEvidenceFact['kind'],
  extra: Partial<ProminenceEvidenceFact> = {},
): ProminenceEvidenceFact => ({
  kind,
  sourceProvider: 'provider-a',
  providerIdentity: 'item',
  sourceRecordId: 'record',
  fieldPath: 'field',
  observedAt,
  ...extra,
});
const sitelinks = (count: number) =>
  prominenceProfile([
    fact('ENCYCLOPEDIC_SITELINK_COUNT', { numericValue: count }),
  ]);
const heritage = () =>
  prominenceProfile([
    fact('HERITAGE_DESIGNATION', { designationLevel: 'designation-1' }),
  ]);

const historyFacet: RequestedFacet = {
  dimension: 'theme',
  key: 'history',
  provenance: 'DIRECT',
  importance: 1,
  confidence: 1,
  evidence: [],
  required: false,
};

function derive(
  experiences: ReturnType<typeof composableExperience>[],
  options: {
    facets?: RequestedFacet[];
    semantic?: SemanticSimilarityResult | null;
  } = {},
) {
  return derivePreferenceUtility({
    experiences,
    preferenceSpec: { facets: options.facets ?? [], assertions: [] },
    softAnchorIds: new Set(),
    semantic: options.semantic ?? null,
  });
}

describe('preference utility · structured prominence level (task 39.4)', () => {
  it('orders strong prominence evidence before UNKNOWN when every preference level is equal', () => {
    const result = derive([
      composableExperience({ id: 'a-unknown' }),
      composableExperience({ id: 'z-known', prominence: sitelinks(40) }),
    ]);

    expect(result.order).toEqual(['z-known', 'a-unknown']);
    expect(result.byId.get('z-known')!.prominence).toEqual(sitelinks(40));
    expect(result.byId.get('a-unknown')!.prominence).toEqual(
      prominenceProfile([]),
    );
    expect(result.byId.get('a-unknown')!.orderDecision).toEqual({
      after: 'z-known',
      decidedBy: 'PROMINENCE',
      prominenceLevel: 'ENCYCLOPEDIC_SITELINKS',
      prominencePolicyVersion: STRUCTURED_PROMINENCE_POLICY_VERSION,
    });
  });

  it('keeps UNKNOWN-prominence candidates valid and ordered deterministically by identity', () => {
    const result = derive([
      composableExperience({ id: 'b' }),
      composableExperience({ id: 'a' }),
    ]);
    expect(result.order).toEqual(['a', 'b']);
    expect(result.byId.get('b')!.orderDecision).toEqual({
      after: 'a',
      decidedBy: 'EXPERIENCE_ID',
    });
  });

  it('compares typed levels lexicographically (heritage before sitelink count)', () => {
    const result = derive([
      composableExperience({ id: 'links', prominence: sitelinks(90) }),
      composableExperience({ id: 'heritage', prominence: heritage() }),
    ]);
    expect(result.order).toEqual(['heritage', 'links']);
    expect(result.byId.get('links')!.orderDecision).toMatchObject({
      decidedBy: 'PROMINENCE',
      prominenceLevel: 'HERITAGE_DESIGNATION',
    });
  });

  it('never lets prominence override stated preference relevance', () => {
    const result = derive(
      [
        composableExperience({ id: 'famous', prominence: heritage() }),
        composableExperience({
          id: 'relevant',
          themes: ['history'],
          qualityScore: 4,
          components: [{ geoEntity: { latitude: 1, longitude: 2 } }],
        }),
      ],
      { facets: [historyFacet] },
    );
    expect(result.order).toEqual(['relevant', 'famous']);
    expect(result.byId.get('famous')!.orderDecision).toEqual({
      after: 'relevant',
      decidedBy: 'DIRECT_EVIDENCE',
    });
    // Preference breakdown stays numeric and separate from prominence.
    expect(result.byId.get('famous')!.breakdown).not.toHaveProperty(
      'prominence',
    );
  });

  it('keeps KNOWN semantic affinity prior to prominence', () => {
    const semantic: SemanticSimilarityResult = {
      status: 'applied',
      scores: new Map([
        ['famous', 0.2],
        ['closer', 0.9],
      ]),
      requestedCandidateCount: 2,
      indexedCandidateCount: 2,
    } as SemanticSimilarityResult;
    const result = derive(
      [
        composableExperience({ id: 'famous', prominence: sitelinks(99) }),
        composableExperience({ id: 'closer' }),
      ],
      { semantic },
    );
    expect(result.order).toEqual(['closer', 'famous']);
    expect(result.byId.get('famous')!.orderDecision.decidedBy).toBe(
      'SEMANTIC_AFFINITY',
    );
  });

  it('orders prominence before generic quality', () => {
    const result = derive([
      composableExperience({ id: 'quality', qualityScore: 5 }),
      composableExperience({ id: 'prominent', prominence: sitelinks(2) }),
    ]);
    expect(result.order).toEqual(['prominent', 'quality']);
  });

  it('is pure: re-deriving yields the same order and never mutates the candidates', () => {
    const experiences = [
      composableExperience({ id: 'x', prominence: sitelinks(3) }),
      composableExperience({ id: 'y' }),
    ];
    const snapshot = JSON.stringify(experiences);
    expect(derive(experiences).order).toEqual(
      derive([...experiences].reverse()).order,
    );
    expect(JSON.stringify(experiences)).toBe(snapshot);
  });
});
