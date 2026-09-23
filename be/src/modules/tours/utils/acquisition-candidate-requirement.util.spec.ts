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
  overrides: Partial<ExperienceCandidate['componentHints'][number]> = {},
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
  evidenceKeys: ['evidence'],
  ...overrides,
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
    [candidate(hint('ROUTE')), 'MULTI_COMPONENT_EXPERIENCE', false],
    [
      candidate(hint('AREA'), hint('ROUTE')),
      'MULTI_COMPONENT_EXPERIENCE',
      false,
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

  /**
   * Stage 2 corrective fix: MULTI_COMPONENT_EXPERIENCE must count DISTINCT
   * obvious components, collapsed by a deterministic fingerprint
   * (normalized name + role + expectedKind) before counting -- the same
   * obvious component duplicated twice (even under a different hint `key`
   * or `evidenceKeys`) must not fake a two-component experience.
   */
  describe('distinct-component fingerprint (Stage 2 corrective fix)', () => {
    it('the same PLACE component duplicated (identical key/name) does NOT satisfy MULTI_COMPONENT_EXPERIENCE', () => {
      const value = candidate(
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(false);
    });

    it('the same PLACE component duplicated under a DIFFERENT hint key/evidenceKeys still collapses to one and does NOT satisfy MULTI_COMPONENT_EXPERIENCE', () => {
      const value = candidate(
        hint('PLACE', {
          key: 'plaza-dorrego-a',
          name: 'Plaza Dorrego',
          evidenceKeys: ['ev-1'],
        }),
        hint('PLACE', {
          key: 'plaza-dorrego-b',
          name: 'Plaza Dorrego',
          evidenceKeys: ['ev-2'],
        }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(false);
    });

    it('two genuinely different PLACE components DO satisfy MULTI_COMPONENT_EXPERIENCE', () => {
      const value = candidate(
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
        hint('PLACE', { key: 'el-zanjon', name: 'El Zanjón de Granados' }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(true);
    });

    it('a distinct PLACE + ROUTE component DOES satisfy MULTI_COMPONENT_EXPERIENCE', () => {
      const value = candidate(
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
        hint('ROUTE', { key: 'calle-defensa', name: 'Calle Defensa' }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(true);
    });

    it('AREA plus a single distinct PLACE does NOT satisfy MULTI_COMPONENT_EXPERIENCE (area is never a meaningful component)', () => {
      const value = candidate(
        hint('AREA', { key: 'san-telmo', name: 'San Telmo' }),
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(false);
    });

    it('AREA + distinct PLACE + distinct ROUTE DOES satisfy MULTI_COMPONENT_EXPERIENCE', () => {
      const value = candidate(
        hint('AREA', { key: 'san-telmo', name: 'San Telmo' }),
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
        hint('ROUTE', { key: 'calle-defensa', name: 'Calle Defensa' }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(true);
    });

    it('normalizes case/diacritics/punctuation/whitespace when fingerprinting, so trivial formatting differences still collapse to one component', () => {
      const value = candidate(
        hint('PLACE', { key: 'a', name: 'Plaza  Dorrego' }),
        hint('PLACE', { key: 'b', name: 'plaza-dorrego!' }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(false);
    });

    it('the same name under a different role/expectedKind counts as a distinct component (role/kind participate in the fingerprint)', () => {
      const value = candidate(
        hint('PLACE', { key: 'a', name: 'Defensa', role: 'venue' }),
        hint('ROUTE', { key: 'b', name: 'Defensa', role: 'route' }),
      );
      expect(
        candidateSatisfiesEvidenceRequirement(
          value,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(true);
    });

    it('SINGLE_PLACE uses the same distinct-component set: two duplicate PLACE hints collapse to exactly one distinct meaningful component', () => {
      const value = candidate(
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
        hint('PLACE', { key: 'plaza-dorrego', name: 'Plaza Dorrego' }),
      );
      expect(candidateSatisfiesEvidenceRequirement(value, 'SINGLE_PLACE')).toBe(
        true,
      );
    });
  });
});
