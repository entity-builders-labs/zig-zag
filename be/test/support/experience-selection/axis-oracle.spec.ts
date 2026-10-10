import {
  axisCosine,
  projectAxisVector,
  queryToAxisWeights,
} from './axis-oracle';

describe('competitive semantic oracle', () => {
  it('parses bare Preference-First semantic queries', () => {
    const iconic = queryToAxisWeights(
      'iconic must-see landmarks and famous historic architecture',
    );
    const local = queryToAxisWeights(
      'hidden history in local neighborhoods, offbeat residential streets',
    );

    expect(iconic.iconic).toBeGreaterThan(0);
    expect(local.hidden_history).toBeGreaterThan(0);
    expect(local.local).toBeGreaterThan(0);
    expect(projectAxisVector(iconic)).not.toEqual(projectAxisVector(local));
  });

  it('ranks the corresponding corpus axes directionally', () => {
    const iconicQuery = queryToAxisWeights(
      'iconic must-see landmarks and famous historic architecture',
    );
    const iconic = { history: 1, architecture: 1, iconic: 1 };
    const religious = { history: 1, architecture: 1, religion: 1 };
    const localQuery = queryToAxisWeights(
      'hidden history in local neighborhoods, offbeat residential streets',
    );
    const hidden = {
      history: 1,
      architecture: 1,
      hidden_history: 1,
      local: 1,
    };

    expect(axisCosine(iconicQuery, iconic)).toBeGreaterThan(
      axisCosine(iconicQuery, religious),
    );
    expect(axisCosine(localQuery, hidden)).toBeGreaterThan(
      axisCosine(localQuery, iconic),
    );
  });
});
