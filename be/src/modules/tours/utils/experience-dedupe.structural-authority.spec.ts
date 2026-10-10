import {
  DedupeDecision,
  DedupeExperienceFingerprint,
  decideExperienceDedupe,
} from './experience-dedupe.util';

/**
 * DEDUPE_STRUCTURAL_AUTHORITY (2026-10-08, forensic cb39f467).
 *
 * Experience identity is decided by the structural relation of the two
 * source-defined compositions plus source provenance and the existing strong
 * identity evidence. Lexical "semantic" overlap (name + description + themes
 * tokens) is diagnostic only: it never decides SAME, AMBIGUOUS or NEW.
 */
describe('decideExperienceDedupe · structural identity authority', () => {
  type Member = [geoEntityId: string | null, sourceName: string];

  const fingerprint = (
    id: string | undefined,
    members: Member[],
    overrides: Partial<DedupeExperienceFingerprint> = {},
  ): DedupeExperienceFingerprint => ({
    ...(id ? { id } : {}),
    canonicalName: 'San Telmo walk',
    semanticTerms: ['An evidenced San Telmo walk', 'history', 'walk'],
    conceptTerms: ['history', 'walk'],
    latitude: null,
    longitude: null,
    provenance: ['web'],
    components: members.map(([geoEntityId, sourceName], index) => ({
      geoEntityId,
      ...(geoEntityId ? {} : { resolutionState: 'UNRESOLVED' as const }),
      sourceName,
      role: 'waypoint',
      sourcePosition: index,
      order: index + 1,
    })),
    ...overrides,
  });

  const m = (letter: string, resolved = true): Member => [
    resolved ? letter : null,
    `Stop ${letter}`,
  ];
  const partialAF: Member[] = [
    m('A'),
    m('B'),
    m('C', false),
    m('D'),
    m('E', false),
    m('F'),
  ];
  const completeAB: Member[] = [m('A'), m('B')];

  /** The forensic fixture: identical description/themes, different names. */
  const sharedText = {
    semanticTerms: ['An evidenced San Telmo walk', 'history', 'walk'],
    conceptTerms: ['history', 'walk'],
  };
  const existingAF = (overrides: Partial<DedupeExperienceFingerprint> = {}) =>
    fingerprint('partial-a-f', partialAF, {
      canonicalName: 'Walk A-B-C-D-E-F',
      ...sharedText,
      ...overrides,
    });
  const incomingAB = (overrides: Partial<DedupeExperienceFingerprint> = {}) =>
    fingerprint(undefined, completeAB, {
      canonicalName: 'Walk A-B',
      ...sharedText,
      ...overrides,
    });

  /** Compare both persistence orders of the same pair. */
  const bothOrders = (
    left: DedupeExperienceFingerprint,
    right: DedupeExperienceFingerprint,
  ): [DedupeDecision, DedupeDecision] => [
    decideExperienceDedupe({ ...left, id: undefined }, [
      { ...right, id: 'right' },
    ]),
    decideExperienceDedupe({ ...right, id: undefined }, [
      { ...left, id: 'left' },
    ]),
  ];

  describe('PARTIAL A-F (A,B resolved) vs later COMPLETE A-B', () => {
    it('1. is NOT SAME and the incoming A-B persists as a coexisting SUBCOMPOSITION', () => {
      const decision = decideExperienceDedupe(incomingAB(), [existingAF()]);

      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.structure).toEqual({
        relation: 'SUBCOMPOSITION',
        containment: 'INCOMING_WITHIN_EXISTING',
        sharedSourceMembers: [
          {
            incomingSourcePositions: [0],
            existingSourcePositions: [0],
            basis: ['SOURCE_WORDING', 'RESOLVED_GEOENTITY'],
          },
          {
            incomingSourcePositions: [1],
            existingSourcePositions: [1],
            basis: ['SOURCE_WORDING', 'RESOLVED_GEOENTITY'],
          },
        ],
        sharedResolvedGeoEntityIds: ['A', 'B'],
        sourceMemberCounts: { incoming: 2, existing: 6 },
      });
      expect(decision.evidence.decisiveEvidence).toBe(
        'SUBCOMPOSITION_SOURCE_UNKNOWN',
      );
    });

    it('2. identical descriptions/themes (lexical overlap above the old 0.58 cut) cannot block it', () => {
      const decision = decideExperienceDedupe(incomingAB(), [existingAF()]);

      // The forensic value that used to decide AMBIGUOUS on its own.
      expect(decision.evidence.semanticSimilarity).toBeCloseTo(8 / 12);
      expect(decision.evidence.semanticSimilarity).toBeGreaterThanOrEqual(0.58);
      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.reasons).not.toContain(
        'partial_semantic_overlap',
      );
    });

    it('3. different descriptions give the same structural decision', () => {
      const same = decideExperienceDedupe(incomingAB(), [existingAF()]);
      const different = decideExperienceDedupe(
        incomingAB({
          semanticTerms: ['Two classic cafés in the old quarter'],
          conceptTerms: ['food'],
        }),
        [existingAF()],
      );

      expect(different.decision).toBe(same.decision);
      expect(different.evidence.structure).toEqual(same.evidence.structure);
      expect(different.evidence.decisiveEvidence).toBe(
        same.evidence.decisiveEvidence,
      );
    });
  });

  describe('SUBCOMPOSITION and source provenance', () => {
    it('4. different-source SUBCOMPOSITION coexists', () => {
      const decision = decideExperienceDedupe(
        incomingAB({ sourceDocuments: ['https://blog.example/ab-walk'] }),
        [existingAF({ sourceDocuments: ['https://guide.example/six-stops'] })],
      );

      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.sourceRelation).toBe('DIFFERENT_SOURCE');
      expect(decision.evidence.decisiveEvidence).toBe(
        'SUBCOMPOSITION_DIFFERENT_SOURCE',
      );
    });

    it('5. same-source SUBCOMPOSITION is NOT SAME and identical text alone cannot reject it', () => {
      const decision = decideExperienceDedupe(
        incomingAB({
          sourceDocuments: ['https://guide.example/san-telmo#first-part'],
        }),
        [existingAF({ sourceDocuments: ['HTTPS://guide.example/san-telmo/'] })],
      );

      expect(decision.decision).not.toBe('SAME');
      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.sourceRelation).toBe('SAME_SOURCE');
      expect(decision.evidence.decisiveEvidence).toBe(
        'SUBCOMPOSITION_SAME_SOURCE_CONTAINMENT',
      );
    });

    it('a contained composition is never SAME, even with the identical name (it stays an open question)', () => {
      const decision = decideExperienceDedupe(
        incomingAB({ canonicalName: 'San Telmo walk' }),
        [existingAF({ canonicalName: 'San Telmo walk' })],
      );

      expect(decision.decision).toBe('AMBIGUOUS');
      expect(decision.evidence.decisiveEvidence).toBe(
        'STRUCTURAL_OVERLAP_WITH_SIMILAR_NAME',
      );
    });

    it('spec §8: Walk A (3 stops) inside Walk B (+ Pasaje Defensa) coexists, although they share 3/4 members', () => {
      const decision = decideExperienceDedupe(
        fingerprint(undefined, [m('Dorrego'), m('Mercado'), m('Zanjon')], {
          canonicalName: 'Plaza Dorrego and Mercado stroll',
        }),
        [
          fingerprint(
            'walk-b',
            [m('Dorrego'), m('Mercado'), m('Zanjon'), m('Defensa')],
            { canonicalName: 'San Telmo heritage circuit' },
          ),
        ],
      );

      expect(decision.evidence.componentOverlap).toBe(0.75);
      expect(decision.evidence.structure.relation).toBe('SUBCOMPOSITION');
      expect(decision.decision).toBe('NEW');
    });

    it('a conflicting evidenced order over the shared members is not containment', () => {
      const decision = decideExperienceDedupe(
        fingerprint(undefined, [m('B'), m('A')], {
          canonicalName: 'Walk B-A',
        }),
        [existingAF()],
      );

      expect(decision.evidence.orderConflict).toBe(true);
      expect(decision.evidence.structure.relation).toBe('PARTIAL_OVERLAP');
    });
  });

  describe('EXACT_COMPOSITION', () => {
    it('6. existing SAME behavior is preserved (complete and partial)', () => {
      const complete = decideExperienceDedupe(
        fingerprint(undefined, completeAB),
        [fingerprint('complete-a-b', completeAB)],
      );
      const partial = decideExperienceDedupe(
        fingerprint(undefined, partialAF),
        [fingerprint('partial-a-f', partialAF)],
      );

      for (const decision of [complete, partial]) {
        expect(decision.decision).toBe('SAME');
        expect(decision.evidence.structure.relation).toBe('EXACT_COMPOSITION');
        expect(decision.evidence.decisiveEvidence).toBe(
          'EXACT_COMPOSITION_IDENTITY_CONFIRMED',
        );
      }
    });

    it('identical text cannot establish SAME without identity agreement: an exact composition with different names and concepts stays AMBIGUOUS', () => {
      const decision = decideExperienceDedupe(
        fingerprint(undefined, completeAB, {
          canonicalName: 'Craft beer crawl',
          conceptTerms: ['nightlife'],
        }),
        [
          fingerprint('history-walk', completeAB, {
            canonicalName: 'Historical walking tour',
            conceptTerms: ['history'],
          }),
        ],
      );

      expect(decision.decision).toBe('AMBIGUOUS');
      expect(decision.evidence.decisiveEvidence).toBe(
        'EXACT_COMPOSITION_IDENTITY_UNCONFIRMED',
      );
    });

    it('a 5-of-4 role-aware overlap with near-identical names and text is never SAME (no textual SAME branch)', () => {
      // The removed `strongConsistentIdentity` branch accepted name >= 0.86,
      // semantic >= 0.72 and role-aware overlap >= 0.8: 4 of 5 members.
      const five: Member[] = [m('A'), m('B'), m('C'), m('D'), m('E')];
      const decision = decideExperienceDedupe(
        fingerprint(undefined, five.slice(0, 4), {
          canonicalName: 'Old San Telmo historic heritage walk tour',
        }),
        [
          fingerprint('five', five, {
            canonicalName: 'Old San Telmo historic heritage walk tour route',
          }),
        ],
      );

      expect(decision.evidence.roleAwareComponentOverlap).toBe(0.8);
      expect(decision.evidence.nameSimilarity).toBeGreaterThanOrEqual(0.86);
      expect(decision.evidence.semanticSimilarity).toBeGreaterThanOrEqual(0.72);
      expect(decision.evidence.structure.relation).toBe('SUBCOMPOSITION');
      expect(decision.decision).not.toBe('SAME');
    });
  });

  describe('PARTIAL_OVERLAP and DISJOINT', () => {
    it('7. spec Case 3: two composites sharing 3 of 4 stops with neither containing the other stay AMBIGUOUS', () => {
      const decision = decideExperienceDedupe(
        fingerprint(
          undefined,
          [m('Dorrego'), m('Mercado'), m('Defensa'), m('Lezama')],
          { canonicalName: 'Southern quarter route', conceptTerms: [] },
        ),
        [
          fingerprint(
            'case-3',
            [m('Dorrego'), m('Mercado'), m('Defensa'), m('Zanjon')],
            { canonicalName: 'Colonial heritage stroll', conceptTerms: [] },
          ),
        ],
      );

      expect(decision.evidence.structure.relation).toBe('PARTIAL_OVERLAP');
      expect(decision.decision).toBe('AMBIGUOUS');
      expect(decision.evidence.decisiveEvidence).toBe(
        'PARTIAL_OVERLAP_IDENTITY_UNRESOLVED',
      );
    });

    it('8. structurally disjoint but textually identical Experiences are NEW', () => {
      const decision = decideExperienceDedupe(
        fingerprint(undefined, [m('A'), m('B')], {
          canonicalName: 'Riverside walk',
        }),
        [
          fingerprint('other', [m('X'), m('Y')], {
            canonicalName: 'Harbor promenade',
          }),
        ],
      );

      expect(decision.evidence.semanticSimilarity).toBeGreaterThanOrEqual(0.58);
      expect(decision.evidence.structure.relation).toBe('DISJOINT');
      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.decisiveEvidence).toBe('STRUCTURALLY_DISJOINT');
    });

    it('C1 counterfactual: spec Case 2 walks sharing one stop and a templated description stay NEW', () => {
      const template = {
        semanticTerms: ['A guided historical walk in San Telmo'],
        conceptTerms: ['history', 'walk'],
      };
      const decision = decideExperienceDedupe(
        fingerprint(
          undefined,
          [m('Mercado'), m('Conventillo'), m('Defensa'), m('Lezama')],
          { canonicalName: 'San Telmo Immigration Walk', ...template },
        ),
        [
          fingerprint(
            'colonial',
            [m('Dorrego'), m('Mercado'), m('Zanjon'), m('Casa Minima')],
            { canonicalName: 'Colonial Architecture Walk', ...template },
          ),
        ],
      );

      expect(decision.evidence.semanticSimilarity).toBeGreaterThanOrEqual(0.58);
      expect(decision.decision).toBe('NEW');
    });
  });

  describe('9. ordering symmetry', () => {
    it('the trait-asymmetric semantic score differs by persistence order, the identity decision does not', () => {
      // Persisted trait rows reach `semanticTerms` on the EXISTING side only
      // (forensic O1/O2), so the lexical score depends on insertion order.
      const traitRows = ['history', 'heritage', 'theme:history'];
      const ab = (traits: string[]) =>
        fingerprint(undefined, completeAB, {
          canonicalName: 'Walk A-B',
          semanticTerms: ['San Telmo walk', ...traits],
        });
      const af = (traits: string[]) =>
        fingerprint(undefined, partialAF, {
          canonicalName: 'Walk A-F',
          semanticTerms: ['San Telmo walk', ...traits],
        });

      const abFirst = decideExperienceDedupe(af([]), [
        { ...ab(traitRows), id: 'ab' },
      ]);
      // Only the A-B Experience carries trait rows; they count only while
      // it is the persisted side.
      const afFirst = decideExperienceDedupe(ab([]), [{ ...af([]), id: 'af' }]);

      expect(abFirst.evidence.semanticSimilarity).not.toBeCloseTo(
        afFirst.evidence.semanticSimilarity,
      );
      expect(abFirst.decision).toBe(afFirst.decision);
      expect(abFirst.decision).toBe('NEW');
      expect(abFirst.evidence.structure.containment).toBe(
        'EXISTING_WITHIN_INCOMING',
      );
      expect(afFirst.evidence.structure.containment).toBe(
        'INCOMING_WITHIN_EXISTING',
      );
    });

    it.each([
      ['exact', completeAB, completeAB],
      ['subcomposition', completeAB, partialAF],
      ['partial overlap', [m('A'), m('B'), m('Q')], [m('A'), m('B'), m('R')]],
      ['disjoint', [m('A'), m('B')], [m('X'), m('Y')]],
    ] as Array<[string, Member[], Member[]]>)(
      '%s: decision and relation are independent of which side is persisted',
      (_label, left, right) => {
        const [forward, backward] = bothOrders(
          fingerprint(undefined, left, {
            canonicalName: 'Morning stroll',
            semanticTerms: ['one'],
          }),
          fingerprint(undefined, right, {
            canonicalName: 'Evening circuit',
            semanticTerms: ['a', 'much', 'longer', 'text'],
          }),
        );

        expect(backward.decision).toBe(forward.decision);
        expect(backward.evidence.structure.relation).toBe(
          forward.evidence.structure.relation,
        );
        expect(backward.evidence.decisiveEvidence).toBe(
          forward.evidence.decisiveEvidence,
        );
      },
    );
  });

  describe('10. unresolved members', () => {
    it('never count as shared structure, even with identical wording', () => {
      const decision = decideExperienceDedupe(
        fingerprint(
          undefined,
          [m('A'), m('B'), [null, 'National Bank'], [null, '']],
          { canonicalName: 'Plaza walk' },
        ),
        [
          fingerprint(
            'other',
            [m('X'), m('Y'), [null, 'National Bank'], [null, '']],
            { canonicalName: 'Riverside loop' },
          ),
        ],
      );

      expect(decision.evidence.structure.relation).toBe('DISJOINT');
      expect(decision.evidence.structure.sharedResolvedGeoEntityIds).toEqual(
        [],
      );
      expect(decision.decision).toBe('NEW');
    });

    it('an unresolved member without wording never matches another one', () => {
      const members: Member[] = [m('A'), m('B'), [null, '']];
      const decision = decideExperienceDedupe(fingerprint(undefined, members), [
        fingerprint('same-shape', members),
      ]);

      expect(decision.evidence.componentOverlap).toBeCloseTo(2 / 3);
      expect(decision.evidence.structure.relation).toBe('PARTIAL_OVERLAP');
      expect(decision.decision).not.toBe('SAME');
    });
  });
});
