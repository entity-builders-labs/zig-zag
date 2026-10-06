import {
  validateAtomLabelling,
  resolveAtomMentions,
} from './atom-labelling-contract.util';
import {
  assembleAtomSegments,
  mandatorySegmentMembers,
} from './atom-segment-assembly.util';
import {
  atomizeSourceUnit,
  markEditorialStructure,
} from './source-atomization.util';

function assembled(lines: string[], labelsFor: (ids: string[]) => unknown[]) {
  const atoms = markEditorialStructure(
    atomizeSourceUnit(lines.join('\n')).atoms,
  ).atoms;
  const byId = new Map(atoms.map((a) => [a.atomId, a]));
  const ids = atoms.map((a) => a.atomId);
  const v = resolveAtomMentions(
    validateAtomLabelling(ids, byId, { atoms: labelsFor(ids) }),
  );
  expect(v.issues).toEqual([]);
  return { ids, atoms, segments: assembleAtomSegments(atoms, v) };
}
const ent = (
  sourceName: string,
  supportSpan: string,
  role: string,
  extra: Record<string, unknown> = {},
) => ({ sourceName, supportSpan, role, ...extra });
const label = (
  atomId: string,
  classification: string,
  entities: unknown[] = [],
  extra: Record<string, unknown> = {},
) => ({ atomId, classification, entities, ...extra });

describe('deterministic segment assembly', () => {
  it('makes ITINERARY_STOP the only mandatory membership', () => {
    const { segments } = assembled(
      [
        'Start at the Old Square, then walk along Harbour Road past the Mill.',
        'If you have time, visit the Shell Museum.',
        'For lunch try Alpha Grill or Beta Bistro.',
        'Arrive at the Fish Market.',
      ],
      (ids) => [
        label(ids[0], 'ITINERARY_STOP', [
          ent('Old Square', 'Start at the Old Square', 'ITINERARY_STOP'),
          ent('Harbour Road', 'walk along Harbour Road', 'ROUTE_LEG'),
          ent('Mill', 'past the Mill', 'PASS_BY'),
        ]),
        label(ids[1], 'OPTIONAL_STOP', [
          ent('Shell Museum', 'visit the Shell Museum', 'OPTIONAL_STOP'),
        ]),
        label(ids[2], 'ALTERNATIVE', [
          ent('Alpha Grill', 'try Alpha Grill', 'ALTERNATIVE'),
          ent('Beta Bistro', 'or Beta Bistro', 'ALTERNATIVE'),
        ]),
        label(ids[3], 'ITINERARY_STOP', [
          ent('Fish Market', 'Arrive at the Fish Market', 'ITINERARY_STOP'),
        ]),
      ],
    );
    expect(segments).toHaveLength(1);
    const [s] = segments;
    expect(s.mandatory).toEqual(['Old Square', 'Fish Market']);
    expect(mandatorySegmentMembers(s).map((m) => m.sourceName)).toEqual(
      s.mandatory,
    );
    // ROUTE_LEG is route provenance, PASS_BY context, OPTIONAL_STOP optional.
    expect(s.routeLegs).toEqual(['Harbour Road']);
    expect(s.passBy).toEqual(['Mill']);
    expect(s.optional).toEqual(['Shell Museum']);
    // A or B stays one choice group; never flattened into A + B.
    expect(s.alternativeGroups).toEqual([['Alpha Grill', 'Beta Bistro']]);
    for (const name of [
      'Harbour Road',
      'Mill',
      'Shell Museum',
      'Alpha Grill',
      'Beta Bistro',
    ])
      expect(s.mandatory).not.toContain(name);
  });

  it('never makes a TRANSFER_DESTINATION membership; a later content atom may still make it a stop', () => {
    const { ids, segments } = assembled(
      [
        'Visit the Fort.',
        'Take the bus to the Harbour District.',
        'Take a taxi to the Lighthouse.',
        'Arrive at the Lighthouse.',
      ],
      (ids) => [
        label(ids[0], 'ITINERARY_STOP', [
          ent('Fort', 'Visit the Fort', 'ITINERARY_STOP'),
        ]),
        label(
          ids[1],
          'TRANSFER',
          [
            ent(
              'Harbour District',
              'bus to the Harbour District',
              'ITINERARY_STOP',
            ),
          ],
          { transferMode: 'BUS' },
        ),
        label(
          ids[2],
          'TRANSFER',
          [ent('Lighthouse', 'taxi to the Lighthouse', 'ROUTE_LEG')],
          { transferMode: 'TAXI' },
        ),
        label(ids[3], 'ITINERARY_STOP', [
          ent('Lighthouse', 'Arrive at the Lighthouse', 'ITINERARY_STOP'),
        ]),
      ],
    );
    expect(segments.map((s) => s.mandatory)).toEqual([
      ['Fort'],
      ['Lighthouse'],
    ]);
    expect(segments[1].transferDestinations).toEqual([
      {
        sourceName: 'Harbour District',
        atomId: ids[1],
        supportSpan: 'bus to the Harbour District',
        modelRole: 'ITINERARY_STOP',
      },
      {
        sourceName: 'Lighthouse',
        atomId: ids[2],
        supportSpan: 'taxi to the Lighthouse',
        modelRole: 'ROUTE_LEG',
      },
    ]);
    expect(segments.flatMap((s) => s.mandatory)).not.toContain(
      'Harbour District',
    );
    // The Lighthouse member comes only from the content atom.
    expect(
      segments[1].members
        .find((m) => m.sourceName === 'Lighthouse')
        .provenance.map((p) => p.atomId),
    ).toEqual([ids[3]]);
    expect(segments[1].conflicts).toEqual([]);
  });

  it('closes a segment at a transfer; back-to-back transfers form one boundary and no empty segment', () => {
    const { ids, segments } = assembled(
      [
        'Take the tram to the centre.',
        'Visit the Old Bridge.',
        'Next: go to the Zoo.',
        'Take a taxi there.',
        'See the Zoo.',
        'Then take a ferry.',
        'Arrive at the Island.',
      ],
      (ids) => [
        label(ids[0], 'TRANSFER', [], { transferMode: 'TRAM' }),
        label(ids[1], 'ITINERARY_STOP', [
          ent('Old Bridge', 'Visit the Old Bridge', 'ITINERARY_STOP'),
        ]),
        label(ids[2], 'TRANSFER', [
          ent('Zoo', 'go to the Zoo', 'ITINERARY_STOP'),
        ]),
        label(ids[3], 'TRANSFER', [], { transferMode: 'TAXI' }),
        label(ids[4], 'ITINERARY_STOP', [
          ent('Zoo', 'See the Zoo', 'ITINERARY_STOP'),
        ]),
        label(ids[5], 'TRANSFER', [], { transferMode: 'FERRY' }),
        label(ids[6], 'ITINERARY_STOP', [
          ent('Island', 'Arrive at the Island', 'ITINERARY_STOP'),
        ]),
      ],
    );
    expect(segments.map((s) => s.mandatory)).toEqual([
      ['Old Bridge'],
      ['Zoo'],
      ['Island'],
    ]);
    // A transfer before any membership opens nothing.
    expect(segments[0].openedBy).toEqual([
      { atomId: ids[0], transferMode: 'TRAM' },
    ]);
    expect(segments[1].openedBy).toEqual([
      { atomId: ids[2], transferMode: 'UNSPECIFIED' },
      { atomId: ids[3], transferMode: 'TAXI' },
    ]);
    expect(segments[2].openedBy).toEqual([
      { atomId: ids[5], transferMode: 'FERRY' },
    ]);
    // Structural ranges cover the unit exactly once.
    expect(segments.map((s) => [s.firstAtomId, s.lastAtomId])).toEqual([
      [ids[0], ids[1]],
      [ids[2], ids[4]],
      [ids[5], ids[6]],
    ]);
  });

  it('a route-leg-only stretch between transfers does not open an empty segment', () => {
    const { segments } = assembled(
      [
        'Start at the Old Square.',
        'Take the tram.',
        'Ride along the Coast Avenue.',
        'Then take a ferry.',
        'Arrive at the Island.',
      ],
      (ids) => [
        label(ids[0], 'ITINERARY_STOP', [
          ent('Old Square', 'Start at the Old Square', 'ITINERARY_STOP'),
        ]),
        label(ids[1], 'TRANSFER', [], { transferMode: 'TRAM' }),
        label(ids[2], 'ROUTE_LEG', [
          ent('Coast Avenue', 'Ride along the Coast Avenue', 'ROUTE_LEG'),
        ]),
        label(ids[3], 'TRANSFER', [], { transferMode: 'FERRY' }),
        label(ids[4], 'ITINERARY_STOP', [
          ent('Island', 'Arrive at the Island', 'ITINERARY_STOP'),
        ]),
      ],
    );
    expect(segments.map((s) => s.mandatory)).toEqual([
      ['Old Square'],
      ['Island'],
    ]);
    expect(segments[1].routeLegs).toEqual(['Coast Avenue']);
    expect(segments[1].openedBy.map((o) => o.transferMode)).toEqual([
      'TRAM',
      'FERRY',
    ]);
  });

  it('orders members by source atoms and spans, never by response order', () => {
    const lines = [
      'Visit the Old Mill, then walk down Long Lane to the Clock Tower.',
      'Arrive at the Fish Market.',
    ];
    const labels = (ids: string[]) => [
      label(ids[0], 'ITINERARY_STOP', [
        ent('Clock Tower', 'to the Clock Tower', 'ITINERARY_STOP'),
        ent('Old Mill', 'Visit the Old Mill', 'ITINERARY_STOP'),
        ent('Long Lane', 'walk down Long Lane', 'ROUTE_LEG'),
      ]),
      label(ids[1], 'ITINERARY_STOP', [
        ent('Fish Market', 'Arrive at the Fish Market', 'ITINERARY_STOP'),
      ]),
    ];
    const forward = assembled(lines, labels).segments;
    const reversed = assembled(lines, (ids) =>
      [...labels(ids)].reverse(),
    ).segments;
    expect(forward[0].mandatory).toEqual([
      'Old Mill',
      'Clock Tower',
      'Fish Market',
    ]);
    expect(reversed).toEqual(forward);
  });

  it('keeps a stronger stop over a route leg for one name and records the conflict', () => {
    const { ids, segments } = assembled(
      ['Go to Long Street.', 'Visit the Fort.', 'Walk back along Long Street.'],
      (ids) => [
        label(ids[0], 'ITINERARY_STOP', [
          ent('Long Street', 'Go to Long Street', 'ITINERARY_STOP'),
        ]),
        label(ids[1], 'ITINERARY_STOP', [
          ent('Fort', 'Visit the Fort', 'ITINERARY_STOP'),
        ]),
        label(ids[2], 'ROUTE_LEG', [
          ent('Long Street', 'along Long Street', 'ROUTE_LEG'),
        ]),
      ],
    );
    expect(segments[0].mandatory).toEqual(['Long Street', 'Fort']);
    expect(segments[0].conflicts).toEqual([
      {
        code: 'ROLE_CONFLICT',
        sourceName: 'Long Street',
        routeLegAtoms: [ids[2]],
        stopAtoms: [ids[0]],
      },
    ]);
  });

  it('alternatives across entity-less atoms form one group; a stop between them starts another', () => {
    const { segments } = assembled(
      [
        'For lunch try Alpha Grill.',
        'It is cheap.',
        'Or try Beta Bistro.',
        'Visit the Fort.',
        'Or try Gamma Bar.',
      ],
      (ids) => [
        label(ids[0], 'ALTERNATIVE', [
          ent('Alpha Grill', 'try Alpha Grill', 'ALTERNATIVE'),
        ]),
        label(ids[1], 'NON_ITINERARY'),
        label(ids[2], 'ALTERNATIVE', [
          ent('Beta Bistro', 'try Beta Bistro', 'ALTERNATIVE'),
        ]),
        label(ids[3], 'ITINERARY_STOP', [
          ent('Fort', 'Visit the Fort', 'ITINERARY_STOP'),
        ]),
        label(ids[4], 'ALTERNATIVE', [
          ent('Gamma Bar', 'try Gamma Bar', 'ALTERNATIVE'),
        ]),
      ],
    );
    expect(segments[0].alternativeGroups).toEqual([
      ['Alpha Grill', 'Beta Bistro'],
      ['Gamma Bar'],
    ]);
    expect(segments[0].mandatory).toEqual(['Fort']);
  });
});
