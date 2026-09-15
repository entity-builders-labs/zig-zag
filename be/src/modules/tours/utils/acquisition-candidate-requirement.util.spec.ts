import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { candidateSatisfiesEvidenceRequirement } from './acquisition-candidate-requirement.util';

const candidate = (
  ...hints: ExperienceCandidate['componentHints']
): ExperienceCandidate => ({
  name: 'Candidate',
  themes: ['history'],
  traits: [],
  intents: ['walk'],
  componentHints: hints,
  evidenceKeys: ['evidence'],
  shortReason: 'test',
});
const hint = (
  expectedKind: 'PLACE' | 'AREA' | 'ROUTE',
  required = true,
): ExperienceCandidate['componentHints'][number] => ({
  key: expectedKind,
  name: expectedKind,
  role:
    expectedKind === 'PLACE'
      ? 'venue'
      : expectedKind === 'AREA'
        ? 'area'
        : 'route',
  expectedKind,
  required,
  evidenceKeys: ['evidence'],
});

describe('candidateSatisfiesEvidenceRequirement', () => {
  it.each([
    [candidate(hint('AREA')), 'GENERAL_TOURISM_EXPERIENCE', false],
    [candidate(hint('PLACE')), 'GENERAL_TOURISM_EXPERIENCE', true],
    [candidate(hint('PLACE')), 'SINGLE_PLACE', true],
    [candidate(hint('AREA'), hint('PLACE')), 'COMPOSITE_WALK', false],
    [
      candidate(hint('AREA'), hint('PLACE'), hint('ROUTE')),
      'COMPOSITE_WALK',
      true,
    ],
    [candidate(hint('PLACE'), hint('PLACE')), 'COMPOSITE_WALK', true],
    [candidate(hint('PLACE'), hint('PLACE', false)), 'COMPOSITE_WALK', false],
    [candidate(hint('ROUTE')), 'CANONICAL_ROUTE', true],
    [candidate(hint('PLACE'), hint('PLACE')), 'CANONICAL_ROUTE', false],
  ])('%s satisfies %s = %s', (value, requirement, expected) => {
    expect(
      candidateSatisfiesEvidenceRequirement(
        value,
        requirement as AcquisitionEvidenceRequirement,
      ),
    ).toBe(expected);
  });

  it('ignores candidate intents, themes, and name', () => {
    const value: ExperienceCandidate = {
      ...candidate(hint('PLACE')),
      intents: [],
      themes: [],
      name: 'walk',
    };
    expect(candidateSatisfiesEvidenceRequirement(value, 'SINGLE_PLACE')).toBe(
      true,
    );
  });
});
