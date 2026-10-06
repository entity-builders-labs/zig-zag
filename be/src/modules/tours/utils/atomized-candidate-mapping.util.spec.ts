import { AssembledSegment } from '../interfaces/atomized-source-unit.interface';
import {
  isAtomizableSourceUnit,
  memberHintName,
  memberSupportSpan,
  nameAtomizedCandidates,
  validateMemberKinds,
} from './atomized-candidate-mapping.util';
import {
  atomizeSourceUnit,
  markEditorialStructure,
} from './source-atomization.util';

const segment = (
  segmentIndex: number,
  firstAtomId: string,
  lastAtomId: string,
): AssembledSegment => ({
  segmentIndex,
  firstAtomId,
  lastAtomId,
  openedBy: [],
  transferDestinations: [],
  conflicts: [],
  mandatory: ['X'],
  optional: [],
  alternativeGroups: [],
  routeLegs: [],
  passBy: [],
  members: [],
});
const atomsOf = (lines: string[]) =>
  markEditorialStructure(atomizeSourceUnit(lines.join('\n')).atoms).atoms;

describe('atomized candidate mapping', () => {
  it('routes only a complete SECTION_UNIT window to the atomized authority', () => {
    expect(
      isAtomizableSourceUnit({
        selectionStrategy: 'SECTION_UNIT',
        sectionComplete: true,
      }),
    ).toBe(true);
    for (const w of [
      { selectionStrategy: 'SECTION_UNIT' as const, sectionComplete: false },
      {
        selectionStrategy: 'RELEVANCE_WINDOWS' as const,
        sectionComplete: false,
      },
      {
        selectionStrategy: 'DOCUMENT_ORDER_CONTINUATION' as const,
        sectionComplete: true,
      },
      { selectionStrategy: 'WHOLE_DOCUMENT' as const, sectionComplete: true },
    ])
      expect(isAtomizableSourceUnit(w)).toBe(false);
  });

  it('accepts exactly one valid physical kind per member and fails on anything else', () => {
    const ids = ['m-1', 'm-2'];
    expect(
      validateMemberKinds(1, ids, {
        members: [
          { memberId: 'm-1', physicalKind: 'PLACE' },
          { memberId: 'm-2', physicalKind: 'ROUTE' },
        ],
      }),
    ).toEqual({
      kinds: new Map([
        ['m-1', 'PLACE'],
        ['m-2', 'ROUTE'],
      ]),
      issues: [],
    });
    const codes = (response: unknown) =>
      validateMemberKinds(1, ids, response).issues.map(
        (x) => `${x.code}${x.memberId ? `:${x.memberId}` : ''}`,
      );
    expect(codes(null)).toEqual(['KIND_MALFORMED_RESPONSE']);
    expect(
      codes({
        members: [
          { memberId: 'm-1', physicalKind: 'PLACE' },
          { memberId: 'm-1', physicalKind: 'AREA' },
          { memberId: 'm-3', physicalKind: 'PLACE' },
          { physicalKind: 'PLACE' },
        ],
      }),
    ).toEqual([
      'KIND_DUPLICATE_MEMBER:m-1',
      'KIND_UNKNOWN_MEMBER:m-3',
      'KIND_MALFORMED_ENTRY',
      'KIND_MISSING_MEMBER:m-2',
    ]);
    expect(
      codes({
        members: [
          { memberId: 'm-1', physicalKind: 'PLACE' },
          { memberId: 'm-2', physicalKind: 'STREET' },
        ],
      }),
    ).toEqual(['KIND_INVALID:m-2']);
  });

  it('names candidates from the unit heading, a unique segment heading, the source title or a part suffix', () => {
    const atoms = atomsOf([
      '## Two days',
      '### Morning',
      'Visit A.',
      '### Afternoon',
      'Visit B.',
      'Visit C.',
    ]);
    const [h, m, a, f, b, c] = atoms.map((x) => x.atomId);
    expect(nameAtomizedCandidates([segment(1, h, a)], atoms, 'Title')).toEqual(
      new Map([[1, 'Two days']]),
    );
    expect(
      nameAtomizedCandidates(
        [segment(1, h, a), segment(2, f, c)],
        atoms,
        'Title',
      ),
    ).toEqual(
      new Map([
        [1, 'Two days — Morning'],
        [2, 'Two days — Afternoon'],
      ]),
    );
    // Two headings in one segment: no unique source name for it.
    expect(
      nameAtomizedCandidates(
        [segment(1, h, f), segment(2, b, c)],
        atoms,
        'Title',
      ),
    ).toEqual(
      new Map([
        [1, 'Two days (part 1 of 2)'],
        [2, 'Two days (part 2 of 2)'],
      ]),
    );
    expect(m).toBeDefined();
    // No heading: the grounded source title; neither: unknown.
    const plain = atomsOf(['Visit A.', 'Visit B.']);
    expect(
      nameAtomizedCandidates(
        [segment(1, plain[0].atomId, plain[1].atomId)],
        plain,
        ' Source title ',
      ),
    ).toEqual(new Map([[1, 'Source title']]));
    expect(
      nameAtomizedCandidates(
        [segment(1, plain[0].atomId, plain[1].atomId)],
        plain,
        undefined,
      ),
    ).toBeNull();
  });

  it('falls back to the part suffix only for segments whose source names collide', () => {
    const atoms = atomsOf([
      '## Walks',
      '### Stop',
      'Visit A.',
      '### Stop',
      'Visit B.',
      '### Other',
      'Visit C.',
    ]);
    const ids = atoms.map((x) => x.atomId);
    expect(
      nameAtomizedCandidates(
        [
          segment(1, ids[0], ids[2]),
          segment(2, ids[3], ids[4]),
          segment(3, ids[5], ids[6]),
        ],
        atoms,
        undefined,
      ),
    ).toEqual(
      new Map([
        [1, 'Walks (part 1 of 3)'],
        [2, 'Walks (part 2 of 3)'],
        [3, 'Walks — Other'],
      ]),
    );
  });

  it('uses the source wording as hint name and a literal unit slice as support span', () => {
    expect(memberHintName('"Farmacia la Estrella"')).toBe(
      'Farmacia la Estrella',
    );
    expect(memberHintName(' **Plaza Dorrego** ')).toBe('Plaza Dorrego');
    expect(memberHintName("O'Higgins")).toBe("O'Higgins");
    const text = 'You pass the Grain Market. Jump inside.';
    const member = {
      position: 1,
      sourceName: 'Grain Market',
      role: 'ITINERARY_STOP' as const,
      provenance: [
        {
          atomId: 'a-001',
          supportSpan: 'pass the Grain Market',
          sourceStart: 4,
          sourceEnd: 25,
          role: 'PASS_BY' as const,
        },
        {
          atomId: 'a-002',
          supportSpan: 'Jump inside',
          sourceStart: 27,
          sourceEnd: 38,
          role: 'ITINERARY_STOP' as const,
          mention: { atomId: 'a-001', sourceStart: 4, sourceEnd: 25 },
        },
      ],
    };
    // The stop occurrence does not name it; the earlier occurrence does.
    expect(memberSupportSpan(member, text)).toBe('pass the Grain Market');
    expect(
      memberSupportSpan(
        { ...member, provenance: [member.provenance[1]] },
        text,
      ),
    ).toBe('pass the Grain Market');
  });
});
