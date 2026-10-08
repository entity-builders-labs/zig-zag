import {
  DedupeComponentFingerprint,
  DedupeExperienceFingerprint,
  StructuralCompositionRelation,
  compareFingerprints,
  decideExperienceDedupe,
  sourceCompositionIdentity,
} from './experience-dedupe.util';

/**
 * SOURCE MEMBER IDENTITY (2026-10-08, before C3).
 *
 * A source member is identified by its source definition (`sourcePosition`
 * inside its Experience + `sourceName` wording), never by its resolution
 * state. Resolving, confirming or revoking a member changes knowledge about
 * it, not the source-defined composition of the Experience (identity spec
 * hard invariant 15). Resolved GeoEntities are supporting evidence that can
 * link differently worded members; they never replace a member's identity.
 */
describe('decideExperienceDedupe · source member identity', () => {
  type Letter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

  /**
   * A source composition over `letters`, in source order. `resolved` lists
   * the members currently resolved (to GeoEntity `geo-<letter>`); every
   * other member is UNRESOLVED with its source wording only.
   */
  const composition = (
    letters: readonly Letter[],
    resolved: readonly Letter[],
    overrides: Partial<DedupeExperienceFingerprint> = {},
  ): DedupeExperienceFingerprint => ({
    canonicalName: `Walk ${letters.join('-')}`,
    semanticTerms: ['An evidenced old town walk', 'history', 'walk'],
    conceptTerms: ['history', 'walk'],
    latitude: null,
    longitude: null,
    provenance: ['web'],
    components: letters.map(
      (letter, sourcePosition): DedupeComponentFingerprint =>
        resolved.includes(letter)
          ? {
              geoEntityId: `geo-${letter}`,
              sourceName: `Stop ${letter}`,
              sourcePosition,
              role: 'waypoint',
              order: null,
            }
          : {
              geoEntityId: null,
              resolutionState: 'UNRESOLVED' as const,
              sourceName: `Stop ${letter}`,
              sourcePosition,
              role: 'waypoint',
              order: null,
            },
    ),
    ...overrides,
  });

  const relation = (
    left: DedupeExperienceFingerprint,
    right: DedupeExperienceFingerprint,
  ): StructuralCompositionRelation =>
    compareFingerprints(left, right).structure.relation;

  /** The relation in both comparison directions. */
  const relations = (
    left: DedupeExperienceFingerprint,
    right: DedupeExperienceFingerprint,
  ) => [relation(left, right), relation(right, left)];

  /** Every subset of `letters` (resolution states of a composition). */
  const subsets = (letters: readonly Letter[]): Letter[][] =>
    letters.reduce<Letter[][]>(
      (all, letter) => [...all, ...all.map((subset) => [...subset, letter])],
      [[]],
    );

  const ABCD = ['A', 'B', 'C', 'D'] as const;

  describe('Case 1: the same source composition, PARTIAL vs COMPLETE', () => {
    const partial = composition(ABCD, ['A', 'B']);
    const complete = composition(ABCD, ABCD);

    it('1. PARTIAL vs COMPLETE is EXACT_COMPOSITION and dedupes SAME', () => {
      const decision = decideExperienceDedupe(partial, [
        { ...complete, id: 'complete' },
      ]);

      expect(decision.evidence.structure.relation).toBe('EXACT_COMPOSITION');
      expect(decision).toMatchObject({
        decision: 'SAME',
        canonicalExperienceId: 'complete',
      });
      expect(decision.evidence.decisiveEvidence).toBe(
        'EXACT_COMPOSITION_IDENTITY_CONFIRMED',
      );
    });

    it('2. COMPLETE vs PARTIAL (reverse direction) is EXACT_COMPOSITION and dedupes SAME', () => {
      const decision = decideExperienceDedupe(complete, [
        { ...partial, id: 'partial' },
      ]);

      expect(decision.evidence.structure.relation).toBe('EXACT_COMPOSITION');
      expect(decision).toMatchObject({
        decision: 'SAME',
        canonicalExperienceId: 'partial',
      });
    });

    it('stays EXACT for every pair of resolution states of the same source, even with no GeoEntity resolved on both sides', () => {
      // {A,B} vs {C,D}: not one shared resolved GeoEntity, still one source.
      expect(
        relations(composition(ABCD, ['A', 'B']), composition(ABCD, ['C', 'D'])),
      ).toEqual(['EXACT_COMPOSITION', 'EXACT_COMPOSITION']);

      for (const left of subsets(ABCD).filter((s) => s.length)) {
        for (const right of subsets(ABCD)) {
          expect(
            relations(composition(ABCD, left), composition(ABCD, right)),
          ).toEqual(['EXACT_COMPOSITION', 'EXACT_COMPOSITION']);
        }
      }
    });

    it('trace: the relation is derived from source members (by position); shared GeoEntities are separate supporting evidence', () => {
      const { structure } = compareFingerprints(partial, complete);

      expect(structure.sharedSourceMembers).toEqual([
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
        {
          incomingSourcePositions: [2],
          existingSourcePositions: [2],
          basis: ['SOURCE_WORDING'],
        },
        {
          incomingSourcePositions: [3],
          existingSourcePositions: [3],
          basis: ['SOURCE_WORDING'],
        },
      ]);
      expect(structure.sharedResolvedGeoEntityIds).toEqual(['geo-A', 'geo-B']);
      // A GeoEntity id is never emitted as a source member identity.
      expect(JSON.stringify(structure.sharedSourceMembers)).not.toContain(
        'geo-',
      );
    });
  });

  describe('enrichment invariant (hard invariant 15)', () => {
    const reference = {
      subcomposition: composition(['A', 'B'], ['A', 'B']),
      /** Over the members that enrichment resolves. */
      enrichedTail: composition(['C', 'D'], ['C', 'D']),
      overlap: composition(['B', 'C', 'D', 'E'], ['B', 'C', 'D', 'E']),
      disjoint: composition(['E', 'F'], ['E', 'F']),
    };
    const fingerprintOf = (experience: DedupeExperienceFingerprint) => ({
      identity: sourceCompositionIdentity(experience),
      subcomposition: relations(experience, reference.subcomposition),
      enrichedTail: relations(experience, reference.enrichedTail),
      overlap: relations(experience, reference.overlap),
      disjoint: relations(experience, reference.disjoint),
    });

    it('3. PARTIAL -> COMPLETE enrichment changes neither the source composition identity nor any structural relation', () => {
      const partial = composition(ABCD, ['A', 'B']);
      const enriched = composition(ABCD, ABCD);

      expect(fingerprintOf(enriched)).toEqual(fingerprintOf(partial));
      expect(relations(partial, enriched)).toEqual([
        'EXACT_COMPOSITION',
        'EXACT_COMPOSITION',
      ]);
      expect(fingerprintOf(partial).enrichedTail).toEqual([
        'SUBCOMPOSITION',
        'SUBCOMPOSITION',
      ]);
      expect(sourceCompositionIdentity(partial)).toEqual([
        { sourcePosition: 0, sourceWording: 'stop a' },
        { sourcePosition: 1, sourceWording: 'stop b' },
        { sourcePosition: 2, sourceWording: 'stop c' },
        { sourcePosition: 3, sourceWording: 'stop d' },
      ]);
      expect(fingerprintOf(partial).subcomposition).toEqual([
        'SUBCOMPOSITION',
        'SUBCOMPOSITION',
      ]);
      expect(fingerprintOf(partial).overlap).toEqual([
        'PARTIAL_OVERLAP',
        'PARTIAL_OVERLAP',
      ]);
      expect(fingerprintOf(partial).disjoint).toEqual(['DISJOINT', 'DISJOINT']);
    });

    it('4. COMPLETE -> PARTIAL (admin revoke) changes neither the source composition identity nor any structural relation', () => {
      const complete = composition(ABCD, ABCD);
      const revokedC = composition(ABCD, ['A', 'B', 'D']);
      const revokedAB = composition(ABCD, ['C', 'D']);

      expect(fingerprintOf(revokedC)).toEqual(fingerprintOf(complete));
      expect(fingerprintOf(revokedAB)).toEqual(fingerprintOf(complete));
    });

    it('National Bank: PARTIAL -> ADMIN CONFIRM Banco Nacion -> COMPLETE -> ADMIN REVOKE -> PARTIAL keeps one source composition', () => {
      const walk = (nationalBank: string | null) =>
        ({
          canonicalName: 'Plaza de Mayo historic walk',
          conceptTerms: ['history', 'walk'],
          components: [
            ['Plaza de Mayo', 'geo-plaza-de-mayo'],
            ['Cabildo', 'geo-cabildo'],
            ['National Bank', nationalBank],
            ['Casa Rosada', 'geo-casa-rosada'],
          ].map(([sourceName, geoEntityId], sourcePosition) => ({
            geoEntityId,
            ...(geoEntityId ? {} : { resolutionState: 'UNRESOLVED' as const }),
            sourceName,
            sourcePosition,
            role: 'waypoint',
            order: sourcePosition + 1,
          })),
        }) as DedupeExperienceFingerprint;
      const partial = walk(null);
      const confirmed = walk('geo-banco-nacion');
      const revoked = walk(null);
      const plazaAndCabildo: DedupeExperienceFingerprint = {
        ...walk(null),
        canonicalName: 'Plaza de Mayo and Cabildo',
        components: walk(null).components.slice(0, 2),
      };

      for (const state of [confirmed, revoked]) {
        expect(sourceCompositionIdentity(state)).toEqual(
          sourceCompositionIdentity(partial),
        );
        expect(relations(state, partial)).toEqual([
          'EXACT_COMPOSITION',
          'EXACT_COMPOSITION',
        ]);
        expect(relations(state, plazaAndCabildo)).toEqual(
          relations(partial, plazaAndCabildo),
        );
      }
      expect(relations(partial, plazaAndCabildo)).toEqual([
        'SUBCOMPOSITION',
        'SUBCOMPOSITION',
      ]);
    });

    it('resolution may ADD a link between differently worded members: new GeoEntity evidence, not a new member identity', () => {
      const walk = (bank: string, geoEntityId: string | null) =>
        ({
          canonicalName: `Walk with ${bank}`,
          components: [
            ['Plaza de Mayo', 'geo-plaza-de-mayo'],
            ['Cabildo', 'geo-cabildo'],
            [bank, geoEntityId],
          ].map(([sourceName, id], sourcePosition) => ({
            geoEntityId: id,
            ...(id ? {} : { resolutionState: 'UNRESOLVED' as const }),
            sourceName,
            sourcePosition,
            role: 'waypoint',
          })),
        }) as DedupeExperienceFingerprint;
      const english = walk('National Bank', null);
      const spanish = walk('Banco de la Nacion', 'geo-banco-nacion');

      // Different wording, one side unresolved: no established correspondence.
      expect(relations(english, spanish)).toEqual([
        'PARTIAL_OVERLAP',
        'PARTIAL_OVERLAP',
      ]);
      // Admin confirm resolves "National Bank" to the same GeoEntity.
      const confirmed = walk('National Bank', 'geo-banco-nacion');
      expect(relations(confirmed, spanish)).toEqual([
        'EXACT_COMPOSITION',
        'EXACT_COMPOSITION',
      ]);
      const [, , bank] = compareFingerprints(confirmed, spanish).structure
        .sharedSourceMembers;
      expect(bank).toEqual({
        incomingSourcePositions: [2],
        existingSourcePositions: [2],
        basis: ['RESOLVED_GEOENTITY'],
      });
      // The members' own source identity did not change.
      expect(sourceCompositionIdentity(confirmed)).toEqual(
        sourceCompositionIdentity(english),
      );
    });
  });

  describe('relations independent of resolution state', () => {
    /** Every pair of resolution states in which some shared member is resolved. */
    const groundedPairs = (
      left: readonly Letter[],
      right: readonly Letter[],
    ) => {
      const shared = left.filter((letter) => right.includes(letter));
      return subsets(left).flatMap((leftResolved) =>
        subsets(right)
          .filter((rightResolved) =>
            shared.some(
              (letter) =>
                leftResolved.includes(letter) || rightResolved.includes(letter),
            ),
          )
          .map(
            (rightResolved) =>
              [
                composition(left, leftResolved),
                composition(right, rightResolved),
              ] as const,
          ),
      );
    };

    it('5. A-B vs A-B-C-D is SUBCOMPOSITION in every resolution state (and coexists NEW)', () => {
      const pairs = groundedPairs(['A', 'B'], ABCD);
      expect(pairs).toHaveLength(4 * 16 - 4);
      for (const [ab, abcd] of pairs) {
        expect(relations(ab, abcd)).toEqual([
          'SUBCOMPOSITION',
          'SUBCOMPOSITION',
        ]);
        expect(compareFingerprints(ab, abcd).structure.containment).toBe(
          'INCOMING_WITHIN_EXISTING',
        );
        expect(
          decideExperienceDedupe(ab, [{ ...abcd, id: 'abcd' }]).decision,
        ).toBe('NEW');
      }
    });

    it('6. A-B-C vs B-C-D is PARTIAL_OVERLAP in every resolution state where the shared members are grounded', () => {
      const pairs = groundedPairs(['A', 'B', 'C'], ['B', 'C', 'D']);
      expect(pairs.length).toBeGreaterThan(0);
      for (const [abc, bcd] of pairs) {
        expect(relations(abc, bcd)).toEqual([
          'PARTIAL_OVERLAP',
          'PARTIAL_OVERLAP',
        ]);
      }
    });

    it('Case 4: A-B vs C-D is DISJOINT in every resolution state', () => {
      for (const left of subsets(['A', 'B'])) {
        for (const right of subsets(['C', 'D'])) {
          expect(
            relations(
              composition(['A', 'B'], left),
              composition(['C', 'D'], right),
            ),
          ).toEqual(['DISJOINT', 'DISJOINT']);
        }
      }
    });
  });

  describe('7. unresolved members never become fake shared structure', () => {
    const unresolved = (
      sourceName: string | null,
      sourcePosition: number,
    ): DedupeComponentFingerprint => ({
      geoEntityId: null,
      resolutionState: 'UNRESOLVED' as const,
      sourceName,
      sourcePosition,
      role: 'waypoint',
    });

    it('members without wording share nothing, on either side', () => {
      const left = composition(['A', 'B'], ['A', 'B']);
      const right = composition(['E', 'F'], ['E', 'F']);
      left.components.push(unresolved(null, 2), unresolved('  ', 3));
      right.components.push(unresolved(null, 2), unresolved('', 3));

      const { structure } = compareFingerprints(left, right);
      expect(structure.relation).toBe('DISJOINT');
      expect(structure.sharedSourceMembers).toEqual([]);
    });

    it('identical wording unresolved on both sides is not shared structure', () => {
      const left = composition(['A', 'B', 'C'], ['A', 'B']);
      const right = composition(['E', 'F', 'C'], ['E', 'F']);

      const { structure } = compareFingerprints(left, right);
      expect(structure.relation).toBe('DISJOINT');
      expect(structure.sharedResolvedGeoEntityIds).toEqual([]);
    });

    it('a wording that resolves to two different GeoEntities is no member identity ("Plaza Mayor" in two cities)', () => {
      const plazaMayor = (geoEntityId: string | null, city: string) =>
        ({
          canonicalName: `${city} old town walk`,
          components: [
            {
              geoEntityId,
              ...(geoEntityId
                ? {}
                : { resolutionState: 'UNRESOLVED' as const }),
              sourceName: 'Plaza Mayor',
              sourcePosition: 0,
              role: 'waypoint',
            },
            {
              geoEntityId: `geo-${city}-cathedral`,
              sourceName: `${city} Cathedral`,
              sourcePosition: 1,
              role: 'waypoint',
            },
          ],
        }) as DedupeExperienceFingerprint;

      expect(
        relations(
          plazaMayor('geo-madrid-plaza', 'madrid'),
          plazaMayor('geo-salamanca-plaza', 'salamanca'),
        ),
      ).toEqual(['DISJOINT', 'DISJOINT']);

      // A third member with the same wording does not bridge two places.
      const madrid = plazaMayor('geo-madrid-plaza', 'madrid');
      madrid.components.push({
        geoEntityId: 'geo-salamanca-plaza',
        sourceName: 'Plaza Mayor',
        sourcePosition: 2,
        role: 'waypoint',
      });
      const unresolvedPlaza = plazaMayor(null, 'toledo');
      expect(
        compareFingerprints(madrid, unresolvedPlaza).structure
          .sharedSourceMembers,
      ).toEqual([]);
    });
  });

  describe('8. sourcePosition is source membership, never visiting order', () => {
    it('the same members at different source positions still correspond, with no order conflict', () => {
      const forward = composition(ABCD, ['A', 'B']);
      const reversed = composition([...ABCD].reverse(), ['C', 'D']);

      const evidence = compareFingerprints(forward, reversed);
      expect(evidence.structure.relation).toBe('EXACT_COMPOSITION');
      expect(evidence.orderConflict).toBe(false);
      expect(
        decideExperienceDedupe(forward, [{ ...reversed, id: 'reversed' }])
          .decision,
      ).toBe('SAME');
    });

    it('a conflicting EVIDENCED order still conflicts, including on members resolved on one side only', () => {
      const withOrder = (
        letters: readonly Letter[],
        resolved: readonly Letter[],
      ) => {
        const fingerprint = composition(ABCD, resolved);
        fingerprint.components.forEach((member) => {
          member.order = letters.indexOf(
            member.sourceName!.slice(-1) as Letter,
          );
        });
        return fingerprint;
      };
      const evidence = compareFingerprints(
        withOrder(['A', 'B', 'C', 'D'], ['A', 'B']),
        withOrder(['D', 'C', 'B', 'A'], ['C', 'D']),
      );

      expect(evidence.orderConflict).toBe(true);
      expect(evidence.structure.relation).toBe('EXACT_COMPOSITION');
      expect(
        decideExperienceDedupe(withOrder(['A', 'B', 'C', 'D'], ['A', 'B']), [
          { ...withOrder(['D', 'C', 'B', 'A'], ['C', 'D']), id: 'reversed' },
        ]).decision,
      ).toBe('AMBIGUOUS');
    });
  });

  describe('9. A-F vs A-B under the accepted structural-authority policy', () => {
    const AF = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

    it.each([
      ['PARTIAL A-F (C,E unresolved)', ['A', 'B', 'D', 'F'] as Letter[]],
      ['PARTIAL A-F (only A,B resolved)', ['A', 'B'] as Letter[]],
      ['PARTIAL A-F (A,B unresolved)', ['C', 'D', 'E', 'F'] as Letter[]],
      ['COMPLETE A-F (enriched)', [...AF]],
    ])('%s vs later COMPLETE A-B: NOT SAME, NEW', (_label, resolved) => {
      const existing = { ...composition(AF, resolved), id: 'a-f' };
      const decision = decideExperienceDedupe(
        composition(['A', 'B'], ['A', 'B']),
        [existing],
      );

      expect(decision.decision).toBe('NEW');
      expect(decision.evidence.structure).toMatchObject({
        relation: 'SUBCOMPOSITION',
        containment: 'INCOMING_WITHIN_EXISTING',
      });
    });
  });
});
