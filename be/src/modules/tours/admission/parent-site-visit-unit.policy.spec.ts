import {
  evaluateChildVisitUnit,
  ParentSiteCandidate,
} from './parent-site-visit-unit.policy';

const admitted = (ids: string[]) =>
  new Map(ids.map((id) => [id, true] as const));

describe('parent/child visit-unit policy (design C5)', () => {
  const parent = (
    parentId: string,
    parentClass: ParentSiteCandidate['parentClass'],
    basis: ParentSiteCandidate['basis'],
  ): ParentSiteCandidate => ({ parentId, parentClass, basis });

  it('a tomb in an admitted cemetery is SUB_FEATURE_OF (planner receives the cemetery Experience)', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'grave',
      parents: [parent('cem-1', 'cemetery', { kind: 'CONTAINMENT' })],
      parentAdmitted: admitted(['cem-1']),
    });
    expect(outcome).toEqual({
      outcome: 'SUB_FEATURE_OF',
      parentId: 'cem-1',
      visitUnit: 'CHILD_REQUIRES_PARENT_VISIT',
    });
  });

  it('a tomb in a non-admitted cemetery is PARENT_NOT_ADMITTED and never offered', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'grave',
      parents: [parent('cem-1', 'cemetery', { kind: 'CONTAINMENT' })],
      parentAdmitted: new Map(),
    });
    expect(outcome).toEqual({
      outcome: 'PARENT_NOT_ADMITTED',
      parentId: 'cem-1',
      visitUnit: 'CHILD_REQUIRES_PARENT_VISIT',
    });
  });

  it('a venue inside a park is INDEPENDENTLY_VISITABLE and keeps its PART_OF', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'venue',
      parents: [parent('park-1', 'park_or_complex', { kind: 'CONTAINMENT' })],
      perInstanceEvidence: { separateEntrance: true },
      parentAdmitted: admitted(['park-1']),
    });
    expect(outcome).toEqual({
      outcome: 'INDEPENDENTLY_VISITABLE',
      partOfParentIds: ['park-1'],
    });
  });

  it('an artwork in a museum with its own entrance and hours is ambiguous (default REQUIRES vs independent evidence)', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'artwork',
      parents: [parent('museum-1', 'museum', { kind: 'CONTAINMENT' })],
      perInstanceEvidence: {
        separateEntrance: true,
        separateOpeningHours: true,
      },
      parentAdmitted: admitted(['museum-1']),
    });
    expect(outcome).toEqual({ outcome: 'AMBIGUOUS_PARENT_RELATIONSHIP' });
  });

  it('several plausible direct visit parents fail closed (ambiguous)', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'grave',
      parents: [
        parent('cem-1', 'cemetery', { kind: 'CONTAINMENT' }),
        parent('cem-2', 'cemetery', { kind: 'EXPLICIT_PROVIDER_RELATIONSHIP' }),
      ],
      parentAdmitted: admitted(['cem-1', 'cem-2']),
    });
    expect(outcome).toEqual({ outcome: 'AMBIGUOUS_PARENT_RELATIONSHIP' });
  });

  it('containment without a declared relationship class establishes no relationship', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'venue',
      parents: [parent('cem-1', 'cemetery', { kind: 'CONTAINMENT' })],
      parentAdmitted: admitted(['cem-1']),
    });
    expect(outcome).toEqual({ outcome: 'NO_PARENT_RELATIONSHIP' });
  });

  it('an explicit provider relationship with no declared class and no independent evidence is ambiguous', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'artwork',
      parents: [
        parent('cem-1', 'cemetery', { kind: 'EXPLICIT_PROVIDER_RELATIONSHIP' }),
      ],
      parentAdmitted: admitted(['cem-1']),
    });
    expect(outcome).toEqual({ outcome: 'AMBIGUOUS_PARENT_RELATIONSHIP' });
  });

  it('an explicit provider relationship with independent evidence is INDEPENDENTLY_VISITABLE', () => {
    const outcome = evaluateChildVisitUnit({
      childClass: 'artwork',
      parents: [
        parent('cem-1', 'cemetery', { kind: 'EXPLICIT_PROVIDER_RELATIONSHIP' }),
      ],
      perInstanceEvidence: { separateOpeningHours: true },
      parentAdmitted: admitted(['cem-1']),
    });
    expect(outcome).toEqual({
      outcome: 'INDEPENDENTLY_VISITABLE',
      partOfParentIds: ['cem-1'],
    });
  });
});
