import {
  IdentityMultiplicity,
  ResolutionAttempt,
} from '../interfaces/experience-resolution.interface';
import { IdentityVerifier } from './identity-verifier.service';
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

describe('IdentityVerifier', () => {
  /**
   * ID-based identity evidence, not string matching: a different,
   * structurally independent acquisition strategy already returned this
   * exact same (provider, externalId) for this hint (real spike case: "El
   * Zanjón de Granados" -- LOCAL_OSM_POOL and NOMINATIM both independently
   * acquired osm:node:9953027884). Verified regardless of any name-based
   * evidence, and even when Wikidata itself would separately reject the
   * candidate on a string basis.
   */
  it('verifies immediately on IDENTITY_CONVERGENCE, with no other evidence needed', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'El Zanjón de Granados' },
        attempt([
          { type: 'IDENTITY_CONVERGENCE', priorStrategy: 'LOCAL_OSM_POOL' },
        ]),
      ),
    ).toEqual({ status: 'VERIFIED' });
  });

  it('IDENTITY_CONVERGENCE overrides an otherwise-rejecting WIKIDATA_IDENTITY_MATCH', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'El Zanjón de Granados' },
        attempt([
          { type: 'IDENTITY_CONVERGENCE', priorStrategy: 'LOCAL_OSM_POOL' },
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'NEARBY',
            hintMatched: true,
            candidateMatched: false,
          },
        ]),
      ),
    ).toEqual({ status: 'VERIFIED' });
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
            hintMatched: true,
            candidateMatched: false,
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
            hintMatched: true,
            candidateMatched: true,
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
            hintMatched: true,
            candidateMatched: true,
          },
        ]),
      ),
    ).toEqual({ status: 'VERIFIED' });
  });

  it('rejects a nearby Wikidata match when the candidate only shares half its tokens', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt([
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'NEARBY',
            hintMatched: true,
            candidateMatched: false,
          },
        ]),
      ),
    ).toEqual({ status: 'REJECTED' });
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
      attempt([{ type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' }]),
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
          hintMatched: true,
          candidateMatched: true,
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
        { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'SINGLE' },
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
        { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'MULTIPLE' },
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
        { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'UNKNOWN' },
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
          hintMatched: true,
          candidateMatched: false,
        },
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
          hintMatched: true,
          candidateMatched: false,
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
    // not contradiction" section (§6) are written against. Freezing it here
    // does not imply the REJECTED outcome is correct.
    it('Case A: El Zanjón de Granados — real acquisition-path convergence on osm:node:9953027884 still REJECTED by a non-corroborating Wikidata NEARBY match', async () => {
      const verifier = new IdentityVerifier();
      const zanjonHint = { name: 'El Zanjón de Granados' };
      const nonCorroboratingNearbyMatch: ResolutionAttempt['evidence'] = [
        {
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'NEARBY',
          hintMatched: true,
          candidateMatched: false,
        },
      ];

      // Same real externalId (osm:node:9953027884), three independent
      // acquisition strategies, three identical rejections.
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
        expect(result).toEqual({ status: 'REJECTED' });
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
        attempt([{ type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' }]),
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
              hintMatched: false,
              candidateMatched: false,
            },
          ],
          'MULTIPLE',
        ),
      );
      expect(result).toEqual({ status: 'AMBIGUOUS' });
    });

    // Non-regression: when Wikidata DOES positively corroborate (both hint
    // and candidate match), that resolves WHICH of the multiple pool
    // candidates is meant -- this must stay VERIFIED, not be downgraded to
    // AMBIGUOUS merely because the local pool also happened to contain other
    // same-named candidates.
    it('Case F: EXACT_NAME MULTIPLE stays VERIFIED when Wikidata positively corroborates (disambiguates which candidate is meant)', async () => {
      const verifier = new IdentityVerifier();
      const result = await verifier.verify(
        { name: 'Nuestra Señora de Belén' },
        attempt(
          [
            { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: 'NEARBY',
              hintMatched: true,
              candidateMatched: true,
            },
          ],
          'MULTIPLE',
        ),
      );
      expect(result).toEqual({ status: 'VERIFIED' });
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
});
