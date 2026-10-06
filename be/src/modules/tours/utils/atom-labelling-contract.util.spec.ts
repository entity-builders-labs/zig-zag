import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  StructuredSourceAtom,
  AtomLabellingValidation,
} from '../interfaces/atomized-source-unit.interface';
import {
  ATOM_LABELLING_SCHEMA,
  ATOM_LABELLING_SYSTEM_PROMPT,
  buildAtomLabellingPrompt,
  buildAtomRelabellingPrompt,
} from '../prompts/source-atom-labelling.prompt';
import {
  DEFAULT_ATOM_BATCH_MAX_CHARS,
  applyAtomRelabel,
  atomRelabelBatch,
  atomRelabelScope,
  mergeAtomLabellings,
  planAtomBatches,
  resolveAtomMentions,
  structuralAtomLabels,
  validateAtomLabelling,
} from './atom-labelling-contract.util';
import { assembleAtomSegments } from './atom-segment-assembly.util';
import {
  atomizeSourceUnit,
  markEditorialStructure,
} from './source-atomization.util';

const FIXTURES = join(__dirname, '../fixtures/atomized-source-units');
const golden = JSON.parse(
  readFileSync(join(FIXTURES, 'spike-golden.json'), 'utf8'),
);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Editorial atoms of `text` (every atom editorial unless structural). */
function unitOf(text: string) {
  const atoms = markEditorialStructure(atomizeSourceUnit(text).atoms).atoms;
  const byId = new Map(atoms.map((a) => [a.atomId, a]));
  const ids = atoms.map((a) => a.atomId);
  return { atoms, byId, ids };
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
const codes = (v: AtomLabellingValidation) =>
  v.issues.map((x) => `${x.code}${x.atomId ? `:${x.atomId}` : ''}`);

const WALK = [
  'Start at the Old Square.',
  'Walk along Harbour Road to the Fish Market.',
  'Take the number 7 bus to the Lighthouse.',
  'Arrive at the Lighthouse.',
  'Prices are low.',
].join('\n');

function walkLabels(ids: string[]) {
  return [
    label(ids[0], 'ITINERARY_STOP', [
      ent('Old Square', 'Start at the Old Square', 'ITINERARY_STOP'),
    ]),
    label(ids[1], 'ITINERARY_STOP', [
      ent('Harbour Road', 'Walk along Harbour Road', 'ROUTE_LEG'),
      ent('Fish Market', 'to the Fish Market', 'ITINERARY_STOP'),
    ]),
    label(
      ids[2],
      'TRANSFER',
      [ent('Lighthouse', 'bus to the Lighthouse', 'ITINERARY_STOP')],
      { transferMode: 'BUS' },
    ),
    label(ids[3], 'ITINERARY_STOP', [
      ent('Lighthouse', 'Arrive at the Lighthouse', 'ITINERARY_STOP'),
    ]),
    label(ids[4], 'NON_ITINERARY'),
  ];
}

describe('atom labelling prompt', () => {
  it('is byte-identical to the accepted spike prompt v4 (no prompt tuning)', () => {
    expect(sha(ATOM_LABELLING_SYSTEM_PROMPT)).toBe(golden.systemPromptSha256);
    expect(sha(JSON.stringify(ATOM_LABELLING_SCHEMA))).toBe(
      golden.schemaSha256,
    );
    for (const file of ['sob-day1-unit.md', 'ag-san-telmo-unit.md']) {
      const { atoms, byId } = unitOf(
        readFileSync(join(FIXTURES, file), 'utf8'),
      );
      const batches = planAtomBatches(
        atoms.filter((a) => a.editorial),
        { maxBatchChars: DEFAULT_ATOM_BATCH_MAX_CHARS },
      );
      const ref = golden.units[file].batches;
      expect(
        batches.map((b) => ({
          batchIndex: b.batchIndex,
          atomIds: b.atomIds,
          contextAtomIds: b.contextAtomIds,
          promptSha256: sha(buildAtomLabellingPrompt(b, byId)),
        })),
      ).toEqual(ref);
    }
  });

  it('never presents a non-editorial atom or a context atom as LABEL', () => {
    const text = readFileSync(join(FIXTURES, 'sob-day1-unit.md'), 'utf8');
    const { atoms, byId } = unitOf(text);
    const nav = atoms.filter((a) => !a.editorial).map((a) => a.atomId);
    for (const b of planAtomBatches(atoms.filter((a) => a.editorial))) {
      const prompt = buildAtomLabellingPrompt(b, byId);
      for (const id of nav) expect(prompt).not.toContain(`[${id}]`);
      const labelPart = prompt.split('\nLABEL:\n')[1];
      for (const id of b.atomIds)
        expect(labelPart.split(`[${id}]`)).toHaveLength(2);
      for (const id of b.contextAtomIds)
        expect(labelPart).not.toContain(`[${id}]`);
    }
  });
});

describe('semantic contract: exactly one valid result per atom', () => {
  const { atoms, byId, ids } = unitOf(WALK);
  const validate = (labels: unknown[] | null) =>
    validateAtomLabelling(
      ids,
      byId,
      labels === null ? null : { atoms: labels },
    );

  it('accepts exactly one label per atom, with zero, one or several entities', () => {
    const v = validate(walkLabels(ids));
    expect(v.issues).toEqual([]);
    expect(v.valid).toBe(true);
    expect(v.labels.size).toBe(atoms.length);
    expect(v.labels.get(ids[1]).entities.map((e) => e.sourceName)).toEqual([
      'Harbour Road',
      'Fish Market',
    ]);
    expect(v.labels.get(ids[4]).entities).toEqual([]);
    // Structural kind is minimal; the model classification is audit only.
    expect(v.labels.get(ids[1])).toMatchObject({
      kind: 'CONTENT',
      modelClassification: 'ITINERARY_STOP',
    });
  });

  it('fails closed on a missing, duplicate, unknown or malformed atom', () => {
    const good = walkLabels(ids);
    expect(codes(validate(good.slice(1)))).toEqual([`MISSING_ATOM:${ids[0]}`]);
    expect(codes(validate([...good, good[3]]))).toEqual([
      `DUPLICATE_ATOM:${ids[3]}`,
    ]);
    expect(codes(validate([...good, label('a-999', 'NON_ITINERARY')]))).toEqual(
      ['UNKNOWN_ATOM:a-999'],
    );
    expect(
      codes(
        validate(
          good.map((l, i) => (i === 0 ? { ...l, classification: 'STOP' } : l)),
        ),
      ),
    ).toEqual([`MALFORMED_LABEL:${ids[0]}`]);
    expect(codes(validate(null))).toEqual(['MALFORMED_RESPONSE']);
    expect(codes(validateAtomLabelling(ids, byId, { labels: good }))).toEqual([
      'MALFORMED_RESPONSE',
    ]);
    expect(() => assembleAtomSegments(atoms, validate(good.slice(1)))).toThrow(
      /ASSEMBLY_REFUSED/,
    );
  });

  it('fails closed on an invalid support span or an unsupported (invented) name', () => {
    const swap = (index: number, entities: unknown[]) =>
      walkLabels(ids).map((l, i) => (i === index ? { ...l, entities } : l));
    expect(
      codes(
        validate(
          swap(1, [
            ent('Fish Market', 'Arrive at the Lighthouse', 'ITINERARY_STOP'),
          ]),
        ),
      ),
    ).toEqual([`SPAN_NOT_IN_ATOM:${ids[1]}`]);
    expect(
      codes(
        validate(
          swap(1, [
            ent(
              'Central Fish Market of the City',
              'to the Fish Market',
              'ITINERARY_STOP',
            ),
          ]),
        ),
      ),
    ).toEqual([`NAME_NOT_IN_SPAN:${ids[1]}`]);
  });

  it('keeps the membership-relevant consistency checks and nothing more', () => {
    const set = (index: number, patch: Record<string, unknown>) =>
      walkLabels(ids).map((l, i) => (i === index ? { ...l, ...patch } : l));
    // A stop claim must name what is visited (the missing-stop signal).
    expect(codes(validate(set(0, { entities: [] })))).toEqual([
      `STOP_WITHOUT_ENTITY:${ids[0]}`,
    ]);
    // A NON_ITINERARY atom may not carry entities.
    expect(
      codes(
        validate(
          set(4, { entities: [ent('Prices', 'Prices are low', 'PASS_BY')] }),
        ),
      ),
    ).toEqual([`ROLE_INCONSISTENT:${ids[4]}`]);
    // Entity roles are the role authority: a route leg inside a stop atom
    // is not an inconsistency (R2).
    expect(validate(walkLabels(ids)).valid).toBe(true);
    // A transfer mode on a non-transfer atom is malformed.
    expect(codes(validate(set(4, { transferMode: 'BUS' })))).toEqual([
      `MALFORMED_LABEL:${ids[4]}`,
    ]);
    // An unnamed option adds no membership: audit note, not a failure.
    const unnamed = validate(set(4, { classification: 'ALTERNATIVE' }));
    expect(unnamed.valid).toBe(true);
    expect(unnamed.notes).toEqual([
      { code: 'UNNAMED_ALTERNATIVE', atomId: ids[4] },
    ]);
  });

  it('projects every TRANSFER entity to TRANSFER_DESTINATION, keeping the model role', () => {
    const v = validate(walkLabels(ids));
    expect(v.labels.get(ids[2])).toMatchObject({
      kind: 'TRANSFER',
      transferMode: 'BUS',
      entities: [
        {
          sourceName: 'Lighthouse',
          role: 'TRANSFER_DESTINATION',
          modelRole: 'ITINERARY_STOP',
        },
      ],
    });
  });

  it('counts structural NON_EDITORIAL atoms exactly once without model output', () => {
    const text = [
      'Start at the Old Square.',
      '* [Home](https://x.example/)',
      '* [Hotels](https://x.example/h)',
      '* [English](https://x.example/en)',
    ].join('\n');
    const u = unitOf(text);
    const editorial = u.atoms.filter((a) => a.editorial);
    const nav = u.atoms.filter((a) => !a.editorial).map((a) => a.atomId);
    expect(nav).toHaveLength(3);
    const model = validateAtomLabelling(
      editorial.map((a) => a.atomId),
      u.byId,
      {
        atoms: [
          label(u.ids[0], 'ITINERARY_STOP', [
            ent('Old Square', 'Start at the Old Square', 'ITINERARY_STOP'),
          ]),
        ],
      },
    );
    const merged = mergeAtomLabellings(u.atoms, [
      model,
      structuralAtomLabels(u.atoms),
    ]);
    expect(merged.valid).toBe(true);
    expect(merged.labels.size).toBe(u.atoms.length);
    for (const id of nav)
      expect(merged.labels.get(id)).toMatchObject({
        source: 'STRUCTURAL',
        kind: 'NON_EDITORIAL',
        entities: [],
      });
    // Without the structural labels they are MISSING; a model label on one
    // is UNKNOWN_ATOM (they are never in a model scope).
    expect(
      mergeAtomLabellings(u.atoms, [model]).issues.map((x) => x.atomId),
    ).toEqual(nav);
    const leaky = validateAtomLabelling(
      editorial.map((a) => a.atomId),
      u.byId,
      {
        atoms: [
          ...[
            label(u.ids[0], 'ITINERARY_STOP', [
              ent('Old Square', 'Start at the Old Square', 'ITINERARY_STOP'),
            ]),
          ],
          label(nav[1], 'ITINERARY_STOP', [
            ent('Hotels', 'Hotels', 'ITINERARY_STOP'),
          ]),
        ],
      },
    );
    expect(codes(leaky)).toEqual([`UNKNOWN_ATOM:${nav[1]}`]);
  });
});

describe('batching', () => {
  it('keeps global atom IDs and accounts for every atom exactly once across batches', () => {
    for (const file of ['sob-day1-unit.md', 'ag-san-telmo-unit.md']) {
      const u = unitOf(readFileSync(join(FIXTURES, file), 'utf8'));
      const editorial = u.atoms.filter((a) => a.editorial);
      const batches = planAtomBatches(editorial);
      expect(batches.length).toBeGreaterThan(1);
      expect(batches.flatMap((b) => b.atomIds)).toEqual(
        editorial.map((a) => a.atomId),
      );
      for (const b of batches)
        expect(b.contextAtomIds.some((id) => b.atomIds.includes(id))).toBe(
          false,
        );
      const nonItinerary = (atomIds: string[]) => ({
        atoms: atomIds.map((id) => label(id, 'NON_ITINERARY')),
      });
      const merged = mergeAtomLabellings(u.atoms, [
        ...batches.map((b) => ({
          ...validateAtomLabelling(b.atomIds, u.byId, nonItinerary(b.atomIds)),
          batchIndex: b.batchIndex,
        })),
        structuralAtomLabels(u.atoms),
      ]);
      expect(merged.valid).toBe(true);
      expect([...merged.labels.keys()].sort()).toEqual(u.ids);
      // A dropped batch leaves global atom IDs unaccounted: fail closed.
      const dropped = mergeAtomLabellings(u.atoms, [
        ...batches
          .slice(1)
          .map((b) =>
            validateAtomLabelling(b.atomIds, u.byId, nonItinerary(b.atomIds)),
          ),
        structuralAtomLabels(u.atoms),
      ]);
      expect(dropped.valid).toBe(false);
      expect(dropped.issues.map((x) => x.atomId)).toEqual(batches[0].atomIds);
    }
  });

  it('a batch that also labels its read-only context atoms is rejected', () => {
    const u = unitOf(WALK);
    const [, second] = planAtomBatches(u.atoms, {
      maxBatchChars: 80,
      contextAtoms: 1,
    });
    expect(second.contextAtomIds).toHaveLength(1);
    const v = validateAtomLabelling(second.atomIds, u.byId, {
      atoms: [...second.contextAtomIds, ...second.atomIds].map((id) =>
        label(id, 'NON_ITINERARY'),
      ),
    });
    expect(codes(v)).toEqual([`UNKNOWN_ATOM:${second.contextAtomIds[0]}`]);
  });
});

describe('bounded relabel', () => {
  const u = unitOf(WALK);
  const good = walkLabels(u.ids);
  const bad = good.map((l, i) => (i === 1 ? { ...l, entities: [] } : l));

  it('relabels only the rejected atoms, then re-validates the whole unit', () => {
    const first = validateAtomLabelling(u.ids, u.byId, { atoms: bad });
    expect(atomRelabelScope(first)).toEqual([u.ids[1]]);
    const batch = atomRelabelBatch(u.atoms, [u.ids[1]], { contextAtoms: 1 });
    expect(batch).toMatchObject({
      batchIndex: 0,
      atomIds: [u.ids[1]],
      contextAtomIds: [u.ids[0]],
    });
    expect(buildAtomRelabellingPrompt(batch, u.byId, first.issues)).toContain(
      `[${u.ids[1]}] STOP_WITHOUT_ENTITY`,
    );
    const second = validateAtomLabelling(batch.atomIds, u.byId, {
      atoms: [good[1]],
    });
    const repaired = applyAtomRelabel(u.atoms, first, [u.ids[1]], second);
    expect(repaired.valid).toBe(true);
    expect(assembleAtomSegments(u.atoms, repaired)).toEqual(
      assembleAtomSegments(
        u.atoms,
        validateAtomLabelling(u.ids, u.byId, { atoms: good }),
      ),
    );
    // A second invalid answer, or one that skips the atom, fails closed.
    expect(
      applyAtomRelabel(
        u.atoms,
        first,
        [u.ids[1]],
        validateAtomLabelling(batch.atomIds, u.byId, { atoms: [bad[1]] }),
      ).valid,
    ).toBe(false);
    expect(
      applyAtomRelabel(
        u.atoms,
        first,
        [u.ids[1]],
        validateAtomLabelling(batch.atomIds, u.byId, { atoms: [] }),
      ).valid,
    ).toBe(false);
  });

  it('does not repair an unknown atom or a malformed response', () => {
    expect(
      atomRelabelScope(
        validateAtomLabelling(u.ids, u.byId, {
          atoms: [...good, label('a-999', 'NON_ITINERARY')],
        }),
      ),
    ).toBeNull();
    expect(
      atomRelabelScope(validateAtomLabelling(u.ids, u.byId, null)),
    ).toBeNull();
  });
});

describe('anaphora (mentionAtomId)', () => {
  const PARK = [
    'On your left you will see Lake Park and Park Lane.',
    'The founders landed here.',
    'Take your time and enjoy the park.',
  ].join('\n');
  function parkCase(
    antecedentEntities: unknown[],
    mention: Record<string, unknown> = {},
  ) {
    const u = unitOf(PARK);
    const response = {
      atoms: [
        label(
          u.ids[0],
          antecedentEntities.length ? 'PASS_BY' : 'NON_ITINERARY',
          antecedentEntities,
        ),
        label(u.ids[1], 'NON_ITINERARY'),
        label(u.ids[2], 'ITINERARY_STOP', [
          ent('park', 'enjoy the park', 'ITINERARY_STOP', {
            mentionAtomId: u.ids[0],
            ...mention,
          }),
        ]),
      ],
    };
    return {
      ...u,
      response,
      run: (opts: { visibleAtomIds?: string[] } = {}) =>
        resolveAtomMentions(
          validateAtomLabelling(u.ids, u.byId, response, opts),
        ),
    };
  }

  it('resolves the single supported entity of the cited atom and keeps both spans', () => {
    const c = parkCase([ent('Lake Park', 'see Lake Park', 'PASS_BY')]);
    // Validation alone leaves the anaphor unresolved; assembly refuses it.
    expect(() =>
      assembleAtomSegments(
        c.atoms,
        validateAtomLabelling(c.ids, c.byId, c.response),
      ),
    ).toThrow(/unresolved anaphor/);
    const v = c.run();
    expect(v.valid).toBe(true);
    const e = v.labels.get(c.ids[2]).entities[0];
    expect(e.sourceName).toBe('Lake Park');
    expect(e.anaphor).toEqual({
      surfaceForm: 'park',
      mentionAtomId: c.ids[0],
      surfaceIn: 'SPAN',
      status: 'RESOLVED',
      antecedent: {
        atomId: c.ids[0],
        sourceName: 'Lake Park',
        supportSpan: 'see Lake Park',
        role: 'PASS_BY',
      },
    });
    expect(PARK.slice(e.sourceStart, e.sourceEnd)).toBe('enjoy the park');
    expect(PARK.slice(e.mention.sourceStart, e.mention.sourceEnd)).toBe(
      'see Lake Park',
    );
    const [segment] = assembleAtomSegments(c.atoms, v);
    expect(segment.mandatory).toEqual(['Lake Park']);
    expect(
      segment.members[0].provenance.map((p) => [p.atomId, p.role]),
    ).toEqual([
      [c.ids[0], 'PASS_BY'],
      [c.ids[2], 'ITINERARY_STOP'],
    ]);
    // Pure and repeatable (it runs again after a relabel round).
    expect(resolveAtomMentions(v)).toEqual(v);
  });

  it('resolves an exact name, then one whole-word containing name; zero anaphora is verified the same way', () => {
    const text = [
      'Reach Plaza de Mayo along Avenida de Mayo.',
      'This Plaza is the heart of the city.',
      'The square is busy.',
    ].join('\n');
    const u = unitOf(text);
    const [p0, p1, p2] = u.ids;
    const cited = label(p0, 'ITINERARY_STOP', [
      ent('Plaza de Mayo', 'Reach Plaza de Mayo', 'ITINERARY_STOP'),
      ent('Avenida de Mayo', 'along Avenida de Mayo', 'ROUTE_LEG'),
    ]);
    const run = (name: string, span: string, atomId = p1) =>
      resolveAtomMentions(
        validateAtomLabelling(u.ids, u.byId, {
          atoms: [
            cited,
            ...[p1, p2].map((id) =>
              id === atomId
                ? label(id, 'ITINERARY_STOP', [
                    ent(name, span, 'ITINERARY_STOP', { mentionAtomId: p0 }),
                  ])
                : label(id, 'NON_ITINERARY'),
            ),
          ],
        }),
      );
    // Exact name.
    expect(
      run('Plaza de Mayo', 'heart of the city').labels.get(p1).entities[0],
    ).toMatchObject({
      sourceName: 'Plaza de Mayo',
      anaphor: { surfaceIn: 'MENTION_ATOM', status: 'RESOLVED' },
    });
    // Whole-word containment against the cited atom's own entities.
    expect(
      run('Plaza', 'This Plaza').labels.get(p1).entities[0].sourceName,
    ).toBe('Plaza de Mayo');
    // Ambiguous (two cited entities contain "Mayo"), and not a partial word.
    expect(codes(run('Mayo', 'heart of the city'))).toEqual([
      `MENTION_ANTECEDENT_AMBIGUOUS:${p1}`,
    ]);
    expect(codes(run('square', 'The square', p2))).toEqual([
      `MENTION_ANTECEDENT_AMBIGUOUS:${p2}`,
    ]);
    expect(codes(run('Plaz', 'This Plaz'))).toEqual([
      `MENTION_ANTECEDENT_AMBIGUOUS:${p1}`,
    ]);
    expect(codes(run('Rome', 'heart of the city'))).toEqual([
      `NAME_NOT_IN_MENTION_ATOM:${p1}`,
    ]);
  });

  it('fails closed on a missing, ambiguous, nonexistent, future, unseen or non-editorial antecedent', () => {
    const c0 = parkCase([]);
    expect(codes(c0.run())).toEqual([
      `MENTION_ANTECEDENT_MISSING:${c0.ids[2]}`,
    ]);
    const amb = parkCase([
      ent('Lake Park', 'see Lake Park', 'PASS_BY'),
      ent('Park Lane', 'Park Lane', 'PASS_BY'),
    ]);
    expect(codes(amb.run())).toEqual([
      `MENTION_ANTECEDENT_AMBIGUOUS:${amb.ids[2]}`,
    ]);
    expect(amb.run().issues[0].detail).toMatch(/Lake Park \| Park Lane/);
    expect(() =>
      assembleAtomSegments(amb.atoms, {
        ...amb.run(),
        valid: true,
        issues: [],
      }),
    ).toThrow(/unresolved anaphor/);
    // The same name twice is one entity, not an ambiguity.
    expect(
      parkCase([
        ent('Lake Park', 'see Lake Park', 'PASS_BY'),
        ent('Lake Park', 'Lake Park', 'PASS_BY'),
      ]).run().valid,
    ).toBe(true);
    const lake = [ent('Lake Park', 'see Lake Park', 'PASS_BY')];
    const bad = (mentionAtomId: string, opts = {}) =>
      codes(parkCase(lake, { mentionAtomId }).run(opts));
    expect(bad('a-999')).toEqual([`BAD_MENTION_ATOM:${c0.ids[2]}`]);
    // Future (and self) reference.
    expect(bad(c0.ids[2])).toEqual([`BAD_MENTION_ATOM:${c0.ids[2]}`]);
    // Not shown to the model in this request.
    expect(bad(c0.ids[0], { visibleAtomIds: [c0.ids[1], c0.ids[2]] })).toEqual([
      `BAD_MENTION_ATOM:${c0.ids[2]}`,
    ]);
    // A NON_EDITORIAL antecedent.
    const nav = new Map<string, StructuredSourceAtom>(
      [...c0.byId].map(([id, a]) => [
        id,
        id === c0.ids[0] ? { ...a, editorial: false } : a,
      ]),
    );
    expect(
      codes(
        validateAtomLabelling([c0.ids[2]], nav, {
          atoms: [parkCase(lake).response.atoms[2]],
        }),
      ),
    ).toEqual([`BAD_MENTION_ATOM:${c0.ids[2]}`]);
    // An invented name neither in the cited atom nor in the span.
    expect(codes(parkCase(lake, { sourceName: 'Hill Park' }).run())).toEqual([
      `NAME_NOT_IN_MENTION_ATOM:${c0.ids[2]}`,
    ]);
  });

  it('resolves a chain hop by hop; an unresolved hop fails every later hop', () => {
    const chain = (antecedent: unknown[]) => {
      const c = parkCase(antecedent);
      c.response.atoms[1] = label(c.ids[1], 'PASS_BY', [
        ent('here', 'landed here', 'PASS_BY', { mentionAtomId: c.ids[0] }),
      ]);
      (
        c.response.atoms[2].entities[0] as { mentionAtomId: string }
      ).mentionAtomId = c.ids[1];
      return c;
    };
    const ok = chain([ent('Lake Park', 'see Lake Park', 'PASS_BY')]).run();
    expect(ok.valid).toBe(true);
    expect(ok.labels.get('a-003').entities[0].sourceName).toBe('Lake Park');
    expect(codes(chain([]).run())).toEqual([
      'MENTION_ANTECEDENT_MISSING:a-002',
      'MENTION_ANTECEDENT_MISSING:a-003',
    ]);
  });

  it('resolves across a batch boundary after merge', () => {
    const c = parkCase([ent('Lake Park', 'see Lake Park', 'PASS_BY')]);
    const batches = planAtomBatches(c.atoms, {
      maxBatchChars: 60,
      contextAtoms: 2,
    });
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches[batches.length - 1].atomIds).not.toContain(c.ids[0]);
    const v = resolveAtomMentions(
      mergeAtomLabellings(
        c.atoms,
        batches.map((b) =>
          validateAtomLabelling(
            b.atomIds,
            c.byId,
            {
              atoms: c.response.atoms.filter((l) =>
                b.atomIds.includes(l.atomId),
              ),
            },
            { visibleAtomIds: [...b.contextAtomIds, ...b.atomIds] },
          ),
        ),
      ),
    );
    expect(v.valid).toBe(true);
    expect(v.labels.get(c.ids[2]).entities[0].sourceName).toBe('Lake Park');
  });
});
