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
          {
            type: 'IDENTITY_CONVERGENCE',
            priorStrategy: 'LOCAL_OSM_POOL',
            identity: {
              provider: 'openstreetmap',
              externalId: 'osm:node:9953027884',
            },
          },
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
          {
            type: 'IDENTITY_CONVERGENCE',
            priorStrategy: 'LOCAL_OSM_POOL',
            identity: {
              provider: 'openstreetmap',
              externalId: 'osm:node:9953027884',
            },
          },
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
              hintMatched: true,
              candidateMatched: true,
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
    ): ResolutionAttempt['evidence'][number] => ({
      type: 'WIKIDATA_IDENTITY_MATCH',
      source: 'NEARBY',
      hintMatched,
      candidateMatched,
    });
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

    // Only a published COMPLETE_COUNTRY snapshot may establish uniqueness;
    // then the existing EXACT_NAME + SINGLE rule applies unchanged.
    it('Alfa Crux verifies only once complete-country uniqueness is established', () => {
      expect(
        verifier.verify(
          { name: 'Alfa Crux' },
          overtureAttempt(
            'Alfa Crux',
            [{ type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' }],
            'SINGLE',
          ),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });

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
                {
                  type: 'WIKIDATA_IDENTITY_MATCH',
                  source,
                  hintMatched: true,
                  candidateMatched: true,
                },
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

    // A Wikidata item matching only the hint (or only the candidate) near
    // the candidate is positive evidence of a different identity there.
    it.each([
      [true, false],
      [false, true],
    ])(
      'a partial nearby Wikidata match (hint=%s, candidate=%s) stays REJECTED',
      (hintMatched, candidateMatched) => {
        expect(
          verifier.verify(
            { name: 'Recoleta Cemetery' },
            attempt([nearby(hintMatched, candidateMatched)], 'UNKNOWN'),
          ),
        ).toEqual({ status: 'REJECTED' });
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
        [{ type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'SINGLE' }],
      ],
      [
        'IDENTITY_CONVERGENCE',
        [
          {
            type: 'IDENTITY_CONVERGENCE',
            priorStrategy: 'NOMINATIM',
            identity: { provider: 'openstreetmap', externalId: 'osm:node:1' },
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
            hintMatched: true,
            candidateMatched: true,
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
          attempt([{ type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' }]),
        ),
      ).toEqual({ status: 'VERIFIED' });
    });
  });
});
