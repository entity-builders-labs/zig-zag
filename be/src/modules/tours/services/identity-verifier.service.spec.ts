import {
  IdentityMultiplicity,
  ResolutionAttempt,
} from '../interfaces/experience-resolution.interface';
import { IdentityVerifier } from './identity-verifier.service';
import {
  IdentityEvidence,
  NameCorrespondence,
} from '../interfaces/experience-resolution.interface';
import { GeoEntityKind } from '@prisma/client';

const candidate = (
  exactName: IdentityMultiplicity = 'SINGLE',
  declaredAlias: IdentityMultiplicity = 'SINGLE',
) => ({
  hintKey: 'place',
  hintName: 'hint',
  provider: 'google_places',
  externalId: 'place-1',
  canonicalName: 'Recoleta Cemetery',
  kind: GeoEntityKind.PLACE,
  role: 'venue' as const,
  nameEvidenceMultiplicity: { exactName, declaredAlias },
});

const attempt = (
  evidence: ResolutionAttempt['evidence'],
  exactName: IdentityMultiplicity = 'SINGLE',
  declaredAlias: IdentityMultiplicity = 'SINGLE',
): ResolutionAttempt => ({
  strategy: 'PLACES',
  candidate: candidate(exactName, declaredAlias),
  evidence,
});

/**
 * Destination-bounded admission (P0.2): the geography the RW1 and earlier
 * Buenos Aires cases (Recoleta, Defensa, El Zanjón, Farmacia la Estrella)
 * were decided in. RW4-ID-CORRESPONDENCE-1 turned that implicit premise
 * into an explicit fact; their verdicts are unchanged.
 */
const destinationBounded = {
  type: 'GEOGRAPHIC_CORRESPONDENCE' as const,
  basis: 'BOUNDED_ADMISSION_SCOPE' as const,
};

/** Legacy boolean shape of a Wikidata link, as the pre-2026-10-07
 * fixtures state it: `true` is the strongest correspondence (the side
 * carries the item, or names it EQUIVALENTLY), `false` names nothing. */
const wikidataLink = (
  source: 'OWN_QID' | 'OBSERVATION_QID' | 'NEARBY',
  hintMatched: boolean,
  candidateMatched: boolean,
): IdentityEvidence => ({
  type: 'WIKIDATA_IDENTITY_MATCH',
  source,
  hintCorrespondence:
    source === 'OBSERVATION_QID'
      ? 'DECLARES_QID'
      : hintMatched
        ? 'EQUIVALENT'
        : 'NONE',
  candidateCorrespondence:
    source === 'OWN_QID'
      ? 'DECLARES_QID'
      : candidateMatched
        ? 'EQUIVALENT'
        : 'NONE',
});

describe('IdentityVerifier', () => {
  /**
   * ID-based identity evidence, not string matching: a different,
   * structurally independent acquisition strategy already returned this
   * exact same (provider, externalId) for this hint (real spike case: "El
   * Zanjón de Granados" -- LOCAL_OSM_POOL and NOMINATIM both independently
   * acquired osm:node:9953027884).
   *
   * Baseline 15af1ccb asserted VERIFIED for these two inputs. Both carry
   * convergence and NOTHING about competitors: that is exactly the
   * 2026-10-03 defect A (absence of a known collision read as proof of
   * none). The inputs are kept verbatim; the expectation is the corrected
   * policy. The real El Zanjón evidence also carried Nominatim's
   * untruncated country-bounded response holding only that node, which the
   * companion tests project (and the resolver-level RW1 Case A test proves
   * on the original fixture).
   *
   * The convergence carries an EQUIVALENT name grade (the strongest one),
   * so the missing competitor examination stays the only reason it is not
   * decisive (RW4-ID-FALSE-VERIFY-2 grades convergence by name).
   */
  it('convergence with no examination of competitors is not decisive (baseline input; defect A)', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'El Zanjón de Granados' },
        attempt([
          {
            type: 'IDENTITY_CONVERGENCE',
            priorStrategy: 'LOCAL_OSM_POOL',
            identity: {
              provider: 'openstreetmap',
              externalId: 'osm:node:9953027884',
            },
            correspondence: 'EQUIVALENT',
          },
        ]),
      ),
    ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });

  /**
   * Test B (baseline 15af1ccb input, kept verbatim). 15af1ccb expected
   * VERIFIED (defect A); 272d50ef changed it to REJECTED, reading the
   * NEARBY(hint=true, candidate=false) label match as a contradiction. It
   * is not one: a nearby label naming only the hint text (El Zanjón: the
   * candidate's "(historic ruins)" suffix defeats the label match)
   * establishes no incompatible identity (amendment §6, NOT_CORROBORATED).
   * With convergence and nothing examined about competitors, the input
   * carries no decisive fact either way (RW4-ID-NEARBY-1).
   */
  it('convergence with no examination of competitors plus a non-corroborating NEARBY match is INSUFFICIENT_EVIDENCE (baseline input; defect A, RW4-ID-NEARBY-1)', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'El Zanjón de Granados' },
        attempt([
          {
            type: 'IDENTITY_CONVERGENCE',
            priorStrategy: 'LOCAL_OSM_POOL',
            identity: {
              provider: 'openstreetmap',
              externalId: 'osm:node:9953027884',
            },
            correspondence: 'EQUIVALENT',
          },
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'NEARBY',
            hintCorrespondence: 'EQUIVALENT',
            candidateCorrespondence: 'NONE',
          },
        ]),
      ),
    ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });

  /**
   * RW1 El Zanjón: the hint "El Zanjón de Granados" only OVERLAPs the
   * converged record "El Zanjón de Granados (historic ruins)". Until
   * RW4-ID-FALSE-VERIFY-2 these facts VERIFIED by GROUNDED_CONVERGENCE.
   * Convergence proves one record was returned twice, not that the hint
   * names it, so OVERLAP convergence is retrieval-only. The owner accepted
   * El Zanjón -> INSUFFICIENT_EVIDENCE (2026-10-09) as a correctness
   * tightening: the referent looks right, the evidence does not prove it.
   */
  describe('RW1 El Zanjón facts, projected: convergence over an examined competitor set', () => {
    const verifier = new IdentityVerifier();
    const convergenceAt = (correspondence: NameCorrespondence) => ({
      type: 'IDENTITY_CONVERGENCE' as const,
      priorStrategy: 'LOCAL_OSM_POOL' as const,
      identity: {
        provider: 'openstreetmap',
        externalId: 'osm:node:9953027884',
      },
      correspondence,
    });
    const zanjonQualifiers = [
      {
        type: 'CONVERGENCE_PROVENANCE' as const,
        identity: {
          provider: 'openstreetmap',
          externalId: 'osm:node:9953027884',
        },
        upstream: 'SHARED_UPSTREAM' as const,
      },
      // Nominatim's untruncated country-bounded response held only this node.
      {
        type: 'COMPETITOR_EXAMINATION' as const,
        outcome: 'NO_MATERIAL_COMPETITOR' as const,
        examinedStrategies: ['LOCAL_OSM_POOL' as const, 'NOMINATIM' as const],
        competitorCount: 0,
      },
      destinationBounded,
    ];
    const zanjonConvergence = [convergenceAt('OVERLAP'), ...zanjonQualifiers];

    it('the real OVERLAP grade is INSUFFICIENT_EVIDENCE, not VERIFIED (RW4-ID-FALSE-VERIFY-2)', () => {
      expect(
        verifier.decide(
          { name: 'El Zanjón de Granados' },
          attempt(zanjonConvergence),
        ),
      ).toMatchObject({
        status: 'INSUFFICIENT_EVIDENCE',
        rule: 'NO_DECISIVE_EVIDENCE',
      });
    });

    it('the same facts with an EQUIVALENT grade VERIFY by GROUNDED_CONVERGENCE', () => {
      expect(
        verifier.decide(
          { name: 'El Zanjón de Granados' },
          attempt([convergenceAt('EQUIVALENT'), ...zanjonQualifiers]),
        ),
      ).toMatchObject({ status: 'VERIFIED', rule: 'GROUNDED_CONVERGENCE' });
    });

    it('a NEARBY item that matches only the hint text does not repair OVERLAP convergence', () => {
      expect(
        verifier.verify(
          { name: 'El Zanjón de Granados' },
          attempt([
            ...zanjonConvergence,
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: 'NEARBY',
              hintCorrespondence: 'EQUIVALENT',
              candidateCorrespondence: 'NONE',
            },
          ]),
        ),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });
  });

  it('rejects a candidate that only shares half of an observation QID identity', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt([
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'OBSERVATION_QID',
            hintCorrespondence: 'DECLARES_QID',
            candidateCorrespondence: 'NONE',
          },
        ]),
      ),
    ).toEqual({ status: 'REJECTED' });
  });

  it('verifies independent translated aliases of the same observation QID', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt([
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'OBSERVATION_QID',
            hintCorrespondence: 'DECLARES_QID',
            candidateCorrespondence: 'EQUIVALENT',
          },
        ]),
      ),
    ).toEqual({ status: 'VERIFIED' });
  });

  it('keeps a correct observation-QID confirmation verified', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt([
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'OBSERVATION_QID',
            hintCorrespondence: 'DECLARES_QID',
            candidateCorrespondence: 'EQUIVALENT',
          },
        ]),
      ),
    ).toEqual({ status: 'VERIFIED' });
  });

  // 662d817c expected REJECTED here: a failed NEARBY confirmation was a
  // veto. Since amendment §6 it is NOT_CORROBORATED: the item names the
  // hint, nothing ties it to another identity (RW4-ID-NEARBY-1).
  it('a nearby Wikidata match the candidate only half-shares is not corroboration, and not a rejection', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt([
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'NEARBY',
            hintCorrespondence: 'EQUIVALENT',
            candidateCorrespondence: 'NONE',
          },
        ]),
      ),
    ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });

  it('returns insufficient evidence when Wikidata is unavailable', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt([{ type: 'WIKIDATA_UNAVAILABLE' }]),
      ),
    ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });

  // A1. EXACT_NAME + SINGLE -> VERIFIED
  it('A1: EXACT_NAME + SINGLE -> VERIFIED', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Recoleta Cemetery' },
      attempt([
        { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
        destinationBounded,
      ]),
    );
    expect(result).toEqual({ status: 'VERIFIED' });
  });

  // A2. EXACT_NAME + MULTIPLE -> AMBIGUOUS
  it('A2: EXACT_NAME + MULTIPLE -> AMBIGUOUS', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Recoleta Cemetery' },
      attempt([{ type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' }]),
    );
    expect(result).toEqual({ status: 'AMBIGUOUS' });
  });

  // A3. EXACT_NAME + UNKNOWN -> INSUFFICIENT_EVIDENCE
  it('A3: EXACT_NAME + UNKNOWN -> INSUFFICIENT_EVIDENCE', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Recoleta Cemetery' },
      attempt([{ type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' }]),
    );
    expect(result).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });

  // A4. EXACT_NAME + UNKNOWN + valid WIKIDATA_IDENTITY_MATCH -> VERIFIED
  it('A4: EXACT_NAME + UNKNOWN + valid WIKIDATA_IDENTITY_MATCH -> VERIFIED', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Recoleta Cemetery' },
      attempt([
        { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
        {
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'OWN_QID',
          hintCorrespondence: 'EQUIVALENT',
          candidateCorrespondence: 'DECLARES_QID',
        },
      ]),
    );
    expect(result).toEqual({ status: 'VERIFIED' });
  });

  // A5. EXACT_NAME + UNKNOWN + WIKIDATA_UNAVAILABLE -> INSUFFICIENT_EVIDENCE
  it('A5: EXACT_NAME + UNKNOWN + WIKIDATA_UNAVAILABLE -> INSUFFICIENT_EVIDENCE', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Recoleta Cemetery' },
      attempt([
        { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
        { type: 'WIKIDATA_UNAVAILABLE' },
      ]),
    );
    expect(result).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });

  // A6. DECLARED_ALIAS_MATCH + SINGLE -> VERIFIED
  it('A6: DECLARED_ALIAS_MATCH + SINGLE -> VERIFIED', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Defensa Street' },
      attempt([
        {
          type: 'DECLARED_ALIAS_MATCH',
          identityMultiplicity: 'SINGLE',
          correspondence: 'EQUIVALENT' as const,
        },
        destinationBounded,
      ]),
    );
    expect(result).toEqual({ status: 'VERIFIED' });
  });

  // A7. DECLARED_ALIAS_MATCH + MULTIPLE -> AMBIGUOUS
  it('A7: DECLARED_ALIAS_MATCH + MULTIPLE -> AMBIGUOUS', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Defensa Street' },
      attempt([
        {
          type: 'DECLARED_ALIAS_MATCH',
          identityMultiplicity: 'MULTIPLE',
          correspondence: 'EQUIVALENT' as const,
        },
      ]),
    );
    expect(result).toEqual({ status: 'AMBIGUOUS' });
  });

  // A8. DECLARED_ALIAS_MATCH + UNKNOWN -> INSUFFICIENT_EVIDENCE
  it('A8: DECLARED_ALIAS_MATCH + UNKNOWN -> INSUFFICIENT_EVIDENCE', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Defensa Street' },
      attempt([
        {
          type: 'DECLARED_ALIAS_MATCH',
          identityMultiplicity: 'UNKNOWN',
          correspondence: 'EQUIVALENT' as const,
        },
      ]),
    );
    expect(result).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });

  // A9. EXACT_NAME + SINGLE + later Wikidata mismatch -> VERIFIED (local exact name sufficient before Wikidata)
  it('A9: EXACT_NAME + SINGLE plus later Wikidata mismatch -> VERIFIED', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Recoleta Cemetery' },
      attempt([
        { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
        {
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'OWN_QID',
          hintCorrespondence: 'NONE',
          candidateCorrespondence: 'DECLARES_QID',
        },
        destinationBounded,
      ]),
    );
    expect(result).toEqual({ status: 'VERIFIED' });
  });

  // A10. WIKIDATA mismatch without prior sufficient local proof -> REJECTED
  it('A10: WIKIDATA mismatch without prior sufficient local proof -> REJECTED', async () => {
    const verifier = new IdentityVerifier();
    const result = await verifier.verify(
      { name: 'Recoleta Hotel' },
      attempt([
        {
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'OWN_QID',
          hintCorrespondence: 'NONE',
          candidateCorrespondence: 'DECLARES_QID',
        },
      ]),
    );
    expect(result).toEqual({ status: 'REJECTED' });
  });

  /**
   * Stage 1 characterization lock (component-resolution-and-partial-
   * composite-recovery-plan.md). These cases freeze CURRENT IdentityVerifier
   * behavior against real evidence shapes recorded in
   * spikes/rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/
   * (cold-1/cold-2/cold-3 entity_resolution audits). They intentionally do
   * NOT change production semantics -- Stage 3/6 may revisit these outcomes.
   */
  describe('RW1 forensic-rerun-2026-09-22 characterization (Stage 1)', () => {
    // Case A - El Zanjón de Granados: three independent acquisition paths
    // (LOCAL_OSM_POOL, NOMINATIM, geoapify PLACES) all resolved the "El
    // Zanjón de Granados" hint onto the exact same canonical OSM object
    // (osm:node:9953027884, canonicalName "El Zanjón de Granados (historic
    // ruins)") in every cold run. Every one of the three attempts carried
    // the identical WIKIDATA_IDENTITY_MATCH(source: NEARBY, hintMatched:
    // true, candidateMatched: false) evidence -- the corroboration search
    // found a nearby Wikidata entity matching the HINT text but not the
    // (differently-worded) resolved candidate's own canonical name -- and
    // IdentityVerifier rejected all three. This is the exact baseline the
    // amendment's "candidate convergence is evidence; provider voting is
    // not policy" section (§5) and "corroboration is additive; absence is
    // not contradiction" section (§6) are written against. The frozen
    // REJECTED was not correct: per §6 each attempt alone is
    // INSUFFICIENT_EVIDENCE (RW4-ID-NEARBY-1, 2026-10-03). The resolver-level
    // Case A test proves the original fixture still VERIFIES and persists.
    it('Case A: El Zanjón de Granados — a non-corroborating Wikidata NEARBY match alone leaves each attempt INSUFFICIENT_EVIDENCE, never REJECTED', async () => {
      const verifier = new IdentityVerifier();
      const zanjonHint = { name: 'El Zanjón de Granados' };
      const nonCorroboratingNearbyMatch: ResolutionAttempt['evidence'] = [
        {
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'NEARBY',
          hintCorrespondence: 'EQUIVALENT',
          candidateCorrespondence: 'NONE',
        },
      ];

      // Same real externalId (osm:node:9953027884), three independent
      // acquisition strategies, three identical non-decisions.
      for (const strategy of [
        'LOCAL_OSM_POOL',
        'NOMINATIM',
        'PLACES',
      ] as const) {
        const result = await verifier.verify(zanjonHint, {
          strategy,
          candidate: {
            ...candidate(),
            externalId: 'osm:node:9953027884',
            canonicalName: 'El Zanjón de Granados (historic ruins)',
          },
          evidence: nonCorroboratingNearbyMatch,
        });
        expect(result).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
      }
    });

    // The SAME real object, reached through a differently-worded hint that
    // happens to equal the candidate's own canonical name exactly, verifies
    // immediately on local EXACT_NAME evidence alone -- confirming the
    // convergence is real (same externalId) even though only one of the
    // two hint phrasings for it ever reaches VERIFIED today.
    it('Case A: the same osm:node:9953027884 verifies immediately when the hint text matches the candidate canonical name exactly', async () => {
      const verifier = new IdentityVerifier();
      const result = await verifier.verify(
        { name: 'El Zanjón de Granados (historic ruins)' },
        attempt([
          { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
          destinationBounded,
        ]),
      );
      expect(result).toEqual({ status: 'VERIFIED' });
    });

    // Case F (FIXED 2026-09-24) - divergent candidate clusters: "Nuestra
    // Señora de Belén" is a genuinely common devotional name. The real
    // warm-run trace recorded Nominatim returning 4 results (EXACT_NAME
    // identityMultiplicity: MULTIPLE) while a separate geoapify Places
    // attempt resolved a DIFFERENT real entity ("Capilla Nuestra Señora de
    // Belén", a chapel building) for the same hint -- two structurally
    // different real candidate clusters that cannot be safely correlated.
    // The amendment says this should conceptually resolve as AMBIGUOUS,
    // never provider-majority voting. A non-corroborating Wikidata match
    // (hintMatched/candidateMatched not both true) doesn't actively
    // CONTRADICT the candidate -- it simply failed to confirm one specific
    // member of an already-observed MULTIPLE-candidate pool. That is exactly
    // what AMBIGUOUS means; REJECTED implies the identity was disproven,
    // which a mere non-confirmation never establishes.
    it('Case F: EXACT_NAME MULTIPLE (real divergent clusters) is AMBIGUOUS, not REJECTED, when Wikidata NEARBY evidence does not corroborate', async () => {
      const verifier = new IdentityVerifier();
      const result = await verifier.verify(
        { name: 'Nuestra Señora de Belén' },
        attempt(
          [
            { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: 'NEARBY',
              hintCorrespondence: 'NONE',
              candidateCorrespondence: 'NONE',
            },
          ],
          'MULTIPLE',
        ),
      );
      expect(result).toEqual({ status: 'AMBIGUOUS' });
    });

    // Revised 2026-10-03 (RW4 verifier characterization): a Wikidata match
    // cannot resolve WHICH member of a same-name pool the source meant. Its
    // NEARBY search is centered on the selected candidate and every variant
    // compares names only, so each same-named pool member that has its own
    // Wikidata item "corroborates" itself. The live replay verified "Ojo de
    // Agua" (a Lujan de Cuyo source component) to a Cordoba hamlet 383 km
    // away this way. Corroboration of the selected member is not
    // disambiguation: the pool stays AMBIGUOUS.
    it('Case F: EXACT_NAME MULTIPLE stays AMBIGUOUS even when Wikidata matches the selected member', async () => {
      const verifier = new IdentityVerifier();
      const result = await verifier.verify(
        { name: 'Nuestra Señora de Belén' },
        attempt(
          [
            { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: 'NEARBY',
              hintCorrespondence: 'EQUIVALENT',
              candidateCorrespondence: 'EQUIVALENT',
            },
          ],
          'MULTIPLE',
        ),
      );
      expect(result).toEqual({ status: 'AMBIGUOUS' });
    });

    // Without any Wikidata evidence at all, the bare EXACT_NAME MULTIPLE
    // signal from the same real Nuestra Señora de Belén case already
    // resolves to AMBIGUOUS (identical to A2) -- included here so the
    // precedence contrast above is explicit and self-contained.
    it('Case F: the same MULTIPLE signal alone (no Wikidata evidence) is AMBIGUOUS today', async () => {
      const verifier = new IdentityVerifier();
      const result = await verifier.verify(
        { name: 'Nuestra Señora de Belén' },
        attempt([{ type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' }]),
      );
      expect(result).toEqual({ status: 'AMBIGUOUS' });
    });
  });

  describe('STRUCTURED_ROUTE_RESOLUTION (Stage 3 targeted ROUTE)', () => {
    const structured = (
      overrides: Partial<{
        destinationCompatibility: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
        ambiguity: 'SINGLE_CLUSTER' | 'MULTIPLE_CLUSTERS';
      }> = {},
    ) => ({
      type: 'STRUCTURED_ROUTE_RESOLUTION' as const,
      provider: 'openstreetmap' as const,
      segmentExternalIds: ['osm:way:1', 'osm:way:2'],
      destinationCompatibility: 'COMPATIBLE' as const,
      ambiguity: 'SINGLE_CLUSTER' as const,
      ...overrides,
    });

    it('VERIFIES a single destination-compatible structural route cluster, with no name evidence at all', () => {
      expect(
        new IdentityVerifier().verify(
          { name: 'Defensa Street' },
          attempt([structured()], 'UNKNOWN', 'UNKNOWN'),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    it('never VERIFIES a cluster whose destination compatibility is not COMPATIBLE', () => {
      for (const destinationCompatibility of [
        'INCOMPATIBLE',
        'UNKNOWN',
      ] as const) {
        expect(
          new IdentityVerifier().verify(
            { name: 'Defensa' },
            attempt(
              [structured({ destinationCompatibility })],
              'UNKNOWN',
              'UNKNOWN',
            ),
          ).status,
        ).not.toBe('VERIFIED');
      }
    });

    it('reports AMBIGUOUS, never VERIFIED, for competing clusters', () => {
      expect(
        new IdentityVerifier().verify(
          { name: 'San Lorenzo' },
          attempt(
            [structured({ ambiguity: 'MULTIPLE_CLUSTERS' })],
            'UNKNOWN',
            'UNKNOWN',
          ),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });
  });

  describe('CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH (catalog reuse of a canonical ROUTE)', () => {
    it('VERIFIES a single canonical ROUTE matched through the generic designator variant ("Defensa Street" -> "Defensa")', () => {
      expect(
        new IdentityVerifier().verify(
          { name: 'Defensa Street' },
          attempt(
            [
              {
                type: 'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH',
                retrievalVariant: 'DESIGNATOR_NORMALIZED',
                identityMultiplicity: 'SINGLE',
              },
            ],
            'UNKNOWN',
            'UNKNOWN',
          ),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    it('is AMBIGUOUS when the variant matched several canonical ROUTEs', () => {
      expect(
        new IdentityVerifier().verify(
          { name: 'Pasaje San Lorenzo' },
          attempt(
            [
              {
                type: 'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH',
                retrievalVariant: 'DESIGNATOR_NORMALIZED',
                identityMultiplicity: 'MULTIPLE',
              },
            ],
            'UNKNOWN',
            'UNKNOWN',
          ),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });
  });

  describe('CATALOG_VERIFIED_HINT_MATCH (verified hint memory, not alias inference)', () => {
    const verifiedHint = (
      identityMultiplicity: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN',
    ) => ({
      type: 'CATALOG_VERIFIED_HINT_MATCH' as const,
      verifiedHintKey: 'farmacia la estrella',
      identityMultiplicity,
    });

    it('VERIFIES the single in-scope GeoEntity this exact hint key was previously verified to, although the canonical name differs', () => {
      expect(
        new IdentityVerifier().verify(
          { name: 'Farmacia la Estrella' },
          attempt([verifiedHint('SINGLE')], 'UNKNOWN', 'UNKNOWN'),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    it('is AMBIGUOUS when the remembered key is shared by several in-scope GeoEntities -- never a winner', () => {
      expect(
        new IdentityVerifier().verify(
          { name: 'San José' },
          attempt([verifiedHint('MULTIPLE')], 'UNKNOWN', 'UNKNOWN'),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    it('does not verify on UNKNOWN multiplicity alone', () => {
      expect(
        new IdentityVerifier().verify(
          { name: 'Farmacia la Estrella' },
          attempt([verifiedHint('UNKNOWN')], 'UNKNOWN', 'UNKNOWN'),
        ),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });
  });

  /**
   * RW4 IdentityVerifier characterization (2026-10-03). Evidence shapes are
   * the ones the production resolver actually produced in
   * spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/
   * identity-characterization/verifier-characterization-2026-10-03/
   * resolver-replay.json (real Overture AOI snapshot, local Nominatim,
   * Geoapify, live Wikidata). Canonical rule: spec 2026-09-22 amendment §6
   * -- NOT_CORROBORATED must not collapse into CONTRADICTED.
   */
  describe('RW4 component identity characterization (2026-10-03)', () => {
    const verifier = new IdentityVerifier();
    const nearby = (
      hintMatched: boolean,
      candidateMatched: boolean,
    ): ResolutionAttempt['evidence'][number] =>
      wikidataLink('NEARBY', hintMatched, candidateMatched);
    const overtureAttempt = (
      canonicalName: string,
      evidence: ResolutionAttempt['evidence'],
      exactName: IdentityMultiplicity,
    ): ResolutionAttempt => ({
      strategy: 'OVERTURE_IDENTITY',
      candidate: {
        ...candidate(exactName, 'UNKNOWN'),
        provider: 'overture',
        canonicalName,
      },
      evidence,
    });

    // Observed: one exact record in a PARTIAL (AOI) snapshot -> multiplicity
    // UNKNOWN; no Wikidata item within 200 m. Absence of corroboration is
    // not a contradiction: insufficient, never REJECTED.
    it.each([
      ['Alfa Crux', '79eb9ee4-0591-49f3-a077-51a7926a3ada'],
      ['SuperUco', '753ed444-8e83-4178-8ad3-a05e9a28b7c5'],
    ])(
      '%s with its actual evidence (EXACT_NAME UNKNOWN, no Wikidata item) is INSUFFICIENT_EVIDENCE',
      (name, featureId) => {
        expect(
          verifier.verify(
            { name },
            {
              ...overtureAttempt(
                name,
                [
                  { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
                  nearby(false, false),
                ],
                'UNKNOWN',
              ),
              candidate: {
                ...overtureAttempt(name, [], 'UNKNOWN').candidate,
                externalId: featureId,
              },
            },
          ),
        ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
      },
    );

    // Superseded 2026-10-03 (RW4-ID-CORRESPONDENCE-1). This test asserted
    // that a COMPLETE_COUNTRY snapshot's SINGLE verifies Alfa Crux on its
    // own. The same evidence verifies Overture's only AR "Ojo de Agua", a
    // Neuquén cabin, when the source meant a Luján de Cuyo restaurant the
    // dataset lacks: country uniqueness cannot tell the two apart. It
    // decides only inside a grounded geography.
    it.each([
      ['ADMISSION_SCOPE_ONLY' as const, 'INSUFFICIENT_EVIDENCE'],
      ['SOURCE_LOCALITY' as const, 'VERIFIED'],
    ])(
      'complete-country uniqueness for Alfa Crux with correspondence %s -> %s',
      (basis, status) => {
        expect(
          verifier.verify(
            { name: 'Alfa Crux' },
            overtureAttempt(
              'Alfa Crux',
              [
                { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
                { type: 'GEOGRAPHIC_CORRESPONDENCE', basis },
              ],
              'SINGLE',
            ),
          ),
        ).toEqual({ status });
      },
    );

    // Two distinct establishments with one name, and an exact-name match
    // whose location contradicts the source: the real "Ojo de Agua" case
    // (5 same-name Nominatim objects; the selected one is a Cordoba hamlet
    // 383 km from Lujan de Cuyo; Wikidata found its own same-named item).
    it('two same-name establishments stay AMBIGUOUS although Wikidata matches the selected one (Ojo de Agua)', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          {
            strategy: 'NOMINATIM',
            candidate: {
              ...candidate('MULTIPLE', 'UNKNOWN'),
              provider: 'openstreetmap',
              externalId: 'osm:node:198407364',
              canonicalName: 'Ojo de Agua',
            },
            evidence: [
              { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
              nearby(true, true),
            ],
          },
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    // Retained (not demonstrated defective; see RW1 San Telmo, anchor
    // resolver spec): a QID declared by the candidate record itself or by
    // the source is a structural link, not a search around the candidate.
    it.each(['OWN_QID', 'OBSERVATION_QID'] as const)(
      'a corroborating %s match still singles out a MULTIPLE exact-name member',
      (source) => {
        expect(
          verifier.verify(
            { name: 'San Telmo' },
            attempt(
              [
                { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
                wikidataLink(source, true, true),
              ],
              'MULTIPLE',
            ),
          ),
        ).toEqual({ status: 'VERIFIED' });
      },
    );

    it('a MULTIPLE declared-alias pool is not disambiguated by a NEARBY match either', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt(
            [
              {
                type: 'DECLARED_ALIAS_MATCH',
                identityMultiplicity: 'MULTIPLE',
                correspondence: 'EQUIVALENT' as const,
              },
              nearby(true, true),
            ],
            'UNKNOWN',
            'MULTIPLE',
          ),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    // Same brand, different physical facility: Overture holds the Tupungato
    // winery (d97a65d2) and the Tunuyan store (673c6cb8) under one
    // normalized name, sharing website and phone. Brand facts never
    // collapse facilities.
    it('a same-brand establishment at a different location keeps the pool AMBIGUOUS (Bodega La Azul)', () => {
      expect(
        verifier.verify(
          { name: 'Bodega La Azul' },
          overtureAttempt(
            'Bodega La Azul',
            [
              { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
              nearby(true, true),
            ],
            'MULTIPLE',
          ),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    // Observed: hint "Bodega Azul" has no exact record anywhere; Nominatim
    // returned the city supermarket 'Supermercado del Vino "La Bodega de
    // Azul"' with no Wikidata item nearby. Not the source's winery, but
    // nothing CONTRADICTS it either: unconfirmed, never REJECTED.
    it('Bodega Azul vs the "La Bodega de Azul" supermarket is INSUFFICIENT_EVIDENCE, not REJECTED', () => {
      expect(
        verifier.verify(
          { name: 'Bodega Azul' },
          {
            strategy: 'NOMINATIM',
            candidate: {
              ...candidate('UNKNOWN', 'UNKNOWN'),
              provider: 'openstreetmap',
              externalId: 'osm:node:4082354791',
              canonicalName: 'Supermercado del Vino "La Bodega de Azul"',
            },
            evidence: [nearby(false, false)],
          },
        ),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });

    // 92da63b1 expected REJECTED here ("positive evidence of a different
    // identity"). A label naming one of the two texts identifies no other
    // entity: NOT_CORROBORATED (RW4-ID-NEARBY-1). See the NEARBY matrix.
    it.each([
      [true, false],
      [false, true],
    ])(
      'a partial nearby Wikidata match (hint=%s, candidate=%s) is INSUFFICIENT_EVIDENCE, not REJECTED',
      (hintMatched, candidateMatched) => {
        expect(
          verifier.verify(
            { name: 'Recoleta Cemetery' },
            attempt([nearby(hintMatched, candidateMatched)], 'UNKNOWN'),
          ),
        ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
      },
    );

    // A16 negative control: no exact record for "A16" (only "Bodega A16"
    // x2, "A16 Wine & Deli", "Cava A16"); nothing was acquired.
    it('A16 with no acquired evidence is INSUFFICIENT_EVIDENCE', () => {
      expect(
        verifier.verify({ name: 'A16' }, overtureAttempt('A16', [], 'UNKNOWN')),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });
  });

  /**
   * RW4-ID-CONTRADICTION-1: an explicit contradiction (the source declares
   * the component to be a different Wikidata entity than the candidate
   * record declares itself to be) overrides every terminal positive rule.
   */
  describe('explicit identity contradiction precedes positive rules', () => {
    const verifier = new IdentityVerifier();
    const contradiction = {
      type: 'IDENTITY_CONTRADICTION' as const,
      fact: 'WIKIDATA_QID' as const,
      sourceQid: 'Q1',
      candidateQid: 'Q2',
    };

    it.each<[string, ResolutionAttempt['evidence']]>([
      [
        'EXACT_NAME + SINGLE',
        [{ type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' }],
      ],
      ['ADDRESS_MATCH', [{ type: 'ADDRESS_MATCH' }]],
      [
        'DECLARED_ALIAS_MATCH + SINGLE',
        [
          {
            type: 'DECLARED_ALIAS_MATCH',
            identityMultiplicity: 'SINGLE',
            correspondence: 'EQUIVALENT' as const,
          },
        ],
      ],
      [
        'EQUIVALENT IDENTITY_CONVERGENCE',
        [
          {
            type: 'IDENTITY_CONVERGENCE',
            priorStrategy: 'NOMINATIM',
            identity: { provider: 'openstreetmap', externalId: 'osm:node:1' },
            correspondence: 'EQUIVALENT',
          },
        ],
      ],
      [
        'CATALOG_VERIFIED_HINT_MATCH + SINGLE',
        [
          {
            type: 'CATALOG_VERIFIED_HINT_MATCH',
            verifiedHintKey: 'recoleta cemetery',
            identityMultiplicity: 'SINGLE',
          },
        ],
      ],
      [
        'a corroborating OWN_QID match',
        [
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'OWN_QID',
            hintCorrespondence: 'EQUIVALENT',
            candidateCorrespondence: 'DECLARES_QID',
          },
        ],
      ],
    ])('%s with a contradiction is REJECTED', (_label, positive) => {
      expect(
        verifier.verify(
          { name: 'Recoleta Cemetery' },
          attempt([...positive, contradiction]),
        ),
      ).toEqual({ status: 'REJECTED' });
    });

    it('the same EXACT_NAME + SINGLE without a contradiction still VERIFIES', () => {
      expect(
        verifier.verify(
          { name: 'Recoleta Cemetery' },
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            destinationBounded,
          ]),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });
  });

  /**
   * RW4 contextual identity: the source's component-specific locality (and
   * stated kind) compared with the examined same-name pool.
   */
  describe('contextual correspondence and context contradictions', () => {
    const verifier = new IdentityVerifier();
    const contextual = (
      outcome:
        | 'DISTINGUISHED'
        | 'AMBIGUOUS'
        | 'NO_CONSISTENT_MEMBER'
        | 'INCOMPLETE_COMPARISON'
        | 'KIND_UNESTABLISHED',
    ) => ({
      type: 'CONTEXTUAL_CORRESPONDENCE' as const,
      assertion: 'LOCALITY' as const,
      locality: 'Lujan de Cuyo',
      coverage: 'PROVIDER_WINDOW_NOT_REACHED' as const,
      memberCount: 31,
      consistentCount: outcome === 'AMBIGUOUS' ? 2 : 1,
      outcome,
    });
    const wrongLocality = {
      type: 'IDENTITY_CONTRADICTION' as const,
      fact: 'LOCALITY' as const,
      assertedLocality: 'Lujan de Cuyo',
      boundaryId: 'osm:relation:1',
    };
    const settlement = {
      type: 'IDENTITY_CONTRADICTION' as const,
      fact: 'PHYSICAL_KIND' as const,
      assertedKind: 'ESTABLISHMENT' as const,
      candidateKind: 'SETTLEMENT' as const,
    };

    it.each(['MULTIPLE', 'UNKNOWN'] as const)(
      'DISTINGUISHED verifies without country-wide name uniqueness (exact name %s)',
      (multiplicity) => {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt(
              [
                { type: 'EXACT_NAME', identityMultiplicity: multiplicity },
                contextual('DISTINGUISHED'),
              ],
              multiplicity,
            ),
          ),
        ).toEqual({ status: 'VERIFIED' });
      },
    );

    it('AMBIGUOUS context overrides a provider-local unique name', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            contextual('AMBIGUOUS'),
          ]),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    it.each([
      'NO_CONSISTENT_MEMBER',
      'INCOMPLETE_COMPARISON',
      'KIND_UNESTABLISHED',
    ] as const)(
      '%s is not discriminating: a MULTIPLE pool stays AMBIGUOUS',
      (outcome) => {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt(
              [
                { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
                contextual(outcome),
              ],
              'MULTIPLE',
            ),
          ),
        ).toEqual({ status: 'AMBIGUOUS' });
      },
    );

    it.each([
      ['wrong asserted locality', wrongLocality],
      ['settlement for a stated establishment', settlement],
    ])(
      'a %s contradiction rejects even a provider-local unique exact name',
      (_label, contradiction) => {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt([
              { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
              contradiction,
            ]),
          ),
        ).toEqual({ status: 'REJECTED' });
      },
    );

    it('a contradiction outranks a DISTINGUISHED projection', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt([contextual('DISTINGUISHED'), settlement]),
        ),
      ).toEqual({ status: 'REJECTED' });
    });

    it('a NEARBY item matching a wrong homonym still never decides the pool', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt(
            [
              { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
              contextual('INCOMPLETE_COMPARISON'),
              {
                type: 'WIKIDATA_IDENTITY_MATCH',
                source: 'NEARBY',
                hintCorrespondence: 'EQUIVALENT',
                candidateCorrespondence: 'EQUIVALENT',
              },
            ],
            'MULTIPLE',
          ),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });
  });

  /**
   * Convergence provenance (2026-10-03). Two strategies reaching one strong
   * identity confirm that record; over a shared upstream (one OSM node
   * found by Overpass, Nominatim and Geoapify) that is never enough to
   * single out a member of a KNOWN name collision.
   */
  describe('convergence provenance and competitor examination (defects A, B, C)', () => {
    const verifier = new IdentityVerifier();
    const identity = {
      provider: 'openstreetmap',
      externalId: 'osm:node:4797394430',
    };
    const convergenceAt = (correspondence: NameCorrespondence) => ({
      type: 'IDENTITY_CONVERGENCE' as const,
      priorStrategy: 'NOMINATIM' as const,
      identity,
      correspondence,
    });
    // The strongest grade, so each test below isolates its own qualifier.
    const convergence = convergenceAt('EQUIVALENT');
    const provenance = (
      upstream:
        | 'SHARED_UPSTREAM'
        | 'INDEPENDENT_UPSTREAMS'
        | 'UNDETERMINED_UPSTREAM',
    ) => ({
      type: 'CONVERGENCE_PROVENANCE' as const,
      identity,
      upstream,
    });
    const examination = (
      outcome:
        | 'MATERIAL_COMPETITOR_KNOWN'
        | 'NO_MATERIAL_COMPETITOR'
        | 'NO_COMPETITOR_OBSERVED',
      competitorCount = outcome === 'MATERIAL_COMPETITOR_KNOWN' ? 1 : 0,
    ) => ({
      type: 'COMPETITOR_EXAMINATION' as const,
      outcome,
      examinedStrategies: ['NOMINATIM' as const, 'PLACES' as const],
      competitorCount,
    });
    const upstreams = [
      'SHARED_UPSTREAM',
      'INDEPENDENT_UPSTREAMS',
      'UNDETERMINED_UPSTREAM',
    ] as const;

    it.each(upstreams)(
      '%s EQUIVALENT convergence over an examined set with no material competitor VERIFIES',
      (upstream) => {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt([
              convergence,
              provenance(upstream),
              examination('NO_MATERIAL_COMPETITOR'),
              destinationBounded,
            ]),
          ),
        ).toEqual({ status: 'VERIFIED' });
      },
    );

    // RW1 El Zanjón / Farmacia shape: the hint only OVERLAPs (or does not
    // name) the converged record. Until RW4-ID-FALSE-VERIFY-2 every upstream
    // relation VERIFIED here; upstream independence never raises a
    // retrieval-grade match into identity.
    it.each(
      upstreams.flatMap((upstream) =>
        (['OVERLAP', 'NONE'] as const).map(
          (grade) => [upstream, grade] as const,
        ),
      ),
    )(
      '%s %s convergence over an examined set with no material competitor is INSUFFICIENT_EVIDENCE',
      (upstream, grade) => {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt([
              convergenceAt(grade),
              provenance(upstream),
              examination('NO_MATERIAL_COMPETITOR'),
              destinationBounded,
            ]),
          ),
        ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
      },
    );

    it.each(upstreams)(
      '%s convergence with NO_COMPETITOR_OBSERVED (partial pools) is not decisive: INSUFFICIENT_EVIDENCE',
      (upstream) => {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt([
              convergence,
              provenance(upstream),
              examination('NO_COMPETITOR_OBSERVED'),
            ]),
          ),
        ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
      },
    );

    it('missing provenance and missing examination: convergence alone is not decisive', () => {
      expect(
        verifier.verify({ name: 'Ojo de Agua' }, attempt([convergence])),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });

    it('UNKNOWN multiplicity (saturated window) plus convergence is not decisive', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt(
            [
              convergence,
              provenance('SHARED_UPSTREAM'),
              { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
              examination('NO_COMPETITOR_OBSERVED'),
            ],
            'UNKNOWN',
          ),
        ),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });

    it.each(upstreams)(
      '%s convergence never decides a known material competitor (defect C for independent upstreams)',
      (upstream) => {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt([
              convergence,
              provenance(upstream),
              examination('MATERIAL_COMPETITOR_KNOWN'),
            ]),
          ),
        ).toEqual({ status: 'AMBIGUOUS' });
      },
    );

    it('a provider-local SINGLE never outweighs a competitor another pool exposed (defect B)', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            examination('MATERIAL_COMPETITOR_KNOWN'),
          ]),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    it('a corroborating NEARBY item never outweighs a known competitor', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt([
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: 'NEARBY',
              hintCorrespondence: 'EQUIVALENT',
              candidateCorrespondence: 'EQUIVALENT',
            },
            examination('MATERIAL_COMPETITOR_KNOWN'),
          ]),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    it('discriminating source facts still decide among known competitors', () => {
      for (const discriminating of [
        {
          type: 'SOURCE_DECLARED_IDENTITY_MATCH' as const,
          identity: { provider: 'wikidata', externalId: 'Q1' },
        },
        { type: 'ADDRESS_MATCH' as const },
        {
          type: 'CONTEXTUAL_CORRESPONDENCE' as const,
          assertion: 'LOCALITY' as const,
          locality: 'Lujan de Cuyo',
          coverage: 'PROVIDER_WINDOW_NOT_REACHED' as const,
          memberCount: 31,
          consistentCount: 1,
          outcome: 'DISTINGUISHED' as const,
        },
      ]) {
        expect(
          verifier.verify(
            { name: 'Ojo de Agua' },
            attempt([
              discriminating,
              convergence,
              provenance('SHARED_UPSTREAM'),
              examination('MATERIAL_COMPETITOR_KNOWN', 30),
            ]),
          ),
        ).toEqual({ status: 'VERIFIED' });
      }
    });

    // Changed 2026-10-07 (RW4-ID-FALSE-VERIFY-1). This suite listed a
    // source-declared QID whose label the candidate's NAME matches among the
    // discriminating facts. It is not one: the candidate does not carry the
    // item, and a same-name competitor matches the label just as well. A
    // QID link (OWN_QID or OBSERVATION_QID) never skips a known material
    // competitor. A candidate that carries the source's QID is
    // SOURCE_DECLARED_IDENTITY_MATCH, which still decides (above).
    it('a source-declared QID linked to the candidate only by name does not decide among known competitors', () => {
      expect(
        verifier.decide(
          { name: 'Ojo de Agua' },
          attempt([
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: 'OBSERVATION_QID',
              hintCorrespondence: 'DECLARES_QID',
              candidateCorrespondence: 'EQUIVALENT',
            },
            convergence,
            provenance('SHARED_UPSTREAM'),
            examination('MATERIAL_COMPETITOR_KNOWN', 30),
          ]),
        ),
      ).toMatchObject({
        status: 'AMBIGUOUS',
        rule: 'MATERIAL_COMPETITOR_KNOWN',
      });
    });

    it('a single provider over an examined set verifies without a second dataset', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            examination('NO_MATERIAL_COMPETITOR'),
            destinationBounded,
          ]),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    it('a contradiction still outranks any convergence and any examination', () => {
      expect(
        verifier.verify(
          { name: 'Ojo de Agua' },
          attempt([
            convergence,
            provenance('INDEPENDENT_UPSTREAMS'),
            examination('NO_MATERIAL_COMPETITOR'),
            {
              type: 'IDENTITY_CONTRADICTION',
              fact: 'LOCALITY',
              assertedLocality: 'Lujan de Cuyo',
              boundaryId: 'osm:relation:1',
            },
          ]),
        ),
      ).toEqual({ status: 'REJECTED' });
    });

    it('a source/candidate QID conflict REJECTS a unique exact name over an examined set', () => {
      expect(
        verifier.verify(
          { name: 'Bodega Ejemplo' },
          attempt([
            {
              type: 'IDENTITY_CONTRADICTION',
              fact: 'WIKIDATA_QID',
              sourceQid: 'Q100',
              candidateQid: 'Q200',
            },
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            examination('NO_MATERIAL_COMPETITOR'),
          ]),
        ),
      ).toEqual({ status: 'REJECTED' });
    });
  });

  /**
   * RW4-ID-NEARBY-1 (2026-10-03). A NEARBY result is text matches of
   * labels found around the candidate's own point. Only one item naming
   * both texts corroborates; every other combination is NOT_CORROBORATED
   * and leaves the decision to the remaining evidence and the competitor
   * policy. A contradiction needs positive evidence of another identity
   * (a typed IDENTITY_CONTRADICTION).
   */
  describe('NEARBY non-corroboration is never a contradiction (RW4-ID-NEARBY-1)', () => {
    const verifier = new IdentityVerifier();
    const nearby = (hintMatched: boolean, candidateMatched: boolean) =>
      wikidataLink('NEARBY', hintMatched, candidateMatched);
    const examination = (
      outcome: 'MATERIAL_COMPETITOR_KNOWN' | 'NO_MATERIAL_COMPETITOR',
    ) => ({
      type: 'COMPETITOR_EXAMINATION' as const,
      outcome,
      examinedStrategies: ['LOCAL_OSM_POOL' as const, 'NOMINATIM' as const],
      competitorCount: outcome === 'MATERIAL_COMPETITOR_KNOWN' ? 1 : 0,
    });
    // A legitimate (EQUIVALENT) convergence: these tests are about NEARBY,
    // not about El Zanjón's own OVERLAP grade (see the RW1 El Zanjón tests).
    const convergence = {
      type: 'IDENTITY_CONVERGENCE' as const,
      priorStrategy: 'LOCAL_OSM_POOL' as const,
      identity: {
        provider: 'openstreetmap',
        externalId: 'osm:node:9953027884',
      },
      correspondence: 'EQUIVALENT' as const,
    };
    const qidConflict = {
      type: 'IDENTITY_CONTRADICTION' as const,
      fact: 'WIKIDATA_QID' as const,
      sourceQid: 'Q100',
      candidateQid: 'Q200',
    };
    const hint = { name: 'El Zanjón de Granados' };

    it.each([
      [true, false],
      [false, true],
      [false, false],
    ])(
      'NEARBY(hint=%s, candidate=%s) with no discriminating fact is INSUFFICIENT_EVIDENCE',
      (hintMatched, candidateMatched) => {
        expect(
          verifier.verify(
            hint,
            attempt([nearby(hintMatched, candidateMatched)], 'UNKNOWN'),
          ),
        ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
      },
    );

    it.each([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ])(
      'NEARBY(hint=%s, candidate=%s) with a material competitor known is AMBIGUOUS',
      (hintMatched, candidateMatched) => {
        expect(
          verifier.verify(
            hint,
            attempt([
              nearby(hintMatched, candidateMatched),
              examination('MATERIAL_COMPETITOR_KNOWN'),
            ]),
          ),
        ).toEqual({ status: 'AMBIGUOUS' });
      },
    );

    it('NEARBY(true, false) with a material competitor and convergence is still AMBIGUOUS', () => {
      expect(
        verifier.verify(
          hint,
          attempt([
            convergence,
            nearby(true, false),
            examination('MATERIAL_COMPETITOR_KNOWN'),
          ]),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });

    it('NEARBY(true, false) with convergence over a complete pool and no material competitor VERIFIES', () => {
      expect(
        verifier.verify(
          hint,
          attempt([
            convergence,
            nearby(true, false),
            examination('NO_MATERIAL_COMPETITOR'),
            destinationBounded,
          ]),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    it.each([
      [true, false],
      [false, true],
    ])(
      'NEARBY(hint=%s, candidate=%s) over a MULTIPLE exact-name pool stays AMBIGUOUS',
      (hintMatched, candidateMatched) => {
        expect(
          verifier.verify(
            hint,
            attempt(
              [
                { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
                nearby(hintMatched, candidateMatched),
              ],
              'MULTIPLE',
            ),
          ),
        ).toEqual({ status: 'AMBIGUOUS' });
      },
    );

    it('NEARBY(true, false) never outweighs EXACT_NAME + SINGLE', () => {
      expect(
        verifier.verify(
          hint,
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            nearby(true, false),
            destinationBounded,
          ]),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    it.each([
      [
        'EXACT_NAME + SINGLE',
        [
          {
            type: 'EXACT_NAME' as const,
            identityMultiplicity: 'SINGLE' as const,
          },
        ],
      ],
      [
        'convergence over an examined set',
        [convergence, examination('NO_MATERIAL_COMPETITOR')],
      ],
    ])('Wikidata unavailable keeps %s VERIFIED', (_label, positive) => {
      expect(
        verifier.verify(
          hint,
          attempt([
            ...positive,
            { type: 'WIKIDATA_UNAVAILABLE' },
            destinationBounded,
          ]),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    it.each([
      ['a corroborating NEARBY match', [nearby(true, true)]],
      ['a non-corroborating NEARBY match', [nearby(true, false)]],
      [
        'convergence over an examined set',
        [convergence, examination('NO_MATERIAL_COMPETITOR')],
      ],
      [
        'EXACT_NAME + SINGLE',
        [
          {
            type: 'EXACT_NAME' as const,
            identityMultiplicity: 'SINGLE' as const,
          },
        ],
      ],
    ])(
      'a source/candidate QID mismatch with %s is REJECTED',
      (_label, positive) => {
        expect(
          verifier.verify(hint, attempt([qidConflict, ...positive])),
        ).toEqual({ status: 'REJECTED' });
      },
    );

    it('an equal source/candidate QID keeps its positive correspondence despite a NEARBY non-match', () => {
      expect(
        verifier.verify(
          hint,
          attempt([
            {
              type: 'SOURCE_DECLARED_IDENTITY_MATCH',
              identity: { provider: 'wikidata', externalId: 'Q100' },
            },
            nearby(true, false),
          ]),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

    // Characterization, unchanged by RW4-ID-NEARBY-1: a candidate's own
    // QID whose labels do not name the hint (the only failing OWN_QID shape
    // the collector produces) and a source-declared QID the candidate's
    // name does not match stay REJECTED. They are label comparisons on an
    // item structurally linked to one side, not a typed QID contradiction;
    // see RW4-ID-QID-LABEL-1 in the regression matrix.
    it.each([
      ['OWN_QID' as const, false, true],
      ['OBSERVATION_QID' as const, true, false],
    ])(
      'a failing %s label match (hint=%s, candidate=%s) stays REJECTED',
      (source, hintMatched, candidateMatched) => {
        expect(
          verifier.verify(
            hint,
            attempt(
              [
                // OWN_QID's failing shape names no hint; OBSERVATION_QID's
                // names no candidate (the other side carries the item).
                {
                  ...wikidataLink(source, hintMatched, candidateMatched),
                  ...(source === 'OWN_QID'
                    ? { hintCorrespondence: 'NONE' as const }
                    : {}),
                },
              ],
              'UNKNOWN',
            ),
          ),
        ).toEqual({ status: 'REJECTED' });
      },
    );
  });

  /**
   * RW4-ID-CORRESPONDENCE-1 (2026-10-03 identity policy reassessment).
   *
   * Name uniqueness says that one record in an examined pool answers to the
   * hint text. It identifies the place the source meant only inside a
   * geography that is itself grounded: a bounded admission scope (the
   * request contract, P0.2) or the component's grounded source locality.
   * Uniqueness counted over a whole-country admission scope (§P2-18) is not
   * grounded: real data holds a lone wrong homonym when the true place is
   * missing (Overture's only AR "Ojo de Agua" is a Neuquén cabin; OSM has
   * no Alfa Crux, SuperUco or Luján restaurant record).
   */
  describe('geographic correspondence bounds name uniqueness (RW4-ID-CORRESPONDENCE-1)', () => {
    const verifier = new IdentityVerifier();
    const hint = { name: 'Ojo de Agua' };
    const correspondence = (
      basis:
        | 'BOUNDED_ADMISSION_SCOPE'
        | 'SOURCE_LOCALITY'
        | 'SOURCE_AREA'
        | 'ADMISSION_SCOPE_ONLY',
    ) => ({ type: 'GEOGRAPHIC_CORRESPONDENCE' as const, basis });
    const examined = {
      type: 'COMPETITOR_EXAMINATION' as const,
      outcome: 'NO_MATERIAL_COMPETITOR' as const,
      examinedStrategies: ['NOMINATIM' as const],
      competitorCount: 0,
    };
    const convergence = {
      type: 'IDENTITY_CONVERGENCE' as const,
      priorStrategy: 'NOMINATIM' as const,
      identity: { provider: 'openstreetmap', externalId: 'osm:node:1' },
      correspondence: 'EQUIVALENT' as const,
    };

    it.each([
      ['BOUNDED_ADMISSION_SCOPE' as const, 'VERIFIED'],
      ['SOURCE_LOCALITY' as const, 'VERIFIED'],
      ['SOURCE_AREA' as const, 'VERIFIED'],
      ['ADMISSION_SCOPE_ONLY' as const, 'INSUFFICIENT_EVIDENCE'],
    ])('EXACT_NAME SINGLE with correspondence %s -> %s', (basis, status) => {
      expect(
        verifier.verify(
          hint,
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            correspondence(basis),
          ]),
        ),
      ).toEqual({ status });
    });

    it('EXACT_NAME SINGLE with no correspondence fact is not decisive (fails closed, like defect A)', () => {
      expect(
        verifier.verify(
          hint,
          attempt([{ type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' }]),
        ),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });

    it.each([
      ['BOUNDED_ADMISSION_SCOPE' as const, 'VERIFIED'],
      ['SOURCE_LOCALITY' as const, 'VERIFIED'],
      ['SOURCE_AREA' as const, 'VERIFIED'],
      ['ADMISSION_SCOPE_ONLY' as const, 'INSUFFICIENT_EVIDENCE'],
    ])(
      'convergence over an examined competitor set with correspondence %s -> %s',
      (basis, status) => {
        expect(
          verifier.verify(
            hint,
            attempt(
              [convergence, examined, correspondence(basis)],
              'UNKNOWN',
              'UNKNOWN',
            ),
          ),
        ).toEqual({ status });
      },
    );

    it('a declared alias SINGLE over the country admission scope is not decisive', () => {
      expect(
        verifier.verify(
          hint,
          attempt(
            [
              {
                type: 'DECLARED_ALIAS_MATCH',
                identityMultiplicity: 'SINGLE',
                correspondence: 'EQUIVALENT' as const,
              },
              correspondence('ADMISSION_SCOPE_ONLY'),
            ],
            'UNKNOWN',
          ),
        ),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });

    it('a corroborating NEARBY item does not turn country-wide uniqueness into identity', () => {
      expect(
        verifier.verify(
          hint,
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: 'NEARBY',
              hintCorrespondence: 'EQUIVALENT',
              candidateCorrespondence: 'EQUIVALENT',
            },
            correspondence('ADMISSION_SCOPE_ONLY'),
          ]),
        ),
      ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    });

    it.each([
      [
        'a contextual locality that distinguishes the candidate',
        {
          type: 'CONTEXTUAL_CORRESPONDENCE' as const,
          assertion: 'LOCALITY' as const,
          locality: 'Luján de Cuyo',
          coverage: 'PROVIDER_WINDOW_NOT_REACHED' as const,
          memberCount: 31,
          consistentCount: 1,
          outcome: 'DISTINGUISHED' as const,
        },
      ],
      [
        'a source-declared QID the candidate carries',
        {
          type: 'SOURCE_DECLARED_IDENTITY_MATCH' as const,
          identity: { provider: 'wikidata', externalId: 'Q1' },
        },
      ],
      [
        'a source address the candidate matches',
        { type: 'ADDRESS_MATCH' as const },
      ],
      [
        "the candidate's own QID naming both sides",
        {
          type: 'WIKIDATA_IDENTITY_MATCH' as const,
          source: 'OWN_QID' as const,
          hintCorrespondence: 'EQUIVALENT',
          candidateCorrespondence: 'DECLARES_QID',
        },
      ],
      [
        'a verified hint memory',
        {
          type: 'CATALOG_VERIFIED_HINT_MATCH' as const,
          verifiedHintKey: 'ojo de agua',
          identityMultiplicity: 'SINGLE' as const,
        },
      ],
    ])(
      'discriminating evidence still decides beyond the destination: %s',
      (_label, fact) => {
        expect(
          verifier.verify(
            hint,
            attempt(
              [
                { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
                fact as ResolutionAttempt['evidence'][number],
                correspondence('ADMISSION_SCOPE_ONLY'),
              ],
              'UNKNOWN',
            ),
          ),
        ).toEqual({ status: 'VERIFIED' });
      },
    );

    it('a known competitor stays AMBIGUOUS and a contradiction stays REJECTED whatever the correspondence', () => {
      expect(
        verifier.verify(
          hint,
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            {
              type: 'COMPETITOR_EXAMINATION',
              outcome: 'MATERIAL_COMPETITOR_KNOWN',
              examinedStrategies: ['NOMINATIM'],
              competitorCount: 1,
            },
            correspondence('SOURCE_LOCALITY'),
          ]),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
      expect(
        verifier.verify(
          hint,
          attempt([
            { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
            {
              type: 'IDENTITY_CONTRADICTION',
              fact: 'LOCALITY',
              assertedLocality: 'Luján de Cuyo',
              boundaryId: 'osm:relation:1',
            },
            correspondence('BOUNDED_ADMISSION_SCOPE'),
          ]),
        ),
      ).toEqual({ status: 'REJECTED' });
    });

    it('EXACT_NAME MULTIPLE stays AMBIGUOUS over the country admission scope', () => {
      expect(
        verifier.verify(
          hint,
          attempt(
            [
              { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
              correspondence('ADMISSION_SCOPE_ONLY'),
            ],
            'MULTIPLE',
          ),
        ),
      ).toEqual({ status: 'AMBIGUOUS' });
    });
  });
});
