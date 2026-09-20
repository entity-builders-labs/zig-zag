import { EntityCandidate } from '../interfaces/experience-resolution.interface';
import { IdentityEvidenceCollector } from './identity-evidence-collector.service';
import { GeoEntityKind } from '@prisma/client';

const candidate = (
  overrides: Partial<EntityCandidate> = {},
): EntityCandidate => ({
  hintKey: 'place',
  hintName: 'Recoleta Cemetery',
  provider: 'openstreetmap',
  externalId: 'osm:way:1',
  canonicalName: 'Cementerio de la Recoleta',
  kind: GeoEntityKind.PLACE,
  role: 'venue',
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'SINGLE' },
  ...overrides,
});

describe('IdentityEvidenceCollector', () => {
  it('normalizes an own QID and translated aliases before policy evaluation', async () => {
    const collector = new IdentityEvidenceCollector({
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
      collector.collect(
        { name: 'Recoleta Cemetery' },
        candidate({ wikidataQid: 'Q1' }),
      ),
    ).resolves.toEqual([
      {
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'OWN_QID',
        hintMatched: true,
        candidateMatched: true,
      },
    ]);
  });

  it('requires both the hint and transient candidate to match an observation QID', async () => {
    const collector = new IdentityEvidenceCollector({
      getEntitySummaries: jest
        .fn()
        .mockResolvedValue(new Map([['Q1', { label: 'Recoleta Cemetery' }]])),
    } as any);

    await expect(
      collector.collect(
        { name: 'Recoleta Cemetery', evidenceKeys: ['ev-1'] },
        candidate({ canonicalName: 'Recoleta Hotel' }),
        [
          {
            evidenceKey: 'ev-1',
            canonicalIdentity: { wikidataQid: 'Q1' },
          } as any,
        ],
      ),
    ).resolves.toEqual([
      {
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'OBSERVATION_QID',
        hintMatched: true,
        candidateMatched: false,
      },
    ]);
  });

  it('keeps Wikidata transport failure explicitly insufficient', async () => {
    const collector = new IdentityEvidenceCollector({
      getEntitySummaries: jest.fn().mockRejectedValue(new Error('down')),
    } as any);

    await expect(
      collector.collect(
        { name: 'Recoleta Cemetery' },
        candidate({ wikidataQid: 'Q1' }),
      ),
    ).resolves.toEqual([{ type: 'WIKIDATA_UNAVAILABLE' }]);
  });

  it('corroborates when the same nearby Wikidata entity matches both hint and candidate', async () => {
    const collector = new IdentityEvidenceCollector({
      findNearbyPlaces: jest.fn().mockResolvedValue([
        {
          qid: 'Q1',
          label: 'Recoleta Cemetery',
          latitude: -34.587,
          longitude: -58.393,
        },
      ]),
    } as any);

    await expect(
      collector.collect(
        { name: 'Recoleta Cemetery' },
        candidate({
          canonicalName: 'Recoleta Cemetery',
          latitude: -34.587,
          longitude: -58.393,
        }),
      ),
    ).resolves.toEqual([
      {
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'NEARBY',
        hintMatched: true,
        candidateMatched: true,
      },
    ]);
  });

  it('produces hint=true, candidate=false when the nearby Wikidata entity matches the hint but not the candidate', async () => {
    const collector = new IdentityEvidenceCollector({
      findNearbyPlaces: jest.fn().mockResolvedValue([
        {
          qid: 'Q1',
          label: 'Recoleta Cemetery',
          latitude: -34.587,
          longitude: -58.393,
        },
      ]),
    } as any);

    await expect(
      collector.collect(
        { name: 'Recoleta Cemetery' },
        candidate({
          canonicalName: 'Hotel Urban Suites Recoleta',
          latitude: -34.587,
          longitude: -58.393,
        }),
      ),
    ).resolves.toEqual([
      {
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'NEARBY',
        hintMatched: true,
        candidateMatched: false,
      },
    ]);
  });

  it('never combines matches from two different nearby entities into both=true (entity A matches hint, entity B matches candidate)', async () => {
    const collector = new IdentityEvidenceCollector({
      findNearbyPlaces: jest.fn().mockResolvedValue([
        {
          qid: 'Q1',
          label: 'Recoleta Cemetery',
          latitude: -34.587,
          longitude: -58.393,
        },
        {
          qid: 'Q2',
          label: 'Hotel Urban Suites Recoleta',
          latitude: -34.587,
          longitude: -58.393,
        },
      ]),
    } as any);

    await expect(
      collector.collect(
        { name: 'Recoleta Cemetery' },
        candidate({
          canonicalName: 'Hotel Urban Suites Recoleta',
          latitude: -34.587,
          longitude: -58.393,
        }),
      ),
    ).resolves.toEqual([
      {
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'NEARBY',
        hintMatched: true,
        candidateMatched: false,
      },
    ]);
  });
});
