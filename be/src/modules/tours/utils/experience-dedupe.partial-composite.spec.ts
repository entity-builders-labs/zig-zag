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
