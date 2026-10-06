import { DiscoveryStructuredCompletionRequest } from '../interfaces/experience-discovery.interface';
import {
  ATOM_LABELLING_SYSTEM_PROMPT,
  MEMBER_KIND_SYSTEM_PROMPT,
} from '../prompts/source-atom-labelling.prompt';
import { SourceContentWindowingAudit } from '../utils/source-content-windowing.util';
import { extractExperienceCandidates } from '../utils/experience-candidate-extraction.util';
import { GenerationTraceRecorder } from '../utils/generation-trace-recorder.util';
import { projectAtomizedSourceUnitSteps } from '../utils/generation-trace/atomized-source-unit-audit';
import {
  readAtomizedFixture,
  recordedAtomTransport as recordedTransport,
  recordedRun,
} from '../fixtures/atomized-source-units.fixture';
import {
  AtomizedSourceUnitExtractor,
  labelAtomizedSourceUnit,
} from './atomized-source-unit-extractor';

const SOB = readAtomizedFixture('sob-day1-unit.md');
const AG = readAtomizedFixture('ag-san-telmo-unit.md');
/** Live Gemini answers recorded by the accepted spike at current settings. */
const SOB_RUN = recordedRun('recorded-sob-run1.json');
const AG_RUN = recordedRun('recorded-ag-run1.json');

const windowing = (
  patch: Partial<SourceContentWindowingAudit> = {},
): SourceContentWindowingAudit => ({
  selectionStrategy: 'SECTION_UNIT',
  originalContentChars: 17027,
  removedPayloadChars: 0,
  normalizedContentChars: 17027,
  retainedContentChars: 14926,
  maxChars: 12000,
  unitMaxChars: 16000,
  sectionComplete: true,
  truncated: true,
  chunkCount: 30,
  selectedExcerpts: [],
  windowOrdinal: 1,
  windowCount: 3,
  newChunkCount: 20,
  overlapChunkCount: 0,
  unexaminedChunkCountAfter: 10,
  ...patch,
});

const extractor = (transport: {
  completeStructured: (
    r: DiscoveryStructuredCompletionRequest,
  ) => Promise<string>;
}) =>
  new AtomizedSourceUnitExtractor(transport, {
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
  });
const input = (
  content: string,
  patch: Partial<SourceContentWindowingAudit> = {},
) => ({
  sourceUrl:
    'https://secretsofbuenosaires.com/day-1-self-guided-walking-tour-in-buenos-aires/',
  evidenceKey: 'ev-3',
  sourceTitle: 'Day 1: Self-Guided Walking Tour in Buenos Aires',
  content,
  windowing: windowing(patch),
});
const formatOpenedBy = (o: { atomId: string; transferMode: string }) =>
  `${o.atomId}:${o.transferMode}`;

describe('labelAtomizedSourceUnit (recorded live answers, offline)', () => {
  it('reproduces the spike assembly of the recorded SOB run: 4 batches, first pass valid', async () => {
    const { transport } = recordedTransport(SOB_RUN);
    const result = await labelAtomizedSourceUnit(SOB, (r) =>
      transport.completeStructured(r),
    );
    expect(result.outcome).toBe('ASSEMBLED');
    expect(result.calls.map((c) => c.kind)).toEqual([
      'batch',
      'batch',
      'batch',
      'batch',
    ]);
    expect(result.relabel).toBeNull();
    expect(result.final.labels.size).toBe(182);
    expect(
      result.segments.map((s) => ({
        mandatory: s.mandatory,
        openedBy: s.openedBy.map(formatOpenedBy),
        optional: s.optional,
        alternativeGroups: s.alternativeGroups,
        routeLegs: s.routeLegs,
        passBy: s.passBy,
      })),
    ).toEqual(SOB_RUN.spikeSegments);
    // The a-172 chrome link is structural, never labelled by the model.
    expect(result.final.labels.get('a-172')).toMatchObject({
      source: 'STRUCTURAL',
      kind: 'NON_EDITORIAL',
    });
  });

  it('reproduces the spike assembly of the recorded AG run, with its one bounded relabel', async () => {
    const { transport } = recordedTransport(AG_RUN);
    const result = await labelAtomizedSourceUnit(AG, (r) =>
      transport.completeStructured(r),
    );
    expect(result.outcome).toBe('ASSEMBLED');
    expect(result.relabel.scope).toEqual(AG_RUN.spikeRelabelScope);
    expect(result.calls.map((c) => c.kind)).toEqual([
      'batch',
      'batch',
      'batch',
      'batch',
      'batch',
      'relabel',
    ]);
    expect(
      result.segments.map((s) => ({
        mandatory: s.mandatory,
        openedBy: s.openedBy.map(formatOpenedBy),
        optional: s.optional,
        alternativeGroups: s.alternativeGroups,
        routeLegs: s.routeLegs,
        passBy: s.passBy,
      })),
    ).toEqual(AG_RUN.spikeSegments);
  });

  it('accounts for every atom exactly once across batches and asks the model only about editorial atoms', async () => {
    const asked: string[] = [];
    const nonItinerary = async (
      request: DiscoveryStructuredCompletionRequest,
    ) => {
      const ids = [
        ...request.user.split('\nLABEL:\n')[1].matchAll(/^\[(a-\d+)\]/gmu),
      ].map((m) => m[1]);
      asked.push(...ids);
      return JSON.stringify({
        atoms: ids.map((atomId) => ({
          atomId,
          classification: 'NON_ITINERARY',
          entities: [] as unknown[],
        })),
      });
    };
    const result = await labelAtomizedSourceUnit(SOB, nonItinerary);
    expect(result.outcome).toBe('ASSEMBLED');
    expect(result.batches.length).toBeGreaterThan(1);
    expect(asked).toEqual(
      result.atoms.filter((a) => a.editorial).map((a) => a.atomId),
    );
    expect([...result.final.labels.keys()].sort()).toEqual(
      result.atoms.map((a) => a.atomId),
    );
    for (const a of result.atoms.filter((x) => !x.editorial))
      expect(result.final.labels.get(a.atomId).kind).toBe('NON_EDITORIAL');
  });

  it('runs at most one relabel round; a second invalid answer fails closed; malformed output is not repairable', async () => {
    const text =
      'Start at the Old Square.\nWalk to the Fish Market.\nPrices are low.';
    const answer = (fixed: boolean) =>
      JSON.stringify({
        atoms: [
          {
            atomId: 'a-001',
            classification: 'ITINERARY_STOP',
            entities: [
              {
                sourceName: 'Old Square',
                supportSpan: 'Start at the Old Square',
                role: 'ITINERARY_STOP',
              },
            ],
          },
          {
            atomId: 'a-002',
            classification: 'ITINERARY_STOP',
            entities: fixed
              ? [
                  {
                    sourceName: 'Fish Market',
                    supportSpan: 'Walk to the Fish Market',
                    role: 'ITINERARY_STOP',
                  },
                ]
              : [],
          },
          { atomId: 'a-003', classification: 'NON_ITINERARY', entities: [] },
        ],
      });
    const relabelOnly = (fixed: boolean) =>
      JSON.stringify({
        atoms: JSON.parse(answer(fixed)).atoms.filter(
          (l: { atomId: string }) => l.atomId === 'a-002',
        ),
      });
    const repaired = await labelAtomizedSourceUnit(text, async (r) =>
      r.user.startsWith('Your previous labels')
        ? relabelOnly(true)
        : answer(false),
    );
    expect(repaired.outcome).toBe('ASSEMBLED');
    expect(repaired.calls.map((c) => c.kind)).toEqual(['batch', 'relabel']);
    expect(repaired.relabel.scope).toEqual(['a-002']);

    const failed = await labelAtomizedSourceUnit(text, async (r) =>
      r.user.startsWith('Your previous labels')
        ? relabelOnly(false)
        : answer(false),
    );
    expect(failed.outcome).toBe('CONTRACT_FAIL_CLOSED');
    expect(failed.calls.map((c) => c.kind)).toEqual(['batch', 'relabel']);
    expect(failed.final.issues.map((x) => `${x.code}:${x.atomId}`)).toEqual([
      'STOP_WITHOUT_ENTITY:a-002',
    ]);
    expect(failed.segments).toBeNull();

    const malformed = await labelAtomizedSourceUnit(
      text,
      async () => '{not json',
    );
    expect(malformed.outcome).toBe('CONTRACT_FAIL_CLOSED');
    expect(malformed.calls.map((c) => c.kind)).toEqual(['batch']);
    expect(malformed.relabel.scope).toBeNull();
    expect(malformed.relabel.firstPassIssues.map((x) => x.code)).toEqual([
      'MALFORMED_RESPONSE',
      'MISSING_ATOM',
      'MISSING_ATOM',
      'MISSING_ATOM',
    ]);
  });

  it('classifies a provider timeout operationally as INVALID_RUN with its batch, never as a contract outcome', async () => {
    const { transport } = recordedTransport(SOB_RUN, undefined, {
      batch: (index) =>
        index === 2
          ? Promise.reject(new Error('Gemini request timeout after 25000ms'))
          : undefined,
    });
    const result = await labelAtomizedSourceUnit(SOB, (r) =>
      transport.completeStructured(r),
    );
    expect(result.outcome).toBe('INVALID_RUN');
    expect(result.failure).toEqual({
      kind: 'batch',
      batchIndex: 2,
      message: 'Gemini request timeout after 25000ms',
    });
    expect(result.final).toBeUndefined();
    expect(result.segments).toBeNull();
    expect(result.calls.map((c) => c.kind)).toEqual(['batch', 'batch']);

    const relabelTimeout = await labelAtomizedSourceUnit(
      'Walk to the Fish Market.',
      async (r) => {
        if (r.user.startsWith('Your previous labels'))
          throw new Error('Gemini error 503: unavailable');
        return JSON.stringify({
          atoms: [
            { atomId: 'a-001', classification: 'ITINERARY_STOP', entities: [] },
          ],
        });
      },
    );
    expect(relabelTimeout.outcome).toBe('INVALID_RUN');
    expect(relabelTimeout.failure).toMatchObject({
      kind: 'relabel',
      batchIndex: 0,
    });
  });
});

describe('AtomizedSourceUnitExtractor', () => {
  // Hand-written physical kinds for the test double (a street is a ROUTE).
  const ROUTES = new Set(['Defensa Street', 'Caminito Street', 'El Caminito']);
  const AREAS = new Set(['La Boca', 'oldest neighborhood of the capital city']);
  const kindOf = (name: string) =>
    ROUTES.has(name) ? 'ROUTE' : AREAS.has(name) ? 'AREA' : 'PLACE';

  it('is the composition authority for a complete SECTION_UNIT only', async () => {
    const { transport, requests } = recordedTransport(SOB_RUN);
    for (const patch of [
      { sectionComplete: false },
      { selectionStrategy: 'DOCUMENT_ORDER_CONTINUATION' as const },
      { selectionStrategy: 'RELEVANCE_WINDOWS' as const },
    ])
      await expect(
        extractor(transport).extract(input(SOB, patch)),
      ).rejects.toThrow(/complete SECTION_UNIT/);
    expect(requests).toEqual([]);
  });

  it('turns each segment with mandatory membership into one candidate whose hints are exactly its ITINERARY_STOP members', async () => {
    const { transport } = recordedTransport(SOB_RUN, kindOf);
    const result = await extractor(transport).extract(input(SOB));

    expect(result.unit.contractOutcome).toBe('ASSEMBLED');
    expect(result.validationErrors).toEqual([]);
    // Three assembled segments; the return-transfer one has no mandatory
    // members and is not a candidate.
    expect(result.unit.assembledSegmentCount).toBe(3);
    expect(result.candidates).toHaveLength(2);
    const [s1, s2] = SOB_RUN.spikeSegments;
    expect(
      result.candidates.map((c) => c.componentHints.map((h) => h.name)),
    ).toEqual([s1.mandatory, s2.mandatory]);
    for (const candidate of result.candidates) {
      expect(candidate).toMatchObject({
        themes: [],
        intents: [],
        traits: [],
        orderedByEvidence: true,
        evidenceKeys: ['ev-3'],
      });
      // Non-membership roles never become component hints.
      const names = candidate.componentHints.map((h) => h.name);
      for (const s of SOB_RUN.spikeSegments)
        for (const n of [
          ...s.routeLegs,
          ...s.passBy,
          ...s.optional,
          ...s.alternativeGroups.flat(),
        ])
          if (!s1.mandatory.includes(n) && !s2.mandatory.includes(n))
            expect(names).not.toContain(n);
    }
    // Physical kind drives the existing hint role/kind contract.
    const caminito = result.candidates[1].componentHints.find(
      (h) => h.name === 'El Caminito',
    );
    expect(caminito).toMatchObject({ role: 'route', expectedKind: 'ROUTE' });
    const plaza = result.candidates[0].componentHints[0];
    expect(plaza).toMatchObject({
      name: 'PLAZA DE MAYO',
      sourceName: 'PLAZA DE MAYO',
      role: 'venue',
      expectedKind: 'PLACE',
    });
    // The unchanged source-support gate verified every hint against the
    // unit text itself; no normalization was invented.
    expect(result.sourceSupportAudits.map((a) => a.status)).toEqual([
      'SUPPORTED',
      'SUPPORTED',
    ]);
    for (const hint of result.candidates.flatMap((c) => c.componentHints)) {
      expect(hint.sourceName).toBe(hint.name);
      expect(hint).not.toHaveProperty('normalizationKind');
      expect(hint.evidenceKeys).toEqual(['ev-3']);
    }
    // Source-derived names: unit heading + structural part suffix (neither
    // segment has its own source heading).
    expect(result.candidates.map((c) => c.name)).toEqual([
      'Walking tour Buenos Aires – Day 1 (part 1 of 2)',
      'Walking tour Buenos Aires – Day 1 (part 2 of 2)',
    ]);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.5-flash-lite');
  });

  it('records a pre-identity trace that proves the mandatory sequence even before identity', async () => {
    const { transport } = recordedTransport(SOB_RUN, kindOf);
    const { unit } = await extractor(transport).extract(input(SOB));

    expect(unit).toMatchObject({
      sourceUrl: input(SOB).sourceUrl,
      evidenceKey: 'ev-3',
      sectionComplete: true,
      selectionStrategy: 'SECTION_UNIT',
      atomCount: 182,
      nonEditorialAtomCount: 63,
      editorialAtomCount: 119,
      batchCount: 4,
      relabelAttempts: 0,
      contractOutcome: 'ASSEMBLED',
      providerFailure: null,
      assembledSegmentCount: 3,
      versions: {
        atomizer: 'atomizer-v1',
        structure: 'editorial-structure-v1',
        prompt: 'labelling-prompt-v4',
        memberKindPrompt: 'member-kind-prompt-v1',
      },
    });
    expect(unit.nonEditorialBlocks.map((b) => b.blockId)).toEqual([
      'nav-1',
      'nav-2',
      'nav-3',
    ]);
    expect(unit.atoms).toHaveLength(182);
    expect(unit.atoms.find((a) => a.atomId === 'a-172')).toMatchObject({
      editorial: false,
      label: 'NON_EDITORIAL',
      entities: [],
    });
    // "The source yielded mandatory sequence A -> B -> ..." is provable.
    const [s1, s2, s3] = unit.segments;
    expect(s1.mandatoryBeforeIdentity.map((m) => m.sourceName)).toEqual(
      SOB_RUN.spikeSegments[0].mandatory,
    );
    expect(s2.transferBoundary.map(formatOpenedBy)).toEqual([
      'a-085:BUS',
      'a-086:TAXI',
    ]);
    expect(s2.mandatoryBeforeIdentity).toEqual([
      expect.objectContaining({
        position: 1,
        sourceName: 'El Caminito',
        physicalKind: 'ROUTE',
        provenanceAtomIds: expect.any(Array),
      }),
      expect.objectContaining({ position: 2, sourceName: 'La Bombonera' }),
    ]);
    expect(s3.mandatoryBeforeIdentity).toEqual([]);
    expect(unit.candidateNames).toHaveLength(2);
    // Semantic roles are observable per atom and per non-member.
    expect(unit.atoms.flatMap((a) => a.entities.map((e) => e.role))).toEqual(
      expect.arrayContaining(['ITINERARY_STOP', 'TRANSFER_DESTINATION']),
    );
    expect(new Set(unit.nonMembership.map((n) => n.role))).toEqual(
      new Set(
        unit.atoms
          .flatMap((a) => a.entities.map((e) => e.role))
          .filter((r) => r !== 'ITINERARY_STOP'),
      ),
    );
    // Anaphora provenance: "enjoy the park" resolves through its cited atom.
    const park = unit.atoms
      .flatMap((a) => a.entities.map((e) => ({ atomId: a.atomId, ...e })))
      .find((e) => e.mentionAtomId && e.anaphorStatus === 'RESOLVED');
    expect(park).toMatchObject({
      antecedentAtomId: park.mentionAtomId,
      antecedentSourceName: park.sourceName,
    });

    // Through the real recorder: nothing is truncated or redacted, and the
    // atoms are paged within the step limits.
    const recorder = new GenerationTraceRecorder();
    for (const step of projectAtomizedSourceUnitSteps(unit))
      recorder.record(step);
    const trace = recorder.build({ result: { status: 'COMPLETED' } });
    const json = JSON.stringify(trace);
    expect(json).not.toContain('MAX_STEP_PAYLOAD_CHARS');
    expect(json).not.toContain('MAX_DEPTH');
    expect(json).not.toContain('[REDACTED]');
    const pages = trace.steps.filter(
      (s) => s.name === 'acquisition.atomized_source_atoms',
    );
    expect(
      pages.flatMap((s) => (s.facts as { atoms: unknown[] }).atoms),
    ).toHaveLength(182);
    const summary = trace.steps.find(
      (s) => s.name === 'acquisition.atomized_source_unit',
    );
    expect(summary.decision).toMatchObject({
      status: 'PASS',
      outcome: 'ASSEMBLED',
    });
    expect(
      (summary.facts as any).segments[0].mandatoryBeforeIdentity.map(
        (m: { sourceName: string }) => m.sourceName,
      ),
    ).toEqual(SOB_RUN.spikeSegments[0].mandatory);
    // No transport request (prompts, keys) is ever part of the trace.
    expect(json).not.toContain(ATOM_LABELLING_SYSTEM_PROMPT);
    expect(json).not.toMatch(/"(?:api[-_ ]?key|authorization|token)"/i);
  });

  it('names segments from their own source heading when exactly one exists', async () => {
    const text = [
      '## Two harbour days',
      '### Morning',
      'Start at the Old Square.',
      'Walk to the Fish Market.',
      '### Afternoon by bus',
      'Take the bus to the Lighthouse.',
      'Visit the Lighthouse.',
      'Visit the Shell Museum.',
    ].join('\n');
    const answer = JSON.stringify({
      atoms: [
        { atomId: 'a-001', classification: 'NON_ITINERARY', entities: [] },
        { atomId: 'a-002', classification: 'NON_ITINERARY', entities: [] },
        {
          atomId: 'a-003',
          classification: 'ITINERARY_STOP',
          entities: [
            {
              sourceName: 'Old Square',
              supportSpan: 'Start at the Old Square',
              role: 'ITINERARY_STOP',
            },
          ],
        },
        {
          atomId: 'a-004',
          classification: 'ITINERARY_STOP',
          entities: [
            {
              sourceName: 'Fish Market',
              supportSpan: 'Walk to the Fish Market',
              role: 'ITINERARY_STOP',
            },
          ],
        },
        {
          atomId: 'a-005',
          classification: 'TRANSFER',
          entities: [],
          transferMode: 'BUS',
        },
        {
          atomId: 'a-006',
          classification: 'TRANSFER',
          entities: [
            {
              sourceName: 'Lighthouse',
              supportSpan: 'bus to the Lighthouse',
              role: 'ITINERARY_STOP',
            },
          ],
          transferMode: 'BUS',
        },
        {
          atomId: 'a-007',
          classification: 'ITINERARY_STOP',
          entities: [
            {
              sourceName: 'Lighthouse',
              supportSpan: 'Visit the Lighthouse',
              role: 'ITINERARY_STOP',
            },
          ],
        },
        {
          atomId: 'a-008',
          classification: 'ITINERARY_STOP',
          entities: [
            {
              sourceName: 'Shell Museum',
              supportSpan: 'Visit the Shell Museum',
              role: 'ITINERARY_STOP',
            },
          ],
        },
      ],
    });
    const { transport } = recordedTransport({
      batchAnswers: [answer],
      relabelAnswer: null,
    });
    const result = await extractor(transport).extract(input(text));
    expect(result.candidates.map((c) => c.name)).toEqual([
      'Two harbour days — Morning',
      'Two harbour days — Afternoon by bus',
    ]);
    // A single candidate segment keeps the unit heading as its name; with
    // no heading the grounded source title is used.
    const single = recordedTransport({
      batchAnswers: [
        JSON.stringify({
          atoms: [
            {
              atomId: 'a-001',
              classification: 'ITINERARY_STOP',
              entities: [
                {
                  sourceName: 'Old Square',
                  supportSpan: 'Start at the Old Square',
                  role: 'ITINERARY_STOP',
                },
              ],
            },
            {
              atomId: 'a-002',
              classification: 'ITINERARY_STOP',
              entities: [
                {
                  sourceName: 'Fish Market',
                  supportSpan: 'Walk to the Fish Market',
                  role: 'ITINERARY_STOP',
                },
              ],
            },
          ],
        }),
      ],
      relabelAnswer: null,
    });
    const titled = await extractor(single.transport).extract(
      input('Start at the Old Square.\nWalk to the Fish Market.'),
    );
    expect(titled.candidates.map((c) => c.name)).toEqual([
      'Day 1: Self-Guided Walking Tour in Buenos Aires',
    ]);
  });

  it('fails the unit closed when a member kind is missing or invalid, keeping the trace', async () => {
    const { transport } = recordedTransport(SOB_RUN, kindOf, {
      kind: (members) =>
        Promise.resolve(
          JSON.stringify({
            members: members.slice(1).map((m) => ({
              memberId: m.memberId,
              physicalKind: m.name === 'La Bombonera' ? 'STADIUM' : 'PLACE',
            })),
          }),
        ),
    });
    const result = await extractor(transport).extract(input(SOB));
    expect(result.candidates).toEqual([]);
    expect(result.unit.contractOutcome).toBe('CONTRACT_FAIL_CLOSED');
    expect(result.unit.memberKindIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KIND_MISSING_MEMBER',
          segmentIndex: 1,
          memberId: 'm-1',
        }),
        expect.objectContaining({
          code: 'KIND_INVALID',
          segmentIndex: 2,
          memberId: 'm-2',
        }),
      ]),
    );
    expect(result.validationErrors[0]).toMatch(
      /^ATOMIZED_UNIT_CONTRACT_FAIL_CLOSED: .*KIND_MISSING_MEMBER:s1\.m-1/,
    );
    // The fidelity evidence survives the failure.
    expect(
      result.unit.segments[0].mandatoryBeforeIdentity.map((m) => m.sourceName),
    ).toEqual(SOB_RUN.spikeSegments[0].mandatory);
  });

  it('classifies a member-kind transport failure as INVALID_RUN', async () => {
    const { transport } = recordedTransport(SOB_RUN, kindOf, {
      kind: () =>
        Promise.reject(new Error('Gemini request timeout after 25000ms')),
    });
    const result = await extractor(transport).extract(input(SOB));
    expect(result.candidates).toEqual([]);
    expect(result.unit.contractOutcome).toBe('INVALID_RUN');
    expect(result.unit.providerFailure).toEqual({
      kind: 'member_kind',
      batchIndex: 1,
      message: 'Gemini request timeout after 25000ms',
    });
  });

  it('a labelling timeout yields no candidates, no kind call, and a trace with the failed batch', async () => {
    const { transport, requests } = recordedTransport(SOB_RUN, kindOf, {
      batch: (index) =>
        index === 3
          ? Promise.reject(new Error('Gemini error 429: rate limited'))
          : undefined,
    });
    const result = await extractor(transport).extract(input(SOB));
    expect(result.candidates).toEqual([]);
    expect(result.extractionFailures).toEqual([]);
    expect(result.unit).toMatchObject({
      contractOutcome: 'INVALID_RUN',
      providerFailure: { kind: 'batch', batchIndex: 3 },
      assembledSegmentCount: null,
      atomCount: 182,
    });
    expect(requests.some((r) => r.system === MEMBER_KIND_SYSTEM_PROMPT)).toBe(
      false,
    );
    expect(result.validationErrors[0]).toMatch(
      /^ATOMIZED_UNIT_INVALID_RUN: batch#3: Gemini error 429/,
    );
  });
});

describe('MISSING_NORMALIZATION_KIND with literal source wording (milestone B check)', () => {
  const evidence = [
    {
      key: 'ev-1',
      text: 'Start at the Old Square, then visit the Fish Market.',
    },
  ];
  const candidate = (hints: Array<Record<string, unknown>>) => ({
    name: 'Walk',
    themes: [] as string[],
    traits: [] as string[],
    intents: [] as string[],
    componentHints: hints.map((h, i) => ({
      key: `c${i + 1}`,
      role: 'venue',
      expectedKind: 'PLACE',
      evidenceKeys: ['ev-1'],
      ...h,
    })),
    evidenceKeys: ['ev-1'],
    shortReason: 'fixture',
  });
  const audit = (hints: Array<Record<string, unknown>>) =>
    extractExperienceCandidates([candidate(hints)], evidence, 1)
      .sourceSupportAudits[0];

  it('does not require normalizationKind when the name is the source wording', () => {
    // sourceName absent (the atomized path) and sourceName === name.
    for (const hints of [
      [
        { name: 'Old Square', supportSpan: 'Start at the Old Square' },
        { name: 'Fish Market', supportSpan: 'visit the Fish Market' },
      ],
      [
        {
          name: 'Old Square',
          sourceName: 'Old Square',
          supportSpan: 'Start at the Old Square',
        },
        {
          name: 'Fish Market',
          sourceName: 'Fish Market',
          supportSpan: 'visit the Fish Market',
        },
      ],
    ]) {
      const a = audit(hints);
      expect(a.status).toBe('SUPPORTED');
      expect(a.components.every((c) => c.normalizationKind === undefined)).toBe(
        true,
      );
    }
  });

  it('still requires typed normalization evidence for a real normalization', () => {
    const missing = audit([
      {
        name: 'Plaza del Casco Viejo',
        sourceName: 'Old Square',
        supportSpan: 'Start at the Old Square',
      },
      { name: 'Fish Market', supportSpan: 'visit the Fish Market' },
    ]);
    expect(missing.status).toBe('SOURCE_CONTRACT_VIOLATION');
    expect(missing.components[0]).toMatchObject({
      status: 'UNSUPPORTED',
      reason: 'MISSING_NORMALIZATION_KIND',
    });
    const typed = audit([
      {
        name: 'Plaza del Casco Viejo',
        sourceName: 'Old Square',
        normalizationKind: 'TRANSLATION',
        supportSpan: 'Start at the Old Square',
      },
      { name: 'Fish Market', supportSpan: 'visit the Fish Market' },
    ]);
    expect(typed.status).toBe('SUPPORTED');
    expect(typed.components[0].normalizationKind).toBe('TRANSLATION');
  });
});
