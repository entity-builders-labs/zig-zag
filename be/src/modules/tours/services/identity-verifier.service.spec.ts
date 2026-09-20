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
      status: 'resolved',
    },
    evidence,
  }) as ResolutionAttempt;

describe('IdentityVerifier', () => {
  it('rejects a candidate that only shares half of an observation QID identity', async () => {
    const verifier = new IdentityVerifier({
      getEntitySummaries: jest.fn().mockResolvedValue(
        new Map([
          [
            'Q1',
            {
              label: 'Recoleta Cemetery',
              aliases: ['Cementerio de la Recoleta'],
            },
          ],
        ]),
      ),
    } as any);

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt('Recoleta Hotel', [
          { type: 'OBSERVATION_WIKIDATA_QID', qid: 'Q1' },
        ]),
      ),
    ).resolves.toEqual({ status: 'REJECTED' });
  });

  it('verifies independent translated aliases of the same observation QID', async () => {
    const verifier = new IdentityVerifier({
      getEntitySummaries: jest.fn().mockResolvedValue(
        new Map([
          [
            'Q1',
            {
              label: 'Recoleta Cemetery',
              aliases: ['Cementerio de la Recoleta'],
            },
          ],
        ]),
      ),
    } as any);

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt('Cementerio de la Recoleta', [
          { type: 'OBSERVATION_WIKIDATA_QID', qid: 'Q1' },
        ]),
      ),
    ).resolves.toEqual({ status: 'VERIFIED' });
  });

  it('keeps a correct observation-QID confirmation verified', async () => {
    const verifier = new IdentityVerifier({
      getEntitySummaries: jest
        .fn()
        .mockResolvedValue(new Map([['Q1', { label: 'Recoleta Cemetery' }]])),
    } as any);

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt('Recoleta Cemetery', [
          { type: 'OBSERVATION_WIKIDATA_QID', qid: 'Q1' },
        ]),
      ),
    ).resolves.toEqual({ status: 'VERIFIED' });
  });

  it('rejects a nearby Wikidata match when the candidate only shares half its tokens', async () => {
    const verifier = new IdentityVerifier({
      findNearbyPlaces: jest
        .fn()
        .mockResolvedValue([{ qid: 'Q1', label: 'Recoleta Cemetery' }]),
    } as any);

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt('Recoleta Hotel', [
          { type: 'CANDIDATE_COORDINATES', latitude: -34.58, longitude: -58.4 },
        ]),
      ),
    ).resolves.toEqual({ status: 'REJECTED' });
  });

  it('returns insufficient evidence when Wikidata is unavailable', async () => {
    const verifier = new IdentityVerifier({
      getEntitySummaries: jest.fn().mockRejectedValue(new Error('down')),
    } as any);

    await expect(
      verifier.verify(
        { name: 'Recoleta Cemetery' },
        attempt('Recoleta Cemetery', [
          { type: 'OBSERVATION_WIKIDATA_QID', qid: 'Q1' },
        ]),
      ),
    ).resolves.toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
  });
});
