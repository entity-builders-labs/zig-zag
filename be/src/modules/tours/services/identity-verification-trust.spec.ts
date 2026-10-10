import {
  EntityCandidate,
  IdentityEvidence,
  NameCorrespondence,
  ResolutionAttempt,
} from '../interfaces/experience-resolution.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { buildLocalIdentityEvidence } from '../utils/identity-evidence-builder.util';
import { identityEvidenceRole } from '../utils/identity-evidence-role.policy';
import {
  hintCandidateCorrespondence,
  nameCorrespondence,
} from '../utils/identity-name-correspondence.util';
import { IdentityEvidenceCollector } from './identity-evidence-collector.service';
import { IdentityVerifier } from './identity-verifier.service';

/**
 * RW4-ID-FALSE-VERIFY-1 (C3 retry, 2026-10-07): "Don Carlos" (a La Boca
 * venue) was VERIFIED as the tomb of Carlos Pellegrini. The chain was fuzzy
 * retrieval ("Don" is under the 4-letter floor, so "carlos" matched), the
 * candidate's own QID, then a fuzzy hint-to-label match, decided by the QID
 * rule ahead of a known material competitor.
 *
 * Rule under test: lexical similarity may retrieve candidates, never prove
 * identity. A QID side linked only by OVERLAP decides nothing, and a QID
 * link never skips a known material competitor.
 */
const verifier = new IdentityVerifier();

const competitors = (
  outcome:
    | 'MATERIAL_COMPETITOR_KNOWN'
    | 'NO_MATERIAL_COMPETITOR'
    | 'NO_COMPETITOR_OBSERVED',
  competitorCount = outcome === 'MATERIAL_COMPETITOR_KNOWN' ? 1 : 0,
): IdentityEvidence => ({
  type: 'COMPETITOR_EXAMINATION',
  outcome,
  examinedStrategies: ['LOCAL_OSM_POOL'],
  competitorCount,
});
const bounded: IdentityEvidence = {
  type: 'GEOGRAPHIC_CORRESPONDENCE',
  basis: 'BOUNDED_ADMISSION_SCOPE',
};

const candidateNamed = (
  canonicalName: string,
  extra: Partial<EntityCandidate> = {},
): EntityCandidate =>
  ({
    provider: 'openstreetmap',
    externalId: 'osm:node:1',
    canonicalName,
    kind: 'PLACE',
    latitude: -10,
    longitude: -20,
    nameEvidenceMultiplicity: {
      exactName: 'UNKNOWN',
      declaredAlias: 'UNKNOWN',
    },
    ...extra,
  }) as EntityCandidate;

const wikidataWith = (
  summaries: Record<string, { label: string; aliases?: string[] }>,
  nearby: Array<{ label: string }> = [],
) => ({
  getEntitySummaries: jest.fn(async (qids: string[]) => {
    const map = new Map();
    for (const qid of qids) if (summaries[qid]) map.set(qid, summaries[qid]);
    return map;
  }),
  findNearbyPlaces: jest.fn().mockResolvedValue(nearby),
});

/** The production chain: local facts, then Wikidata facts, then policy. */
async function decideThroughChain(input: {
  hint: string;
  candidate: EntityCandidate;
  wikidata: ReturnType<typeof wikidataWith>;
  qualifiers?: IdentityEvidence[];
  observations?: SourceObservation[];
}) {
  const hint = { name: input.hint, evidenceKeys: ['ev-1'] };
  const evidence = [
    ...buildLocalIdentityEvidence(hint, input.candidate, input.observations),
    ...(input.qualifiers ?? []),
    ...(await new IdentityEvidenceCollector(input.wikidata as any).collect(
      hint,
      input.candidate,
      input.observations,
    )),
  ];
  const attempt: ResolutionAttempt = {
    strategy: 'LOCAL_OSM_POOL',
    candidate: input.candidate,
    evidence,
  };
  return { verdict: verifier.decide(hint, attempt), evidence };
}

describe('identity verification trust (RW4-ID-FALSE-VERIFY-1)', () => {
  describe('9. name correspondence is graded for verification (short tokens count)', () => {
    it.each([
      // The C3 pair, and a neutral pair with the same shape: a short
      // modifier that retrieval ignores but that changes the name.
      ['Don Carlos', 'Carlos Pellegrini', 'OVERLAP'],
      ['Al Kestrel', 'Kestrel Hollowmere', 'OVERLAP'],
      ['Don Carlos', 'Carlos', 'OVERLAP'],
      ['Plaza de Mayo', 'plaza  de MAYO', 'EQUIVALENT'],
      ['Museo Histórico', 'Museo Historico', 'EQUIVALENT'],
      ['Mayo Plaza', 'Plaza Mayo', 'EQUIVALENT'],
      ['Don Carlos', 'Las Heras', 'NONE'],
    ] as const)('%s vs %s is %s', (name, other, expected) => {
      expect(nameCorrespondence(name, other)).toBe(expected);
    });
  });

  describe('1. the C3 chain no longer verifies', () => {
    it('Don Carlos -> Carlos Pellegrini (own QID, alias and label only overlap) is not VERIFIED', async () => {
      const { verdict, evidence } = await decideThroughChain({
        hint: 'Don Carlos',
        candidate: candidateNamed('Carlos Pellegrini', {
          wikidataQid: 'Q270446',
          nameAliasCandidates: ['Carlos Pellegrini'],
          nameEvidenceMultiplicity: {
            exactName: 'UNKNOWN',
            declaredAlias: 'MULTIPLE',
          },
        }),
        wikidata: wikidataWith({ Q270446: { label: 'Carlos Pellegrini' } }),
        qualifiers: [competitors('MATERIAL_COMPETITOR_KNOWN', 11), bounded],
      });

      expect(evidence).toContainEqual({
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'OWN_QID',
        hintCorrespondence: 'OVERLAP',
        candidateCorrespondence: 'DECLARES_QID',
      });
      expect(verdict).toMatchObject({
        status: 'AMBIGUOUS',
        rule: 'MATERIAL_COMPETITOR_KNOWN',
      });
    });

    it('stays unverified even with no competitor known and a grounded geography', async () => {
      const { verdict } = await decideThroughChain({
        hint: 'Don Carlos',
        candidate: candidateNamed('Carlos Pellegrini', {
          wikidataQid: 'Q270446',
          nameAliasCandidates: ['Carlos Pellegrini'],
          nameEvidenceMultiplicity: {
            exactName: 'UNKNOWN',
            declaredAlias: 'SINGLE',
          },
        }),
        wikidata: wikidataWith({ Q270446: { label: 'Carlos Pellegrini' } }),
        qualifiers: [competitors('NO_MATERIAL_COMPETITOR'), bounded],
      });

      expect(verdict.status).not.toBe('VERIFIED');
    });
  });

  it('2. a valid own QID does not bootstrap a fuzzy hint into identity', async () => {
    const { verdict } = await decideThroughChain({
      hint: 'El Kestrel',
      candidate: candidateNamed('Kestrel Hollowmere', {
        wikidataQid: 'Q900001',
      }),
      wikidata: wikidataWith({ Q900001: { label: 'Kestrel Hollowmere' } }),
      qualifiers: [competitors('NO_MATERIAL_COMPETITOR'), bounded],
    });

    expect(verdict.status).not.toBe('VERIFIED');
  });

  it('3. a source-declared QID the candidate carries stays decisive, even over known competitors', async () => {
    const observations = [
      {
        evidenceKey: 'ev-1',
        canonicalIdentity: { wikidataQid: 'Q123' },
      },
    ] as unknown as SourceObservation[];
    const { verdict } = await decideThroughChain({
      hint: 'Alpha Kestrel',
      candidate: candidateNamed('Kestrel Hollowmere', { wikidataQid: 'Q123' }),
      wikidata: wikidataWith({ Q123: { label: 'Kestrel Hollowmere' } }),
      qualifiers: [competitors('MATERIAL_COMPETITOR_KNOWN', 4), bounded],
      observations,
    });

    expect(verdict).toMatchObject({
      status: 'VERIFIED',
      rule: 'SOURCE_DECLARED_IDENTITY',
    });
  });

  /**
   * Until RW4-ID-FALSE-VERIFY-2 the OVERLAP case below ("Kestrel Hall" ->
   * "Kestrel Hall Annex") VERIFIED by GROUNDED_CONVERGENCE: convergence was
   * CORROBORATING whatever the name grade. Convergence proves one record
   * was returned twice, not that the hint names it.
   */
  describe('4. convergence over an examined set decides only at an EQUIVALENT name grade', () => {
    const convergedOn = (canonicalName: string) => {
      const candidate = candidateNamed(canonicalName);
      return verifier.decide(
        { name: 'Kestrel Hall' },
        {
          strategy: 'PLACES',
          candidate,
          evidence: [
            {
              type: 'IDENTITY_CONVERGENCE',
              priorStrategy: 'NOMINATIM',
              identity: { provider: 'openstreetmap', externalId: 'osm:way:9' },
              correspondence: hintCandidateCorrespondence(
                'Kestrel Hall',
                candidate,
              ),
            },
            {
              type: 'CONVERGENCE_PROVENANCE',
              identity: { provider: 'openstreetmap', externalId: 'osm:way:9' },
              upstream: 'INDEPENDENT_UPSTREAMS',
            },
            competitors('NO_MATERIAL_COMPETITOR'),
            bounded,
          ],
        },
      );
    };

    it('an EQUIVALENT name: independent convergence stays decisive', () => {
      expect(convergedOn('Hall Kestrel')).toMatchObject({
        status: 'VERIFIED',
        rule: 'GROUNDED_CONVERGENCE',
      });
    });

    it('an OVERLAP name ("Kestrel Hall Annex"): not identity', () => {
      expect(convergedOn('Kestrel Hall Annex')).toMatchObject({
        status: 'INSUFFICIENT_EVIDENCE',
      });
    });
  });

  it("5. the source's own address discriminates a variant name", () => {
    expect(
      verifier.decide(
        { name: 'Farmacia Kestrel' },
        {
          strategy: 'LOCAL_OSM_POOL',
          candidate: candidateNamed('Farmacia de la Kestrel'),
          evidence: [
            { type: 'ADDRESS_MATCH' },
            competitors('MATERIAL_COMPETITOR_KNOWN', 2),
          ],
        },
      ),
    ).toMatchObject({ status: 'VERIFIED', rule: 'ADDRESS_MATCH' });
  });

  it('6. a grounded locality that distinguishes one member stays decisive', () => {
    expect(
      verifier.decide(
        { name: 'Kestrel Hall' },
        {
          strategy: 'LOCAL_OSM_POOL',
          candidate: candidateNamed('Kestrel Hall'),
          evidence: [
            { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
            {
              type: 'CONTEXTUAL_CORRESPONDENCE',
              assertion: 'LOCALITY',
              locality: 'Hollowmere',
              coverage: 'COVERS_ASSERTED_LOCALITY',
              memberCount: 2,
              consistentCount: 1,
              outcome: 'DISTINGUISHED',
            },
            competitors('MATERIAL_COMPETITOR_KNOWN', 1),
          ],
        },
      ),
    ).toMatchObject({ status: 'VERIFIED', rule: 'CONTEXTUAL_CORRESPONDENCE' });
  });

  it('7. a similar name plus a nearby Wikidata item is not identity', async () => {
    const { verdict, evidence } = await decideThroughChain({
      hint: 'Al Kestrel',
      candidate: candidateNamed('Kestrel Hollowmere'),
      wikidata: wikidataWith({}, [{ label: 'Kestrel Hollowmere' }]),
      qualifiers: [competitors('NO_MATERIAL_COMPETITOR'), bounded],
    });

    expect(evidence).toContainEqual({
      type: 'WIKIDATA_IDENTITY_MATCH',
      source: 'NEARBY',
      hintCorrespondence: 'OVERLAP',
      candidateCorrespondence: 'EQUIVALENT',
    });
    expect(verdict.status).not.toBe('VERIFIED');
  });

  describe('8. exact names keep their multiplicity rules', () => {
    it('an exact name in an ambiguous pool is AMBIGUOUS', () => {
      expect(
        verifier.decide(
          { name: 'Kestrel Hall' },
          {
            strategy: 'LOCAL_OSM_POOL',
            candidate: candidateNamed('Kestrel Hall'),
            evidence: [
              { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
              bounded,
            ],
          },
        ).status,
      ).toBe('AMBIGUOUS');
    });

    it('an exact name with an equivalent own QID cannot skip a known material competitor', async () => {
      const { verdict } = await decideThroughChain({
        hint: 'Kestrel Hall',
        candidate: candidateNamed('Kestrel Hall', {
          wikidataQid: 'Q900002',
          nameEvidenceMultiplicity: {
            exactName: 'MULTIPLE',
            declaredAlias: 'UNKNOWN',
          },
        }),
        wikidata: wikidataWith({ Q900002: { label: 'Kestrel Hall' } }),
        qualifiers: [competitors('MATERIAL_COMPETITOR_KNOWN', 1), bounded],
      });

      expect(verdict).toMatchObject({
        status: 'AMBIGUOUS',
        rule: 'MATERIAL_COMPETITOR_KNOWN',
      });
    });

    it('an exact name with an equivalent own QID and no material competitor verifies through the QID link', async () => {
      const { verdict } = await decideThroughChain({
        hint: 'Kestrel Hall',
        candidate: candidateNamed('Kestrel Hall', {
          wikidataQid: 'Q900002',
          nameEvidenceMultiplicity: {
            exactName: 'MULTIPLE',
            declaredAlias: 'UNKNOWN',
          },
        }),
        wikidata: wikidataWith({ Q900002: { label: 'Kestrel Hall' } }),
        qualifiers: [bounded],
      });

      expect(verdict).toMatchObject({ status: 'VERIFIED', rule: 'QID_LINK' });
    });
  });

  it('10. a source-declared QID linked to a fuzzy candidate name is not identity', async () => {
    const observations = [
      { evidenceKey: 'ev-1', canonicalIdentity: { wikidataQid: 'Q77' } },
    ] as unknown as SourceObservation[];
    const { verdict, evidence } = await decideThroughChain({
      hint: 'Kestrel Hall',
      candidate: candidateNamed('Kestrel'),
      wikidata: wikidataWith({ Q77: { label: 'Kestrel Hall' } }),
      qualifiers: [competitors('NO_MATERIAL_COMPETITOR'), bounded],
      observations,
    });

    expect(evidence).toContainEqual({
      type: 'WIKIDATA_IDENTITY_MATCH',
      source: 'OBSERVATION_QID',
      hintCorrespondence: 'DECLARES_QID',
      candidateCorrespondence: 'OVERLAP',
    });
    expect(verdict.status).not.toBe('VERIFIED');
  });

  /**
   * The invariant behind every case above, over the whole decision space
   * a small evidence alphabet spans: whenever the verifier says VERIFIED,
   * the rule read at least one DISCRIMINATING or CORROBORATING fact and no
   * RETRIEVAL_ONLY one.
   */
  it('never verifies on retrieval-only or qualifier-only evidence', () => {
    const correspondences = ['EQUIVALENT', 'OVERLAP', 'NONE'] as const;
    const alphabet: IdentityEvidence[][] = [
      [],
      [{ type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' }],
      [{ type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' }],
      [
        {
          type: 'DECLARED_ALIAS_MATCH',
          identityMultiplicity: 'SINGLE',
          correspondence: 'OVERLAP',
        },
      ],
      [
        {
          type: 'DECLARED_ALIAS_MATCH',
          identityMultiplicity: 'SINGLE',
          correspondence: 'EQUIVALENT',
        },
      ],
      ...correspondences.map((correspondence): IdentityEvidence[] => [
        {
          type: 'IDENTITY_CONVERGENCE',
          priorStrategy: 'NOMINATIM',
          identity: { provider: 'openstreetmap', externalId: 'osm:node:1' },
          correspondence,
        },
      ]),
    ];
    const links: IdentityEvidence[] = [
      ...(['OWN_QID', 'NEARBY'] as const).flatMap((source) =>
        correspondences.flatMap((hint) =>
          correspondences.map(
            (candidate): IdentityEvidence => ({
              type: 'WIKIDATA_IDENTITY_MATCH',
              source,
              hintCorrespondence: hint,
              candidateCorrespondence:
                source === 'OWN_QID' ? 'DECLARES_QID' : candidate,
            }),
          ),
        ),
      ),
      ...correspondences.map(
        (candidate): IdentityEvidence => ({
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'OBSERVATION_QID',
          hintCorrespondence: 'DECLARES_QID',
          candidateCorrespondence: candidate,
        }),
      ),
    ];
    const qualifierSets: IdentityEvidence[][] = [
      [],
      [bounded],
      [competitors('NO_MATERIAL_COMPETITOR'), bounded],
      [competitors('MATERIAL_COMPETITOR_KNOWN'), bounded],
    ];
    let verifiedCount = 0;
    for (const names of alphabet)
      for (const link of [undefined, ...links])
        for (const qualifiers of qualifierSets) {
          const verdict = verifier.decide(
            { name: 'Kestrel Hall' },
            {
              strategy: 'LOCAL_OSM_POOL',
              candidate: candidateNamed('Kestrel Hall'),
              evidence: [...names, ...(link ? [link] : []), ...qualifiers],
            },
          );
          if (verdict.status !== 'VERIFIED') continue;
          verifiedCount++;
          const roles = verdict.decisiveEvidence.map(identityEvidenceRole);
          expect(roles).not.toContain('RETRIEVAL_ONLY');
          expect(
            roles.some(
              (role) => role === 'DISCRIMINATING' || role === 'CORROBORATING',
            ),
          ).toBe(true);
        }
    expect(verifiedCount).toBeGreaterThan(0);
  });
});

/**
 * RW4-ID-FALSE-VERIFY-2 (2026-10-09, owner-approved Variant A). The hint
 * "National Bank" (the Plaza de Mayo HQ) VERIFIED as "Edificio First
 * National Bank of Boston": two strategies returned one record, no material
 * competitor was known and the geography was bounded, but the hint only
 * OVERLAPs the record's name. The true referent was never retrieved.
 * Generic shape: "Kestrel Bank" -> "First Kestrel Bank of Hollowmere".
 */
describe('RW4-ID-FALSE-VERIFY-2: convergence inherits the name grade', () => {
  const identity = {
    provider: 'openstreetmap',
    externalId: 'osm:relation:42',
  };
  const falseCandidate = candidateNamed('First Kestrel Bank of Hollowmere');
  const convergence = (
    correspondence: NameCorrespondence,
  ): IdentityEvidence => ({
    type: 'IDENTITY_CONVERGENCE',
    priorStrategy: 'NOMINATIM',
    identity,
    correspondence,
  });
  const provenance = (
    upstream: 'SHARED_UPSTREAM' | 'INDEPENDENT_UPSTREAMS',
  ): IdentityEvidence => ({
    type: 'CONVERGENCE_PROVENANCE',
    identity,
    upstream,
  });

  it('R3: the role matrix of IDENTITY_CONVERGENCE by name grade', () => {
    expect(identityEvidenceRole(convergence('EQUIVALENT'))).toBe(
      'CORROBORATING',
    );
    expect(identityEvidenceRole(convergence('OVERLAP'))).toBe('RETRIEVAL_ONLY');
    expect(identityEvidenceRole(convergence('NONE'))).toBe('RETRIEVAL_ONLY');
  });

  it('R1: the hint only OVERLAPs the converged record', () => {
    expect(hintCandidateCorrespondence('Kestrel Bank', falseCandidate)).toBe(
      'OVERLAP',
    );
  });

  it.each(['SHARED_UPSTREAM', 'INDEPENDENT_UPSTREAMS'] as const)(
    'R1/R2: OVERLAP convergence over %s, NO_MATERIAL_COMPETITOR and a bounded geography is not VERIFIED',
    (upstream) => {
      const verdict = verifier.decide(
        { name: 'Kestrel Bank' },
        {
          strategy: 'PLACES',
          candidate: falseCandidate,
          evidence: [
            convergence(
              hintCandidateCorrespondence('Kestrel Bank', falseCandidate),
            ),
            provenance(upstream),
            competitors('NO_MATERIAL_COMPETITOR'),
            bounded,
          ],
        },
      );

      expect(verdict.status).not.toBe('VERIFIED');
      expect(verdict).toMatchObject({
        status: 'INSUFFICIENT_EVIDENCE',
        rule: 'NO_DECISIVE_EVIDENCE',
      });
    },
  );

  it('R4: the same facts at an EQUIVALENT grade (a declared alias) VERIFY', () => {
    const aliased = candidateNamed('First Kestrel Bank of Hollowmere', {
      nameAliasCandidates: ['Kestrel Bank'],
    });
    expect(hintCandidateCorrespondence('Kestrel Bank', aliased)).toBe(
      'EQUIVALENT',
    );
    expect(
      verifier.decide(
        { name: 'Kestrel Bank' },
        {
          strategy: 'PLACES',
          candidate: aliased,
          evidence: [
            convergence(hintCandidateCorrespondence('Kestrel Bank', aliased)),
            provenance('SHARED_UPSTREAM'),
            competitors('NO_MATERIAL_COMPETITOR'),
            bounded,
          ],
        },
      ),
    ).toMatchObject({ status: 'VERIFIED', rule: 'GROUNDED_CONVERGENCE' });
  });

  it('a known material competitor still decides before EQUIVALENT convergence (rule 4)', () => {
    expect(
      verifier.decide(
        { name: 'Kestrel Bank' },
        {
          strategy: 'PLACES',
          candidate: candidateNamed('Kestrel Bank'),
          evidence: [
            convergence('EQUIVALENT'),
            provenance('INDEPENDENT_UPSTREAMS'),
            competitors('MATERIAL_COMPETITOR_KNOWN', 2),
            bounded,
          ],
        },
      ),
    ).toMatchObject({ status: 'AMBIGUOUS', rule: 'MATERIAL_COMPETITOR_KNOWN' });
  });
});
