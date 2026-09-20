import { ResolutionAttempt } from '../interfaces/experience-resolution.interface';
import { IdentityVerifier } from './identity-verifier.service';

const attempt = (
  canonicalName: string,
  evidence: ResolutionAttempt['evidence'],
): ResolutionAttempt =>
  ({
    strategy: 'PLACES',
    candidate: {
      hintKey: 'place',
      hintName: 'hint',
      provider: 'google_places',
      canonicalName,
      role: 'venue',
      persistence: {
        name: canonicalName,
        kind: 'PLACE' as any,
        provider: 'google_places',
        externalId: 'place-1',
      },
    },
    evidence,
  }) as ResolutionAttempt;

describe('IdentityVerifier', () => {
  it('rejects a candidate that only shares half of an observation QID identity', async () => {
    const verifier = new IdentityVerifier();

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt('Recoleta Hotel', [
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
        attempt('Cementerio de la Recoleta', [
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
        attempt('Recoleta Cemetery', [
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
        attempt('Recoleta Hotel', [
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
        attempt('Recoleta Cemetery', [{ type: 'WIKIDATA_UNAVAILABLE' }]),
      ),
    ).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });
});
