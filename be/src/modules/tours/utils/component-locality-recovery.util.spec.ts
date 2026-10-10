import * as fs from 'fs';
import * as path from 'path';
import { DiscoveryStructuredCompletionRequest } from '../interfaces/experience-discovery.interface';
import { recoverComponentLocalities } from './component-locality-recovery.util';
import {
  DiscoveryEvidenceRecord,
  extractExperienceCandidates,
} from './experience-candidate-extraction.util';

/**
 * Source locality recovery (§19.1).
 *
 * The model is replaced by a scripted reader of the REAL prompt: it sees
 * exactly the components and numbered statements the backend selected, and
 * answers with reports. Adversarial readers deliberately misclassify, to
 * show what the deterministic admission still refuses. Real-provider
 * behaviour is characterized by the live replay, not here.
 */

const WINDOW = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../fixtures/rw4-solsalute-deep-source-window.json'),
    'utf8',
  ),
) as { content: string };
const CAPTION = 'Wine and lunch at Ojo de Agua in Lujan de Cuyo';

interface PromptComponent {
  id: string;
  name: string;
  statements: Array<{ id: string; text: string }>;
}

/** The components and statements the prompt actually carries. */
function promptComponents(user: string): PromptComponent[] {
  const components: PromptComponent[] = [];
  for (const line of user.split('\n')) {
    const header = line.match(/^(c\d+): (".*")$/);
    if (header) {
      components.push({
        id: header[1],
        name: JSON.parse(header[2]),
        statements: [],
      });
      continue;
    }
    const statement = line.match(/^ {2}(s\d+): (".*")$/);
    if (statement && components.length > 0) {
      components[components.length - 1].statements.push({
        id: statement[1],
        text: JSON.parse(statement[2]),
      });
    }
  }
  return components;
}

type Report = { place: string; relation: string };
type Reader = (component: PromptComponent, statement: string) => Report[];

/** A scripted model plus a record of every request it received. */
function model(read: Reader) {
  const requests: DiscoveryStructuredCompletionRequest[] = [];
  const complete = async (request: DiscoveryStructuredCompletionRequest) => {
    requests.push(request);
    const reports = promptComponents(request.user).flatMap((component) =>
      component.statements.flatMap((statement) =>
        read(component, statement.text).map((report) => ({
          component: component.id,
          statement: statement.id,
          ...report,
        })),
      ),
    );
    return JSON.stringify({ reports });
  };
  return { complete, requests };
}

/** Reports LOCATED_IN for the given place wherever a statement contains it. */
const locatedWhereWritten =
  (place: string): Reader =>
  (_component, statement) =>
    statement.includes(place) ? [{ place, relation: 'LOCATED_IN' }] : [];

function extraction(
  candidates: Array<{
    name: string;
    hints: Array<{
      name: string;
      supportSpan: string;
      key?: string;
      expectedKind?: string;
      evidenceKeys?: string[];
    }>;
  }>,
  evidence: DiscoveryEvidenceRecord[],
) {
  return extractExperienceCandidates(
    {
      candidates: candidates.map((candidate) => ({
        name: candidate.name,
        themes: [] as string[],
        traits: [] as string[],
        intents: ['route_like'],
        componentHints: candidate.hints.map((hint, index) => ({
          key: hint.key ?? `component-${index + 1}`,
          name: hint.name,
          role: hint.expectedKind === 'AREA' ? 'area' : 'venue',
          expectedKind: hint.expectedKind ?? 'PLACE',
          evidenceKeys: hint.evidenceKeys ?? ['ev-1'],
          supportSpan: hint.supportSpan,
        })),
        evidenceKeys: ['ev-1'],
        shortReason: 'source itinerary',
        orderedByEvidence: true,
      })),
    },
    evidence,
    5,
  );
}

const hintNamed = (result: { candidates: any[] }, name: string) =>
  result.candidates
    .flatMap((candidate) => candidate.componentHints)
    .find((hint) => hint.name === name);

const localityAuditOf = (
  result: { sourceSupportAudits: any[] },
  name: string,
) =>
  result.sourceSupportAudits
    .flatMap((audit) => audit.components)
    .find((component) => component.name === name)
    ?.assertionAudits?.find((audit: any) => audit.assertion === 'LOCALITY');

describe('recoverComponentLocalities -- real SolSalute window (COLD #11)', () => {
  const evidence: DiscoveryEvidenceRecord[] = [
    {
      key: 'ev-1',
      title: 'The Best Wineries in Mendoza, A Wine Tasting Guide',
      text: WINDOW.content,
    },
  ];
  // The two candidates of the real Gemini replay (run-gemini-1), verbatim:
  // the extractor emitted no localityAssertion for any component.
  const real = () =>
    extraction(
      [
        {
          name: 'Uco Valley Wine Tasting Itinerary',
          hints: [
            {
              key: 'uco-valley',
              name: 'Valle de Uco',
              expectedKind: 'AREA',
              supportSpan:
                'If I were to plan a wine tasting in Valle de Uco Itinerary for a friend, this is the day I’d schedule for them.',
            },
            {
              key: 'alfa-crux',
              name: 'Alfa Crux',
              supportSpan:
                'Alfa Crux – 10 am – This winery is the furthest, so start here and work your way back up.',
            },
            {
              key: 'superuco',
              name: 'SuperUco',
              supportSpan:
                'SuperUco – 12 pm – It will take you 40 minutes to drive here from Alfa Crux so you’ll need to schedule SuperUco for no earlier than noon.',
            },
            {
              key: 'bodega-azul',
              name: 'Bodega Azul',
              supportSpan:
                'Bodega Azul – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here, so sit back and enjoy the meal.',
            },
          ],
        },
        {
          name: 'Lujan de Cuyo Wine Tasting Itinerary',
          hints: [
            {
              key: 'lujan-de-cuyo',
              name: 'Lujan de Cuyo',
              expectedKind: 'AREA',
              supportSpan:
                'Here are two sample itineraries for my two favorite Mendoza wine regions: Lujan de Cuyo & The Uco Valley.',
            },
            {
              key: 'a16',
              name: 'A16',
              supportSpan:
                'A16 – 10 am – Start your day with a tasting and a tour at A16.',
            },
            {
              key: 'ojo-de-agua',
              name: 'Ojo de Agua',
              supportSpan:
                'Ojo de Agua – 1:30 pm for a winery lunch – It took us about 15-20 minutes to drive to Ojo de Agua from Melipal',
            },
          ],
        },
      ],
      evidence,
    );

  it('starts from an extraction that carries no locality for Ojo de Agua', () => {
    expect(hintNamed(real(), 'Ojo de Agua').localityAssertion).toBeUndefined();
  });

  it('POSITIVE: recovers the caption as Ojo de Agua’s locality, with the exact evidence key and literal span', async () => {
    const { complete } = model(locatedWhereWritten('Lujan de Cuyo'));

    const result = await recoverComponentLocalities(real(), evidence, complete);

    expect(hintNamed(result, 'Ojo de Agua').localityAssertion).toEqual({
      locality: 'Lujan de Cuyo',
      evidenceKey: 'ev-1',
      supportSpan: CAPTION,
    });
    expect(localityAuditOf(result, 'Ojo de Agua')).toEqual({
      assertion: 'LOCALITY',
      status: 'ACCEPTED',
      proposedLocality: 'Lujan de Cuyo',
    });
    expect(result.localityRecovery.status).toBe('COMPLETED');
  });

  it('sends one bounded request: only PLACE components, only statements that name them, no heading, title or destination', async () => {
    const { complete, requests } = model(() => []);

    await recoverComponentLocalities(real(), evidence, complete);

    expect(requests).toHaveLength(1);
    const components = promptComponents(requests[0].user);
    expect(components.map((component) => component.name)).toEqual([
      'Alfa Crux',
      'SuperUco',
      'Bodega Azul',
      'A16',
      'Ojo de Agua',
    ]);
    const ojo = components.find(
      (component) => component.name === 'Ojo de Agua',
    )!;
    expect(ojo.statements.map((statement) => statement.text)).toEqual([
      CAPTION,
      'Ojo de Agua – 1:30 pm for a winery lunch – It took us about 15-20 minutes to drive to Ojo de Agua from Melipal (which has since been bought out by another corporation).',
      'Wineries close at 5 or 6 so if you play your cards right you can squeeze in one last tasting (no tour) after Ojo de Agua.',
    ]);
    expect(requests[0].user).not.toContain('Lujan de Cuyo Itinerary');
    expect(requests[0].user).not.toContain('The Best Wineries in Mendoza');
    expect(`${requests[0].system}\n${requests[0].user}`).not.toMatch(
      /Destination|Ruta del Vino/,
    );
  });

  it('NEGATIVE (cross-variant): the caption sits in the Uco section, yet no Uco component inherits its locality, even from a reader that claims it for everyone', async () => {
    const { complete } = model(() => [
      { place: 'Lujan de Cuyo', relation: 'LOCATED_IN' },
    ]);

    const result = await recoverComponentLocalities(real(), evidence, complete);

    for (const name of ['Alfa Crux', 'SuperUco', 'Bodega Azul', 'A16']) {
      expect(hintNamed(result, name).localityAssertion).toBeUndefined();
    }
    expect(
      result.localityRecovery.reports.filter(
        (report) => report.discarded === 'PLACE_NOT_IN_STATEMENT',
      ).length,
    ).toBeGreaterThan(0);
    expect(hintNamed(result, 'Ojo de Agua').localityAssertion.locality).toBe(
      'Lujan de Cuyo',
    );
  });

  it('NEGATIVE: a place the statement does not write (the destination) is discarded, and the component stays valid', async () => {
    const { complete } = model((component) =>
      component.name === 'Ojo de Agua'
        ? [{ place: 'Mendoza', relation: 'LOCATED_IN' }]
        : [],
    );

    const result = await recoverComponentLocalities(real(), evidence, complete);

    expect(hintNamed(result, 'Ojo de Agua')).toBeDefined();
    expect(hintNamed(result, 'Ojo de Agua').localityAssertion).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });

  it('NEGATIVE: an estate named in a statement is still literal text, so the backend cannot tell; the reader is told not to report it, and an ungroundable locality is only missing evidence downstream', async () => {
    // Real Gemini spike answer before the prompt was tightened.
    const { complete } = model((component, statement) =>
      component.name === 'SuperUco' && statement.includes('The Vines')
        ? [{ place: 'The Vines', relation: 'LOCATED_IN' }]
        : [],
    );

    const result = await recoverComponentLocalities(real(), evidence, complete);

    expect(hintNamed(result, 'SuperUco').localityAssertion).toMatchObject({
      locality: 'The Vines',
    });
  });

  it('a failed provider call leaves the extraction unchanged and records the failure', async () => {
    const original = real();
    const result = await recoverComponentLocalities(original, evidence, () =>
      Promise.reject(new Error('HTTP 429: daily allocation exhausted')),
    );

    expect(result.candidates).toEqual(original.candidates);
    expect(result.localityRecovery).toMatchObject({
      status: 'FAILED',
      failureReason: 'HTTP 429: daily allocation exhausted',
    });
  });

  it('an unparseable answer admits nothing', async () => {
    const result = await recoverComponentLocalities(real(), evidence, () =>
      Promise.resolve('not json'),
    );

    expect(hintNamed(result, 'Ojo de Agua').localityAssertion).toBeUndefined();
    expect(result.localityRecovery).toMatchObject({
      status: 'FAILED',
      failureReason: 'UNPARSEABLE_RESPONSE',
    });
  });

  it('an answer that cites names instead of ids admits nothing', async () => {
    const result = await recoverComponentLocalities(real(), evidence, () =>
      Promise.resolve(
        JSON.stringify({
          reports: [
            {
              component: 'Ojo de Agua',
              statement: CAPTION,
              place: 'Lujan de Cuyo',
              relation: 'LOCATED_IN',
            },
          ],
        }),
      ),
    );

    expect(hintNamed(result, 'Ojo de Agua').localityAssertion).toBeUndefined();
    expect(result.localityRecovery.reports[0].discarded).toBe(
      'UNKNOWN_COMPONENT',
    );
  });
});

describe('recoverComponentLocalities -- generic attribution (synthetic sources)', () => {
  const ev = (key: string, text: string): DiscoveryEvidenceRecord => ({
    key,
    text,
  });

  it('POSITIVE (outside Argentina): "Lunch at Sushi Dai in Tsukiji." follows the same path', async () => {
    const evidence = [
      ev(
        'ev-1',
        '1. Sushi Dai – 7 am breakfast. Lunch at Sushi Dai in Tsukiji. 2. Mori Art Museum – 11 am.',
      ),
    ];
    const { complete } = model(locatedWhereWritten('Tsukiji'));

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Tokyo day',
            hints: [
              { name: 'Sushi Dai', supportSpan: 'Sushi Dai – 7 am breakfast.' },
              {
                name: 'Mori Art Museum',
                supportSpan: 'Mori Art Museum – 11 am.',
              },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(hintNamed(result, 'Sushi Dai').localityAssertion).toEqual({
      locality: 'Tsukiji',
      evidenceKey: 'ev-1',
      supportSpan: 'Lunch at Sushi Dai in Tsukiji.',
    });
    expect(
      hintNamed(result, 'Mori Art Museum').localityAssertion,
    ).toBeUndefined();
  });

  it.each([
    [
      'Spanish, accented locality written without the accent by the reader',
      'Café Tortoni está ubicado en San Nicolás. Café Tortoni – 9 am.',
      'Café Tortoni',
      'Café Tortoni – 9 am.',
      'San Nicolas',
      'Café Tortoni está ubicado en San Nicolás.',
    ],
    [
      'French',
      'Visite du Musée Carnavalet dans le Marais. Musée Carnavalet – 10 h.',
      'Musée Carnavalet',
      'Musée Carnavalet – 10 h.',
      'le Marais',
      'Visite du Musée Carnavalet dans le Marais.',
    ],
    [
      'Japanese name and locality',
      '青山カフェは東京都渋谷区にあります。青山カフェで朝食。',
      '青山カフェ',
      '青山カフェで朝食。',
      '渋谷区',
      '青山カフェは東京都渋谷区にあります。',
    ],
    [
      'English name, Japanese locality',
      'Blue Bottle Coffeeは渋谷区にあります。Blue Bottle Coffee – 8 am.',
      'Blue Bottle Coffee',
      'Blue Bottle Coffee – 8 am.',
      '渋谷区',
      'Blue Bottle Coffeeは渋谷区にあります。',
    ],
    [
      'Japanese name, English locality',
      'Lunch at 青山カフェ in Shibuya. 青山カフェ – noon.',
      '青山カフェ',
      '青山カフェ – noon.',
      'Shibuya',
      'Lunch at 青山カフェ in Shibuya.',
    ],
  ])('POSITIVE (%s)', async (_label, text, name, entry, place, statement) => {
    const { complete } = model((_component, written) =>
      written === statement ? [{ place, relation: 'LOCATED_IN' }] : [],
    );

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Day',
            hints: [
              { name, supportSpan: entry },
              { name: 'Other Stop', supportSpan: 'Other Stop' },
            ],
          },
        ],
        [ev('ev-1', `${text} Other Stop.`)],
      ),
      [ev('ev-1', `${text} Other Stop.`)],
      complete,
    );

    expect(hintNamed(result, name).localityAssertion).toEqual({
      locality: place,
      evidenceKey: 'ev-1',
      supportSpan: statement,
    });
  });

  it('NEGATIVE (transliteration): a reader that romanizes "渋谷区" as "Shibuya" is refused', async () => {
    const text =
      '青山カフェは東京都渋谷区にあります。青山カフェで朝食。 Other Stop.';
    const evidence = [ev('ev-1', text)];
    const { complete } = model(() => [
      { place: 'Shibuya', relation: 'LOCATED_IN' },
    ]);

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Day',
            hints: [
              { name: '青山カフェ', supportSpan: '青山カフェで朝食。' },
              { name: 'Other Stop', supportSpan: 'Other Stop' },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(hintNamed(result, '青山カフェ').localityAssertion).toBeUndefined();
  });

  it('NEGATIVE (cross-script name): a romanized component name never selects a Japanese statement', async () => {
    const text =
      '青山カフェは東京都渋谷区にあります。 Aoyama Cafe – 8 am. Other Stop.';
    const evidence = [ev('ev-1', text)];
    const { complete, requests } = model(() => [
      { place: '渋谷区', relation: 'LOCATED_IN' },
    ]);

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Day',
            hints: [
              { name: 'Aoyama Cafe', supportSpan: 'Aoyama Cafe – 8 am.' },
              { name: 'Other Stop', supportSpan: 'Other Stop' },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(requests[0].user).not.toContain('青山カフェ');
    expect(hintNamed(result, 'Aoyama Cafe').localityAssertion).toBeUndefined();
  });

  it('NEGATIVE (A to B): one statement locating two components attributes to neither', async () => {
    const text =
      'Restaurant Kiku in Gion, Restaurant Ume in Pontocho. Restaurant Kiku – noon. Restaurant Ume – 7 pm.';
    const evidence = [ev('ev-1', text)];
    const { complete } = model((component) =>
      component.name === 'Restaurant Kiku'
        ? [{ place: 'Gion', relation: 'LOCATED_IN' }]
        : [{ place: 'Pontocho', relation: 'LOCATED_IN' }],
    );

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Kyoto dinner',
            hints: [
              {
                name: 'Restaurant Kiku',
                supportSpan: 'Restaurant Kiku – noon.',
              },
              { name: 'Restaurant Ume', supportSpan: 'Restaurant Ume – 7 pm.' },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(
      hintNamed(result, 'Restaurant Kiku').localityAssertion,
    ).toBeUndefined();
    expect(
      hintNamed(result, 'Restaurant Ume').localityAssertion,
    ).toBeUndefined();
    expect(localityAuditOf(result, 'Restaurant Kiku').reason).toBe(
      'STATEMENT_NAMES_ANOTHER_COMPONENT',
    );
  });

  it('NEGATIVE (another source record): a statement in evidence the component does not cite is never examined', async () => {
    const evidence = [
      ev('ev-1', 'Café Lumen – 9 am. Museo Azul – 11 am.'),
      ev('ev-2', 'Café Lumen is in Kyoto.'),
    ];
    const { complete, requests } = model(locatedWhereWritten('Kyoto'));

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Day',
            hints: [
              { name: 'Café Lumen', supportSpan: 'Café Lumen – 9 am.' },
              { name: 'Museo Azul', supportSpan: 'Museo Azul – 11 am.' },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(requests[0].user).not.toContain('Kyoto');
    expect(hintNamed(result, 'Café Lumen').localityAssertion).toBeUndefined();
  });

  it('NEGATIVE (same-name branches in two compositions): neither inherits the page’s locality, and no request is made for them', async () => {
    const text =
      'Morning route: Café Lumen – 9 am. Museo Azul – 11 am. Evening route: Café Lumen – 6 pm. Teatro Sol – 8 pm. Café Lumen in Yokohama is our favourite.';
    const evidence = [ev('ev-1', text)];
    const { complete, requests } = model(locatedWhereWritten('Yokohama'));

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Morning route',
            hints: [
              { name: 'Café Lumen', supportSpan: 'Café Lumen – 9 am.' },
              { name: 'Museo Azul', supportSpan: 'Museo Azul – 11 am.' },
            ],
          },
          {
            name: 'Evening route',
            hints: [
              { name: 'Café Lumen', supportSpan: 'Café Lumen – 6 pm.' },
              { name: 'Teatro Sol', supportSpan: 'Teatro Sol – 8 pm.' },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(
      result.candidates.flatMap((candidate) =>
        candidate.componentHints.filter((hint) => hint.localityAssertion),
      ),
    ).toEqual([]);
    expect(promptComponents(requests[0].user).map((c) => c.name)).toEqual([
      'Museo Azul',
      'Teatro Sol',
    ]);
    expect(localityAuditOf(result, 'Café Lumen').reason).toBe(
      'SAME_NAME_IN_SEVERAL_COMPOSITIONS',
    );
  });

  describe('NEGATIVE: relations that are not one unqualified containment', () => {
    const recover = async (text: string, read: Reader) => {
      const evidence = [
        ev('ev-1', `${text} Café Lumen – 9 am. Museo Azul – 11 am.`),
      ];
      return recoverComponentLocalities(
        extraction(
          [
            {
              name: 'Day',
              hints: [
                { name: 'Café Lumen', supportSpan: 'Café Lumen – 9 am.' },
                { name: 'Museo Azul', supportSpan: 'Museo Azul – 11 am.' },
              ],
            },
          ],
          evidence,
        ),
        evidence,
        model(read).complete,
      );
    };
    const reportFor =
      (reports: Report[]): Reader =>
      (component, statement) =>
        component.name === 'Café Lumen' && !statement.includes('9 am')
          ? reports
          : [];

    it.each([
      [
        'negation',
        'Café Lumen is not in Tokyo.',
        [{ place: 'Tokyo', relation: 'NOT_IN' }],
        undefined,
      ],
      [
        'proximity',
        'Café Lumen is near Tokyo.',
        [{ place: 'Tokyo', relation: 'NEAR' }],
        undefined,
      ],
      [
        'alternatives',
        'Café Lumen in Tokyo or Kyoto.',
        [
          { place: 'Tokyo', relation: 'ALTERNATIVE' },
          { place: 'Kyoto', relation: 'ALTERNATIVE' },
        ],
        'LOCATION_QUALIFIED',
      ],
      [
        'alternatives read as two containments',
        'Café Lumen in Tokyo or Kyoto.',
        [
          { place: 'Tokyo', relation: 'LOCATED_IN' },
          { place: 'Kyoto', relation: 'LOCATED_IN' },
        ],
        'SEVERAL_PLACES_IN_STATEMENT',
      ],
      [
        'a branch elsewhere',
        'Café Lumen is popular in Tokyo, but its branch is in Yokohama.',
        [
          { place: 'Tokyo', relation: 'OTHER' },
          { place: 'Yokohama', relation: 'SAME_NAME_OTHER_PLACE' },
        ],
        'LOCATION_QUALIFIED',
      ],
      [
        'a branch read as containment',
        'Café Lumen is popular in Tokyo, but its branch is in Yokohama.',
        [
          { place: 'Tokyo', relation: 'OTHER' },
          { place: 'Yokohama', relation: 'LOCATED_IN' },
        ],
        'SEVERAL_PLACES_IN_STATEMENT',
      ],
    ])('%s', async (_label, text, reports, reason) => {
      const result = await recover(text, reportFor(reports));

      expect(hintNamed(result, 'Café Lumen').localityAssertion).toBeUndefined();
      expect(localityAuditOf(result, 'Café Lumen')?.reason).toBe(reason);
    });

    it('two statements that disagree admit neither', async () => {
      const result = await recover(
        'Café Lumen is in Tokyo. We loved Café Lumen in Kyoto.',
        (component, statement) =>
          component.name !== 'Café Lumen' || statement.includes('9 am')
            ? []
            : statement.includes('Tokyo')
              ? [{ place: 'Tokyo', relation: 'LOCATED_IN' }]
              : [{ place: 'Kyoto', relation: 'LOCATED_IN' }],
      );

      expect(localityAuditOf(result, 'Café Lumen').reason).toBe(
        'CONFLICTING_LOCALITIES',
      );
    });

    it('a denial whose place the reader did not quote literally still blocks the containment', async () => {
      const result = await recover(
        'Café Lumen is in 東京. Café Lumen is not in 東京 anymore.',
        (component, statement) =>
          component.name !== 'Café Lumen' || statement.includes('9 am')
            ? []
            : statement.includes('not')
              ? [{ place: 'Tokyo', relation: 'NOT_IN' }]
              : [{ place: '東京', relation: 'LOCATED_IN' }],
      );

      expect(hintNamed(result, 'Café Lumen').localityAssertion).toBeUndefined();
      expect(localityAuditOf(result, 'Café Lumen').reason).toBe(
        'CONFLICTING_LOCALITIES',
      );
    });

    it('a containment one statement denies elsewhere is refused', async () => {
      const result = await recover(
        'Café Lumen is in Tokyo. Café Lumen is not in Tokyo anymore.',
        (component, statement) =>
          component.name !== 'Café Lumen' || statement.includes('9 am')
            ? []
            : statement.includes('not')
              ? [{ place: 'Tokyo', relation: 'NOT_IN' }]
              : [{ place: 'Tokyo', relation: 'LOCATED_IN' }],
      );

      expect(localityAuditOf(result, 'Café Lumen').reason).toBe(
        'CONFLICTING_LOCALITIES',
      );
    });
  });

  it('never examines an AREA component, and makes no request when nothing is eligible', async () => {
    const evidence = [ev('ev-1', 'Valle de Uco is in Mendoza.')];
    const { complete, requests } = model(() => []);

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Valley',
            hints: [
              {
                name: 'Valle de Uco',
                expectedKind: 'AREA',
                supportSpan: 'Valle de Uco is in Mendoza.',
              },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(requests).toHaveLength(0);
    expect(result.localityRecovery.status).toBe('NOT_NEEDED');
  });

  it('skips a component named in more statements than the limit (no partial examination)', async () => {
    const text = `${Array.from({ length: 13 }, (_, i) => `Café Lumen visit ${i + 1}.`).join(' ')} Museo Azul – 11 am.`;
    const evidence = [ev('ev-1', text)];
    const { complete, requests } = model(() => []);

    const result = await recoverComponentLocalities(
      extraction(
        [
          {
            name: 'Day',
            hints: [
              { name: 'Café Lumen', supportSpan: 'Café Lumen visit 1.' },
              { name: 'Museo Azul', supportSpan: 'Museo Azul – 11 am.' },
            ],
          },
        ],
        evidence,
      ),
      evidence,
      complete,
    );

    expect(localityAuditOf(result, 'Café Lumen').reason).toBe(
      'STATEMENT_LIMIT_EXCEEDED',
    );
    expect(promptComponents(requests[0].user).map((c) => c.name)).toEqual([
      'Museo Azul',
    ]);
  });
});
