import {
  DedupeExperienceFingerprint,
  decideExperienceDedupe,
} from './experience-dedupe.util';
import {
  CanonicalSourceMemberState,
  IncomingSourceMemberObservation,
  reconcileSameSourceComposition,
} from './source-knowledge-reconciliation.policy';

/**
 * UNION OF KNOWLEDGE, never UNION OF EXPERIENCES: a later observation of
 * the SAME source composition may resolve canonical members that were
 * unresolved; it never adds, removes, renumbers or downgrades a member, and
 * a conflicting resolution fails closed. The structural relation and member
 * correspondence always come from the canonical dedupe authority
 * (`decideExperienceDedupe`), never from hand-built fixtures.
 */
describe('reconcileSameSourceComposition', () => {
  type Member = { name: string; geo: string | null };
  const WALK = 'Self Guided Walking Tour San Telmo';

  const canonicalState = (
    members: Member[],
    overrides: Partial<CanonicalSourceMemberState>[] = [],
  ): CanonicalSourceMemberState[] =>
    members.map((member, sourcePosition) => ({
      sourcePosition,
      sourceName: member.name,
      resolutionState: member.geo ? 'RESOLVED' : 'UNRESOLVED',
      geoEntityId: member.geo,
      resolutionReason: member.geo ? null : 'NO_CANDIDATE_ACQUIRED',
      ...(overrides[sourcePosition] ?? {}),
    }));

  const observation = (members: Member[]): IncomingSourceMemberObservation[] =>
    members.map((member, sourcePosition) => ({
      sourcePosition,
      sourceName: member.name,
      geoEntityId: member.geo,
    }));

  const fingerprint = (
    members: Member[],
    canonicalName = WALK,
    id?: string,
  ): DedupeExperienceFingerprint => ({
    ...(id ? { id } : {}),
    canonicalName,
    components: members.map((member, sourcePosition) => ({
      geoEntityId: member.geo,
      resolutionState: member.geo
        ? ('RESOLVED' as const)
        : ('UNRESOLVED' as const),
      sourcePosition,
      sourceName: member.name,
      role: 'stop',
      order: null as number | null,
    })),
  });

  const reconcile = (
    canonical: Member[],
    incoming: Member[],
    options: {
      canonicalOverrides?: Partial<CanonicalSourceMemberState>[];
      incomingName?: string;
    } = {},
  ) => {
    const decision = decideExperienceDedupe(
      fingerprint(incoming, options.incomingName ?? WALK),
      [fingerprint(canonical, WALK, 'canonical-1')],
    );
    return {
      decision,
      result: reconcileSameSourceComposition({
        identityDecision: decision.decision,
        structure: decision.evidence.structure,
        canonical: canonicalState(canonical, options.canonicalOverrides),
        incoming: observation(incoming),
      }),
    };
  };

  const A = { name: 'Plaza Dorrego', geo: 'geo-a' };
  const B = { name: 'Casa Minima', geo: 'geo-b' };
  const cUnresolved: Member = { name: 'Teatro Colon', geo: null };
  const cResolved = { name: 'Teatro Colon', geo: 'geo-c' };
  const dUnresolved: Member = { name: 'Obelisco', geo: null };

  it('1. a richer SAME observation resolves a canonical unresolved member', () => {
    const { decision, result } = reconcile(
      [A, B, cUnresolved, dUnresolved],
      [A, B, cResolved, dUnresolved],
    );

    expect(decision.decision).toBe('SAME');
    expect(decision.evidence.structure.relation).toBe('EXACT_COMPOSITION');
    expect(result.outcome).toBe('ENRICHED');
    expect(
      result.members.map((member) => [
        member.sourcePosition,
        member.change,
        member.after.geoEntityId,
      ]),
    ).toEqual([
      [0, 'UNCHANGED', 'geo-a'],
      [1, 'UNCHANGED', 'geo-b'],
      [2, 'RESOLVED_BY_OBSERVATION', 'geo-c'],
      [3, 'UNCHANGED', null],
    ]);
    expect(result.members[2]).toEqual(
      expect.objectContaining({
        before: {
          resolutionState: 'UNRESOLVED',
          geoEntityId: null,
          resolutionReason: 'NO_CANDIDATE_ACQUIRED',
        },
        after: {
          resolutionState: 'RESOLVED',
          geoEntityId: 'geo-c',
          resolutionReason: null,
        },
        observedGeoEntityId: 'geo-c',
        incomingSourcePositions: [2],
      }),
    );
  });

  it('2. a SAME observation with LESS knowledge never downgrades a valid resolution', () => {
    const { decision, result } = reconcile(
      [A, B, cResolved, dUnresolved],
      [A, B, cUnresolved, dUnresolved],
    );

    expect(decision.decision).toBe('SAME');
    expect(result.outcome).toBe('NO_NEW_KNOWLEDGE');
    expect(result.members[2]).toEqual(
      expect.objectContaining({
        change: 'UNCHANGED',
        after: {
          resolutionState: 'RESOLVED',
          geoEntityId: 'geo-c',
          resolutionReason: null,
        },
      }),
    );
  });

  it('3. a conflicting resolution of one member fails closed: nothing is written, the conflict is reported', () => {
    // The dedupe authority itself refuses SAME here (an ambiguous wording is
    // no member identity), so the canonical path never reaches enrichment.
    const { decision } = reconcile(
      [A, B, cResolved, dUnresolved],
      [A, B, { name: 'Teatro Colon', geo: 'geo-other' }, dUnresolved],
    );
    expect(decision.decision).not.toBe('SAME');

    // Defense in depth: even a SAME/EXACT input whose correspondence class
    // carries two GeoEntities never picks one by recency/provider/order.
    const result = reconcileSameSourceComposition({
      identityDecision: 'SAME',
      structure: {
        relation: 'EXACT_COMPOSITION',
        sharedSourceMembers: [0, 1, 2, 3].map((position) => ({
          incomingSourcePositions: [position],
          existingSourcePositions: [position],
          basis: ['SOURCE_WORDING' as const],
        })),
      },
      canonical: canonicalState([A, B, cUnresolved, dUnresolved]),
      incoming: observation([
        A,
        { name: 'Casa Minima', geo: 'geo-b-conflict' },
        cResolved,
        dUnresolved,
      ]),
    });

    expect(result.outcome).toBe('CONFLICT_REJECTED');
    expect(
      result.members.map((member) => [member.sourcePosition, member.change]),
    ).toEqual([
      [0, 'UNCHANGED'],
      [1, 'CONFLICT'],
      [2, 'UNCHANGED'],
      [3, 'UNCHANGED'],
    ]);
    // Member 2 would be new knowledge, but a conflicting observation
    // contributes nothing at all.
    expect(
      result.members.every(
        (member) =>
          JSON.stringify(member.after) === JSON.stringify(member.before),
      ),
    ).toBe(true);
    expect(result.members[1].observedGeoEntityId).toBe('geo-b-conflict');
  });

  it('4. SUBCOMPOSITION (A-B vs A-B-C-D) never unions source-member knowledge', () => {
    const { decision, result } = reconcile(
      [A, B, cUnresolved, dUnresolved],
      [A, B],
      { incomingName: 'Plaza Dorrego and Casa Minima' },
    );

    expect(decision.evidence.structure.relation).toBe('SUBCOMPOSITION');
    expect(result).toEqual({
      outcome: 'NOT_ELIGIBLE',
      reason: 'NOT_SAME_EXACT_COMPOSITION',
      members: [],
    });
  });

  it('4b. even a forced SAME decision over a SUBCOMPOSITION relation is not eligible', () => {
    const result = reconcileSameSourceComposition({
      identityDecision: 'SAME',
      structure: { relation: 'SUBCOMPOSITION', sharedSourceMembers: [] },
      canonical: canonicalState([A, B, cUnresolved]),
      incoming: observation([A, B]),
    });
    expect(result.outcome).toBe('NOT_ELIGIBLE');
  });

  it('5. PARTIAL_OVERLAP never unions source-member knowledge', () => {
    const E = { name: 'Parque Lezama', geo: 'geo-e' };
    const { decision, result } = reconcile(
      [A, B, cUnresolved, dUnresolved],
      [A, B, cResolved, E],
    );

    expect(decision.evidence.structure.relation).toBe('PARTIAL_OVERLAP');
    expect(result.outcome).toBe('NOT_ELIGIBLE');
    expect(result.members).toEqual([]);
  });

  it('14. enrichment never changes source-member identity (position, wording) or member count', () => {
    const canonical = [A, B, cUnresolved, dUnresolved];
    const { result } = reconcile(canonical, [A, B, cResolved, dUnresolved]);

    expect(
      result.members.map((member) => [
        member.sourcePosition,
        member.sourceName,
      ]),
    ).toEqual(canonical.map((member, position) => [position, member.name]));
  });

  it('an admin-revoked member is not re-learned by an automatic observation', () => {
    const { result } = reconcile(
      [A, B, cUnresolved, dUnresolved],
      [A, B, cResolved, dUnresolved],
      {
        canonicalOverrides: [
          {},
          {},
          { resolutionReason: 'RESOLUTION_REVOKED' },
        ],
      },
    );

    expect(result.outcome).toBe('NO_NEW_KNOWLEDGE');
    expect(result.members[2]).toEqual(
      expect.objectContaining({
        change: 'ADMIN_REVOKED_NOT_RELEARNED',
        after: expect.objectContaining({ resolutionState: 'UNRESOLVED' }),
        observedGeoEntityId: 'geo-c',
      }),
    );
  });

  it('two canonical members linked by a shared GeoEntity resolve together and stay two members', () => {
    const caminito: Member = { name: 'Caminito', geo: null };
    const caminitoStreet = { name: 'Caminito Street', geo: 'geo-cam' };
    const { decision, result } = reconcile(
      [A, B, caminito, caminitoStreet],
      [A, B, { name: 'Caminito', geo: 'geo-cam' }, caminitoStreet],
    );

    expect(decision.decision).toBe('SAME');
    expect(result.outcome).toBe('ENRICHED');
    expect(result.members.map((member) => member.after.geoEntityId)).toEqual([
      'geo-a',
      'geo-b',
      'geo-cam',
      'geo-cam',
    ]);
  });

  it('a legacy canonical member without a source position is not eligible (no fabricated identity)', () => {
    const result = reconcileSameSourceComposition({
      identityDecision: 'SAME',
      structure: {
        relation: 'EXACT_COMPOSITION',
        sharedSourceMembers: [
          {
            incomingSourcePositions: [0],
            existingSourcePositions: [null],
            basis: ['RESOLVED_GEOENTITY'],
          },
        ],
      },
      canonical: [
        {
          sourcePosition: null,
          sourceName: null,
          resolutionState: 'RESOLVED',
          geoEntityId: 'geo-a',
          resolutionReason: null,
        },
      ],
      incoming: observation([A]),
    });

    expect(result).toEqual({
      outcome: 'NOT_ELIGIBLE',
      reason: 'LEGACY_MEMBER_WITHOUT_SOURCE_POSITION',
      members: [],
    });
  });

  it('is independent of which observation was persisted first (order invariance)', () => {
    const richer = [A, B, cResolved, dUnresolved];
    const poorer = [A, B, cUnresolved, dUnresolved];

    // poorer canonical + richer observation, and richer canonical + poorer
    // observation, converge on the same canonical knowledge.
    const enriched = reconcile(poorer, richer).result.members.map(
      (member) => member.after,
    );
    const kept = reconcile(richer, poorer).result.members.map(
      (member) => member.after,
    );
    expect(enriched).toEqual(kept);
  });
});
