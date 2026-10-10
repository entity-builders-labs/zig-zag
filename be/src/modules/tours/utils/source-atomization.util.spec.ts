import { readFileSync } from 'fs';
import { join } from 'path';
import {
  atomizeSourceUnit,
  checkAtomCoverage,
  foldAtomText,
  isLinkOnlyAtomText,
  locateSpanInAtom,
  markEditorialStructure,
  presentAtomText,
  visibleHeadingText,
} from './source-atomization.util';

const FIXTURES = join(__dirname, '../fixtures/atomized-source-units');
const unit = (file: string) => readFileSync(join(FIXTURES, file), 'utf8');
/** The two real complete units (production windowing, SECTION_UNIT,
 * sectionComplete=true) frozen for RW4-EXTRACT-COMPLETENESS-1. */
const SOB = unit('sob-day1-unit.md');
const AG = unit('ag-san-telmo-unit.md');
/** Reference output of the accepted spike for the same units. */
const golden = JSON.parse(unit('spike-golden.json'));

const WALK = [
  '## A harbour day',
  '',
  'Start at the Old Square. In front you will see the Town Hall.',
  'Walk along Harbour Road and cross Mill Street.',
  '- Stop 2: the Fish Market. Have lunch at Café One or Café Two.',
  '| Take the number 7 bus to the Lighthouse. | ![](https://img.example/x.png) |',
  '| --- | --- |',
  'Arrive at the Lighthouse. If you have time, visit the Shell Museum.',
  'Prices are low.',
].join('\n');

const NAV_PAGE = [
  '## A harbour walk',
  'Start at the Old Square.',
  '[Read more about the Old Square](https://x.example/old-square)',
  '**[Visit the Fish Market](https://x.example/fish)**, the busiest stall row in town.',
  'Walk on to the Lighthouse.',
  '* [Home](https://x.example/)',
  '  + [Best hotels in Old Town](https://x.example/hotels "Hotels")',
  '* [![](https://x.example/flag.svg)English](https://x.example/en)',
  'Arrive at the Shell Museum.',
].join('\n');

const idOf = (atoms: Array<{ atomId: string; text: string }>, needle: string) =>
  atoms.find((a) => a.text.includes(needle)).atomId;

describe('source atomization', () => {
  it('reproduces the accepted spike atomization byte for byte on the real complete units', () => {
    for (const [file, text] of [
      ['sob-day1-unit.md', SOB],
      ['ag-san-telmo-unit.md', AG],
    ] as const) {
      const z = atomizeSourceUnit(text);
      const ref = golden.units[file];
      expect(z.unitSha256).toBe(ref.unitSha256);
      expect(
        z.atoms.map((a) => [
          a.atomId,
          a.ordinal,
          a.sourceStart,
          a.sourceEnd,
          a.blockKind,
          a.blockOrdinal,
          a.fragment
            ? [
                a.fragment.index,
                a.fragment.count,
                a.fragment.groupStart,
                a.fragment.groupEnd,
              ]
            : null,
        ]),
      ).toEqual(ref.atoms);
      expect(z.separators.map((s) => [s.start, s.end, s.kind])).toEqual(
        ref.separators,
      );
    }
    expect(atomizeSourceUnit(SOB).atoms).toHaveLength(182);
    expect(atomizeSourceUnit(AG).atoms).toHaveLength(95);
  });

  it('is deterministic: same input, same atoms, IDs, order and offsets', () => {
    for (const text of [WALK, SOB, AG]) {
      expect(atomizeSourceUnit(text)).toEqual(atomizeSourceUnit(text));
      const ids = atomizeSourceUnit(text).atoms.map((a) => a.atomId);
      expect(ids).toEqual(
        ids.map(
          (_, i) =>
            `a-${String(i + 1).padStart(Math.max(3, String(ids.length).length), '0')}`,
        ),
      );
    }
  });

  it('accounts for the whole unit: atoms and separators partition it, every letter is in an atom', () => {
    for (const text of [WALK, NAV_PAGE, SOB, AG]) {
      const z = atomizeSourceUnit(text);
      expect(checkAtomCoverage(text, z)).toEqual({ ok: true, problems: [] });
      for (const a of z.atoms)
        expect(text.slice(a.sourceStart, a.sourceEnd)).toBe(a.text);
      for (const s of z.separators)
        expect(
          /[\p{L}\p{N}]/u.test(
            presentAtomText(text.slice(s.start, s.end)).text,
          ),
        ).toBe(false);
      expect(
        z.atoms.every(
          (a, i) => i === 0 || a.sourceStart >= z.atoms[i - 1].sourceEnd,
        ),
      ).toBe(true);
    }
    // A coverage hole is detected, never silent.
    const z = atomizeSourceUnit(WALK);
    expect(checkAtomCoverage(WALK, { ...z, atoms: z.atoms.slice(1) }).ok).toBe(
      false,
    );
  });

  it('splits an over-long piece into offset-preserving fragments, never truncating', () => {
    const long = 'word '.repeat(400).trim() + '.';
    const z = atomizeSourceUnit(long, { maxAtomChars: 200 });
    expect(z.atoms.length).toBeGreaterThan(1);
    for (const a of z.atoms) {
      expect(a.text.length).toBeLessThanOrEqual(200);
      expect(a.fragment).toMatchObject({
        count: z.atoms.length,
        groupStart: 0,
        groupEnd: long.length,
      });
    }
    expect(z.atoms.map((a) => a.fragment.index)).toEqual(
      z.atoms.map((_, i) => i + 1),
    );
    expect(z.atoms.map((a) => a.text).join(' ')).toBe(long);
    expect(checkAtomCoverage(long, z).ok).toBe(true);
  });

  it('splits only on structure: lines, table cells, sentences; abbreviations by token length', () => {
    const { atoms } = atomizeSourceUnit(WALK);
    expect(atoms.some((a) => a.text === 'Start at the Old Square.')).toBe(true);
    expect(
      atoms.some(
        (a) =>
          a.blockKind === 'TABLE_CELL' &&
          a.text === 'Take the number 7 bus to the Lighthouse.',
      ),
    ).toBe(true);
    // An image-only cell is a markup separator, not an atom.
    expect(atoms.some((a) => a.text.includes('https://'))).toBe(false);
    expect(
      atomizeSourceUnit('Walk to Av. Central and rest. Then go on.').atoms.map(
        (a) => a.text,
      ),
    ).toEqual(['Walk to Av. Central and rest.', 'Then go on.']);
    expect(atoms[0]).toMatchObject({ blockKind: 'HEADING' });
    expect(visibleHeadingText(atoms[0].text)).toBe('A harbour day');
  });

  it('locates a span inside its atom ignoring only case, accents, emphasis and quotes, never a URL target', () => {
    const z = atomizeSourceUnit('Visit **"Café Été"** today.');
    const loc = locateSpanInAtom(z.atoms[0], 'visit "cafe ete"');
    expect(z.atoms[0].text.slice(loc.sourceStart, loc.sourceEnd)).toBe(
      'Visit **"Café Été',
    );
    const link = atomizeSourceUnit(
      'See [the pier](https://example.org/pier-guide).',
    ).atoms[0];
    expect(locateSpanInAtom(link, 'pier-guide')).toBeNull();
    expect(locateSpanInAtom(link, 'the pier')).not.toBeNull();
    expect(foldAtomText('  Ça  “Va” ')).toBe('ca va');
  });
});

describe('editorial structure (structural NON_EDITORIAL)', () => {
  it('marks a run of 3+ link-only atoms as a navigation block; a lone link and prose with a link stay editorial', () => {
    const z = atomizeSourceUnit(NAV_PAGE);
    const s = markEditorialStructure(z.atoms);
    const editorial = (needle: string) =>
      s.atoms.find((a) => a.text.includes(needle)).editorial;
    expect(
      s.blocks.map((b) => [b.firstAtomId, b.lastAtomId, b.atomCount, b.reason]),
    ).toEqual([
      [
        idOf(z.atoms, '[Home]'),
        idOf(z.atoms, 'English'),
        3,
        'NAVIGATION_BLOCK',
      ],
    ]);
    expect(editorial('Best hotels in Old Town')).toBe(false);
    for (const n of [
      'Start at the Old Square',
      'Read more about the Old Square',
      'Visit the Fish Market',
      'Walk on to the Lighthouse',
      'Shell Museum',
    ])
      expect(editorial(n)).toBe(true);
    expect(
      isLinkOnlyAtomText(
        '**[Visit La Bombonera](https://x.example)**, the stadium.',
      ),
    ).toBe(false);
    expect(
      isLinkOnlyAtomText('+ [Best hotels in Old Town](https://x.example/h)'),
    ).toBe(true);
    expect(isLinkOnlyAtomText('Best hotels in Old Town')).toBe(false);
    // Two link-only atoms are below the structural run: nothing is excluded.
    expect(markEditorialStructure(z.atoms, { minRun: 4 }).blocks).toEqual([]);
  });

  it('keeps non-editorial atoms in the accounting with their IDs, offsets and text', () => {
    const z = atomizeSourceUnit(NAV_PAGE);
    const s = markEditorialStructure(z.atoms);
    expect(s.atoms).toHaveLength(z.atoms.length);
    expect(
      s.atoms.map((a) => {
        const copy: Partial<typeof a> = { ...a };
        delete copy.editorial;
        delete copy.nonEditorial;
        return copy;
      }),
    ).toEqual(z.atoms);
    for (const a of s.atoms)
      expect(NAV_PAGE.slice(a.sourceStart, a.sourceEnd)).toBe(a.text);
  });

  it('uses no word list: the same words outside link structure stay editorial', () => {
    const words = [
      'Best hotels in Old Town',
      'Subscribe to the newsletter',
      'Related posts and booking',
    ];
    const s = markEditorialStructure(atomizeSourceUnit(words.join('\n')).atoms);
    expect(s.blocks).toEqual([]);
    expect(s.atoms.every((a) => a.editorial)).toBe(true);
  });

  it('San Telmo chrome regression: the SOB page tail is structural, a-172 is in nav-3, no walk prose is', () => {
    const s = markEditorialStructure(atomizeSourceUnit(SOB).atoms);
    const ref = golden.units['sob-day1-unit.md'];
    expect(s.blocks).toEqual(ref.nonEditorialBlocks);
    expect(s.blocks.map((b) => `${b.firstAtomId}..${b.lastAtomId}`)).toEqual([
      'a-118..a-121',
      'a-123..a-130',
      'a-132..a-182',
    ]);
    const a172 = s.atoms.find((a) => a.atomId === 'a-172');
    expect(a172.text).toContain('Best hotels in San Telmo');
    expect(a172).toMatchObject({
      editorial: false,
      nonEditorial: { reason: 'NAVIGATION_BLOCK', blockId: 'nav-3' },
    });
    expect(s.atoms.filter((a) => !a.editorial).map((a) => a.atomId)).toEqual(
      ref.nonEditorialAtomIds,
    );
    // The last walk prose and the author note survive.
    for (const id of ['a-104', 'a-105', 'a-109', 'a-117'])
      expect(s.atoms.find((a) => a.atomId === id).editorial).toBe(true);
    // Every atom carrying a mandatory stop wording stays editorial.
    for (const wording of [
      'START AT PLAZA DE MAYO',
      'Mercado de San Telmo',
      'Plaza Dorrego',
      'Parque Lezama',
      'national history museum',
      'El Caminito',
      'La Bombonera',
    ]) {
      const carriers = s.atoms.filter((a) =>
        foldAtomText(presentAtomText(a.text).text).includes(
          foldAtomText(wording),
        ),
      );
      expect(carriers.some((a) => a.editorial)).toBe(true);
    }
    const ag = markEditorialStructure(atomizeSourceUnit(AG).atoms);
    expect(ag.blocks).toEqual(
      golden.units['ag-san-telmo-unit.md'].nonEditorialBlocks,
    );
  });
});
