import {
  DedupeExperienceFingerprint,
  decideExperienceDedupe,
} from './experience-dedupe.util';

/**
 * D7 (partial composite persistence, 2026-10-08): characterization written
 * BEFORE dedupe learns about unresolved source members.
 *
 * A PARTIAL source composite A-B-C-D-E-F whose only resolved members are A
 * and B is a different Experience from a COMPLETE source composite A-B, even
 * though their resolved GeoEntity sets are identical. The source-defined
 * composition is part of composite identity.
 *
 * These cases pin today's behavior over a fingerprint that carries ONLY the
 * resolved members, which is all the pre-change persistence model can
 * represent. They prove why unresolved members must be persisted and must
 * take part in the dedupe fingerprint: once they are dropped, no dedupe
 * rule can tell the two compositions apart.
 */
describe('decideExperienceDedupe · partial vs complete composites (characterization)', () => {
  const walk = {
    canonicalName: 'San Telmo historic walk',
    conceptTerms: ['history', 'walk'],
    latitude: -34.6212,
    longitude: -58.3731,
    provenance: ['web'],
  };

  const resolvedOnly = (
    id: string | undefined,
    geoEntityIds: string[],
  ): DedupeExperienceFingerprint => ({
    ...(id ? { id } : {}),
    ...walk,
    components: geoEntityIds.map((geoEntityId, index) => ({
      geoEntityId,
      role: 'waypoint',
      order: index + 1,
    })),
  });

  it('CHARACTERIZATION: with unresolved members dropped, PARTIAL A-F (A,B resolved) is indistinguishable from COMPLETE A-B and dedupes SAME', () => {
    // Exactly the resolved-only representation the old persistence model
    // would have written for the PARTIAL composite.
    const decision = decideExperienceDedupe(
      resolvedOnly(undefined, ['A', 'B']),
      [resolvedOnly('partial-a-f', ['A', 'B'])],
    );
    expect(decision.decision).toBe('SAME');
  });

  it('CHARACTERIZATION: with unresolved members dropped, COMPLETE A-B against PARTIAL A-F (A,B,D,F resolved) shares half its members and is AMBIGUOUS, so A-B would not persist', () => {
    const decision = decideExperienceDedupe(
      {
        ...resolvedOnly(undefined, ['A', 'B']),
        canonicalName: 'Walk A-B',
        conceptTerms: [],
      },
      [
        {
          ...resolvedOnly('partial-a-f', ['A', 'B', 'D', 'F']),
          canonicalName: 'Six-stop walk A-F',
          conceptTerms: [],
        },
      ],
    );
    expect(decision.decision).toBe('AMBIGUOUS');
    expect(decision.evidence.componentOverlap).toBe(0.5);
  });

  it('COMPLETE A-B against COMPLETE A-B with the same name is SAME (unchanged complete behavior)', () => {
    const decision = decideExperienceDedupe(
      resolvedOnly(undefined, ['A', 'B']),
      [resolvedOnly('complete-a-b', ['A', 'B'])],
    );
    expect(decision.decision).toBe('SAME');
  });

  it('two COMPLETE composites with disjoint members and unrelated names are NEW (unchanged complete behavior)', () => {
    const decision = decideExperienceDedupe(
      {
        ...resolvedOnly(undefined, ['A', 'B']),
        canonicalName: 'Palermo parks',
        conceptTerms: [],
        provenance: [],
      },
      [
        {
          ...resolvedOnly('other', ['C', 'D']),
          canonicalName: 'Recoleta cemetery tour',
          conceptTerms: [],
          provenance: [],
          latitude: -34.5875,
          longitude: -58.3935,
        },
      ],
    );
    expect(decision.decision).toBe('NEW');
  });
});

/**
 * D7 regression, after source members became part of the fingerprint.
 * Unresolved members take part through their source wording; they never
 * become a shared `null`.
 */
describe('decideExperienceDedupe · partial vs complete composites (source members)', () => {
  const walk = {
    canonicalName: 'San Telmo historic walk',
    conceptTerms: ['history', 'walk'],
    latitude: -34.6212,
    longitude: -58.3731,
    provenance: ['web'],
  };
  type Member = [geoEntityId: string | null, sourceName: string];
  const fingerprint = (
    id: string | undefined,
    members: Member[],
    overrides: Partial<DedupeExperienceFingerprint> = {},
  ): DedupeExperienceFingerprint => ({
    ...(id ? { id } : {}),
    ...walk,
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
  const partialAF: Member[] = [
    ['A', 'Stop A'],
    ['B', 'Stop B'],
    [null, 'Stop C'],
    [null, 'Stop D'],
    [null, 'Stop E'],
    [null, 'Stop F'],
  ];
  const completeAB: Member[] = [
    ['A', 'Stop A'],
    ['B', 'Stop B'],
  ];

  it('PARTIAL A-F (A,B resolved) is never SAME as COMPLETE A-B, in either direction, even with identical name and concept', () => {
    const forward = decideExperienceDedupe(fingerprint(undefined, completeAB), [
      fingerprint('partial-a-f', partialAF),
    ]);
    const backward = decideExperienceDedupe(fingerprint(undefined, partialAF), [
      fingerprint('complete-a-b', completeAB),
    ]);
    for (const decision of [forward, backward]) {
      expect(decision.decision).not.toBe('SAME');
      expect(decision.evidence.componentOverlap).toBeCloseTo(2 / 6);
    }
    // The identical name alone keeps it an open identity question.
    expect(forward.decision).toBe('AMBIGUOUS');
  });

  it('COMPLETE A-B after PARTIAL A-F (A,B,D,F resolved) with unrelated names is NEW: the later A-B still persists', () => {
    const decision = decideExperienceDedupe(
      fingerprint(undefined, completeAB, {
        canonicalName: 'Walk A-B',
        conceptTerms: [],
      }),
      [
        fingerprint(
          'partial-a-f',
          [
            ['A', 'Stop A'],
            ['B', 'Stop B'],
            [null, 'Stop C'],
            ['D', 'Stop D'],
            [null, 'Stop E'],
            ['F', 'Stop F'],
          ],
          { canonicalName: 'Six-stop walk A-F', conceptTerms: [] },
        ),
      ],
    );
    expect(decision.decision).toBe('NEW');
    expect(decision.evidence.componentOverlap).toBeCloseTo(2 / 6);
  });

  it('two unrelated PARTIAL composites never overlap through their unresolved members', () => {
    const decision = decideExperienceDedupe(
      fingerprint(
        undefined,
        [
          ['A', 'Stop A'],
          ['B', 'Stop B'],
          [null, 'National Bank'],
        ],
        { canonicalName: 'Plaza de Mayo walk', conceptTerms: [] },
      ),
      [
        fingerprint(
          'other-partial',
          [
            ['X', 'Stop X'],
            ['Y', 'Stop Y'],
            [null, 'Old Mill'],
          ],
          {
            canonicalName: 'Riverside loop',
            conceptTerms: [],
            latitude: -34.55,
            longitude: -58.45,
          },
        ),
      ],
    );
    expect(decision.evidence.componentOverlap).toBe(0);
    expect(decision.evidence.reasons).not.toContain('shared_geo_entities');
    expect(decision.decision).toBe('NEW');
  });

  it('the same PARTIAL source composition seen twice is SAME (unresolved members match by source wording)', () => {
    const decision = decideExperienceDedupe(fingerprint(undefined, partialAF), [
      fingerprint('partial-a-f', partialAF),
    ]);
    expect(decision.decision).toBe('SAME');
    expect(decision.evidence.componentOverlap).toBe(1);
  });

  it('a standalone Experience on A is compared as standalone-vs-composite against PARTIAL A-F (distinct resolved count, not row count)', () => {
    const decision = decideExperienceDedupe(
      fingerprint(undefined, [['A', 'Stop A']], {
        canonicalName: 'Stop A',
        conceptTerms: [],
      }),
      [fingerprint('partial-a-f', partialAF, { conceptTerms: [] })],
    );
    expect(decision.evidence.reasons).toContain(
      'standalone_composite_shared_membership',
    );
    expect(decision.decision).toBe('NEW');
  });
});
