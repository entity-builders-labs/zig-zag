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
    [candidate(hint('AREA')), 'SINGLE_PLACE', false],
    [candidate(hint('PLACE')), 'SINGLE_PLACE', true],
    [
      candidate(hint('AREA'), hint('PLACE')),
      'MULTI_COMPONENT_EXPERIENCE',
      false,
    ],
    [
      candidate(hint('AREA'), hint('PLACE'), hint('ROUTE')),
      'MULTI_COMPONENT_EXPERIENCE',
      true,
    ],
    [
      candidate(hint('PLACE'), hint('PLACE')),
      'MULTI_COMPONENT_EXPERIENCE',
      true,
    ],
    [
      candidate(hint('PLACE'), hint('PLACE', false)),
      'MULTI_COMPONENT_EXPERIENCE',
      false,
    ],
    [candidate(hint('ROUTE')), 'MULTI_COMPONENT_EXPERIENCE', false],
    [
      candidate(hint('AREA'), hint('ROUTE')),
      'MULTI_COMPONENT_EXPERIENCE',
      false,
    ],
    [
      candidate(hint('PLACE'), hint('PLACE'), hint('PLACE')),
      'MULTI_COMPONENT_EXPERIENCE',
      true,
    ],
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
