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

  /**
   * Real spike evidence (spikes/stage3-santelmo-composite-geoapify-control-
   * 2026-09-23): the OSM way for "Defensa" street declares its own
   * wikidata=Qxxxx tag (OWN_QID -- a direct, provider-declared structural
   * cross-reference, not a proximity guess). The extractor's hint text
   * ("Defensa Street") carries an English generic-type suffix the Spanish
   * Wikidata label doesn't have, so the existing 100%-token bar rejects a
   * real, already-uniquely-identified street. Scoped to ROUTE candidates
   * only -- see the negative PLACE test right below, which proves this does
   * NOT reopen the "Recoleta Cemetery" -> unrelated hotel collision class.
   */
  it('matches an OWN_QID hint permissively for a ROUTE candidate (cross-language / generic-suffix tolerant), unlike the stricter NEARBY bar', async () => {
    const collector = new IdentityEvidenceCollector({
      getEntitySummaries: jest
        .fn()
        .mockResolvedValue(new Map([['Q1', { label: 'Defensa' }]])),
    } as any);

    await expect(
      collector.collect(
        { name: 'Defensa Street' },
        candidate({
          canonicalName: 'Defensa',
          wikidataQid: 'Q1',
          kind: GeoEntityKind.ROUTE,
        }),
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

  /**
   * The permissive bar must stay scoped to ROUTE. A PLACE/venue OWN_QID
   * keeps the strict 100%-token bar -- two different real venues can
   * legitimately share one specific token (a neighborhood name), which is
   * exactly the collision class requireAllTokens was introduced to prevent
   * (see experience-proposal-resolver.service.spec.ts's "Recoleta Cemetery"
   * -> "Hotel Urban Suites Recoleta" regression test).
   */
  it('keeps the strict 100%-token bar for a PLACE/venue OWN_QID (does not reopen the Recoleta-style collision)', async () => {
    const collector = new IdentityEvidenceCollector({
      getEntitySummaries: jest.fn().mockResolvedValue(
        new Map([
          [
            'Q999',
            {
              label: 'Urban Suites Recoleta',
              aliases: ['Hotel Urban Suites Recoleta'],
            },
          ],
        ]),
      ),
    } as any);

    await expect(
      collector.collect(
        { name: 'Recoleta Cemetery' },
        candidate({
          canonicalName: 'Hotel Urban Suites Recoleta',
          wikidataQid: 'Q999',
          kind: GeoEntityKind.PLACE,
        }),
      ),
    ).resolves.toEqual([
      {
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'OWN_QID',
        hintMatched: false,
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
