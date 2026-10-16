import { osmTargetFacts } from './osm-target-knowledge.provider';

describe('osmTargetFacts', () => {
  it('maps wheelchair=yes to accessibility:wheelchair_access SATISFIES', () => {
    expect(
      osmTargetFacts({ id: 'node/1', tags: { wheelchair: 'yes' } }),
    ).toEqual([
      {
        target: { dimension: 'accessibility', key: 'wheelchair_access' },
        observation: {
          sourceFactId: 'node/1:wheelchair',
          state: 'SATISFIES',
        },
      },
    ]);
  });

  it('maps wheelchair=no to DOES_NOT_SATISFY and limited to INCONCLUSIVE', () => {
    expect(
      osmTargetFacts({ id: 'node/2', tags: { wheelchair: 'no' } }),
    ).toEqual([
      {
        target: { dimension: 'accessibility', key: 'wheelchair_access' },
        observation: {
          sourceFactId: 'node/2:wheelchair',
          state: 'DOES_NOT_SATISFY',
        },
      },
    ]);
    expect(
      osmTargetFacts({ id: 'node/3', tags: { wheelchair: 'limited' } }),
    ).toEqual([
      {
        target: { dimension: 'accessibility', key: 'wheelchair_access' },
        observation: {
          sourceFactId: 'node/3:wheelchair',
          state: 'INCONCLUSIVE',
        },
      },
    ]);
  });

  it('maps diet:vegan=yes|only to SATISFIES and no to DOES_NOT_SATISFY', () => {
    expect(
      osmTargetFacts({ id: 'node/4', tags: { 'diet:vegan': 'yes' } }),
    ).toEqual([
      {
        target: { dimension: 'dietary_suitability', key: 'vegan' },
        observation: { sourceFactId: 'node/4:diet:vegan', state: 'SATISFIES' },
      },
    ]);
    expect(
      osmTargetFacts({ id: 'node/5', tags: { 'diet:vegan': 'only' } }),
    ).toEqual([
      {
        target: { dimension: 'dietary_suitability', key: 'vegan' },
        observation: { sourceFactId: 'node/5:diet:vegan', state: 'SATISFIES' },
      },
    ]);
    expect(
      osmTargetFacts({ id: 'node/6', tags: { 'diet:vegan': 'no' } }),
    ).toEqual([
      {
        target: { dimension: 'dietary_suitability', key: 'vegan' },
        observation: {
          sourceFactId: 'node/6:diet:vegan',
          state: 'DOES_NOT_SATISFY',
        },
      },
    ]);
  });

  it('never derives avoid_stairs or limited_mobility from wheelchair=*', () => {
    const facts = osmTargetFacts({ id: 'node/7', tags: { wheelchair: 'yes' } });
    expect(facts.map((fact) => fact.target.key)).not.toContain('avoid_stairs');
    expect(facts.map((fact) => fact.target.key)).not.toContain(
      'limited_mobility',
    );
  });

  it('produces nothing for missing or unsupported values (UNKNOWN)', () => {
    expect(osmTargetFacts({ id: 'node/8', tags: {} })).toEqual([]);
    expect(
      osmTargetFacts({ id: 'node/9', tags: { 'diet:vegan': 'intermediate' } }),
    ).toEqual([]);
  });
});
