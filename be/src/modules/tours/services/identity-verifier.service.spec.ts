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
});
