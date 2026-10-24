import {
  wikidataFactsToAdmissionSignals,
  wikidataFactsToAdmissionSignalEvidence,
  wikipediaArticleSitelinks,
  wikidataStructuredFactsToCanonicalEvidence,
} from './wikidata-admission-adapter';

const signalTypes = (
  facts: Parameters<typeof wikidataFactsToAdmissionSignals>[0],
) => wikidataFactsToAdmissionSignals(facts).map((signal) => signal.type);

describe('Wikidata facts → canonical admission signals', () => {
  it('maps a museum root class (Q33506) to decisive EXPLICIT_VISITOR_CLASSIFICATION', () => {
    expect(signalTypes({ instanceOf: ['Q33506'] })).toContain(
      'EXPLICIT_VISITOR_CLASSIFICATION',
    );
  });

  it('maps a heritage designation (P1435) to HERITAGE_DESIGNATION', () => {
    expect(signalTypes({ heritageDesignation: ['Q19903688'] })).toContain(
      'HERITAGE_DESIGNATION',
    );
  });

  it('maps sitelinks to ENCYCLOPEDIC_NOTABILITY only when present', () => {
    expect(signalTypes({ sitelinkCount: 9 })).toContain(
      'ENCYCLOPEDIC_NOTABILITY',
    );
    expect(signalTypes({ sitelinkCount: 0 })).not.toContain(
      'ENCYCLOPEDIC_NOTABILITY',
    );
    expect(signalTypes({})).not.toContain('ENCYCLOPEDIC_NOTABILITY');
  });

  it('produces no signals for a bare QID with no class, heritage or sitelinks', () => {
    expect(signalTypes({})).toEqual([]);
  });
});

describe('Wikidata structured statements → admission facts and typed prominence evidence', () => {
  const observedAt = new Date('2026-10-23T00:00:00Z');
  const item = (overrides: Record<string, unknown> = {}) => ({
    qid: 'Q10',
    instanceOf: [] as string[],
    heritageDesignations: [] as string[],
    coordinateLocations: [
      { latitude: -34.6037, longitude: -58.3816, precisionDegrees: 0.001 },
    ],
    sitelinks: [] as Array<{ site: string; url?: string }>,
    ...overrides,
  });

  it('a QID with no statements is identity only: no notability signal and no prominence fact', () => {
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        item(),
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        observedAt,
      ).admissionFacts,
    ).toEqual({
      instanceOf: [],
      heritageDesignation: [],
      sitelinkCount: 0,
    });
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        item(),
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        observedAt,
      ).prominenceEvidence,
    ).toEqual([]);
  });

  it('counts only language-Wikipedia article sitelinks, never other projects or URL-less links', () => {
    const facts = item({
      sitelinks: [
        { site: 'enwiki', url: 'https://en.wikipedia.org/wiki/A' },
        { site: 'eswiki', url: 'https://es.wikipedia.org/wiki/A' },
        { site: 'commonswiki', url: 'https://commons.wikimedia.org/wiki/A' },
        { site: 'eswikivoyage', url: 'https://es.wikivoyage.org/wiki/A' },
        { site: 'frwiki' },
      ],
    });
    expect(wikipediaArticleSitelinks(facts)).toEqual([
      { site: 'enwiki', languageCode: 'en' },
      { site: 'eswiki', languageCode: 'es' },
    ]);
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        facts,
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        observedAt,
      ).admissionFacts.sitelinkCount,
    ).toBe(2);
  });

  it('emits auditable sitelink, heritage and visitor-class facts with provenance', () => {
    const facts = item({
      instanceOf: ['Q33506', 'Q5'],
      heritageDesignations: ['Q900'],
      sitelinks: [{ site: 'eswiki', url: 'https://es.wikipedia.org/wiki/A' }],
    });
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        facts,
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        observedAt,
      ).prominenceEvidence,
    ).toEqual([
      {
        kind: 'ENCYCLOPEDIC_SITELINK_COUNT',
        sourceProvider: 'wikidata',
        providerIdentity: 'Q10',
        sourceRecordId: 'Q10',
        fieldPath: 'sitelinks',
        numericValue: 1,
        observedAt,
      },
      {
        kind: 'HERITAGE_DESIGNATION',
        sourceProvider: 'wikidata',
        providerIdentity: 'Q10',
        sourceRecordId: 'Q10',
        fieldPath: 'claims.P1435.Q900',
        designationLevel: 'Q900',
        heritageScope: 'UNSPECIFIED',
        observedAt,
      },
      {
        kind: 'EXPLICIT_VISITOR_CLASSIFICATION',
        sourceProvider: 'wikidata',
        providerIdentity: 'Q10',
        sourceRecordId: 'Q10',
        fieldPath: 'claims.P31.Q33506',
        textValue: 'Q33506',
        observedAt,
      },
    ]);
  });

  it('attributes each admission signal to the provider field it was read from', () => {
    expect(
      wikidataFactsToAdmissionSignalEvidence({
        instanceOf: ['Q33506'],
        heritageDesignation: ['Q900'],
        sitelinkCount: 3,
      }),
    ).toEqual([
      {
        signal: 'EXPLICIT_VISITOR_CLASSIFICATION',
        field: 'claims.P31',
        value: 'Q33506',
      },
      { signal: 'HERITAGE_DESIGNATION', field: 'claims.P1435', value: 'Q900' },
      { signal: 'ENCYCLOPEDIC_NOTABILITY', field: 'sitelinks', value: 3 },
    ]);
  });
});

describe('Wikidata heritage designations: scope', () => {
  const observedAt = new Date('2026-10-24T00:00:00Z');
  const scopes = (designations: string[]) =>
    wikidataStructuredFactsToCanonicalEvidence(
      {
        qid: 'Q1',
        instanceOf: [],
        heritageDesignations: designations,
        coordinateLocations: [
          { latitude: -34.6037, longitude: -58.3816, precisionDegrees: 0.001 },
        ],
        sitelinks: [],
      },
      { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
      observedAt,
    ).prominenceEvidence.map((fact) => [
      fact.designationLevel,
      fact.heritageScope,
    ]);

  it('marks the World Heritage Site designation as international and claims no scope for others', () => {
    expect(scopes(['Q9259', 'Q900'])).toEqual([
      ['Q9259', 'INTERNATIONAL'],
      ['Q900', 'UNSPECIFIED'],
    ]);
  });
});

describe('Wikidata structured statements → typed concept observations', () => {
  it('maps a heritage designation to the history theme and yields nothing for a bare QID', () => {
    const facts = (heritageDesignations: string[]) => ({
      qid: 'Q7',
      instanceOf: [] as string[],
      heritageDesignations,
      coordinateLocations: [
        { latitude: -34.6037, longitude: -58.3816, precisionDegrees: 0.001 },
      ],
      sitelinks: [{ site: 'eswiki', url: 'https://es.wikipedia.org/wiki/X' }],
    });
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        facts(['Q900']),
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        new Date('2026-10-24T00:00:00Z'),
      ).targetObservations,
    ).toEqual([
      {
        target: { dimension: 'theme', key: 'history' },
        observation: {
          sourceFactId: 'wikidata:Q7#P1435>theme:history',
          state: 'SATISFIES',
        },
      },
    ]);
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        facts([]),
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        new Date('2026-10-24T00:00:00Z'),
      ).targetObservations,
    ).toEqual([]);
  });
});

describe('Wikidata facts of an item that is not a physically located place', () => {
  const observedAt = new Date('2026-10-24T00:00:00Z');
  const subjectItem = {
    qid: 'Q8007',
    instanceOf: ['Q5'],
    heritageDesignations: ['Q900'],
    coordinateLocations: [] as Array<{
      latitude: number;
      longitude: number;
      precisionDegrees?: number;
    }>,
    sitelinks: [
      { site: 'enwiki', url: 'https://en.wikipedia.org/wiki/Subject' },
      { site: 'eswiki', url: 'https://es.wikipedia.org/wiki/Subject' },
    ],
  };

  it('yields no prominence evidence: its articles describe another entity, not the place', () => {
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        subjectItem,
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        observedAt,
      ).prominenceEvidence,
    ).toEqual([]);
  });

  it('yields no relevance observations either', () => {
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        subjectItem,
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        observedAt,
      ).targetObservations,
    ).toEqual([]);
  });

  it('still emits prominence for a physically located item', () => {
    expect(
      wikidataStructuredFactsToCanonicalEvidence(
        {
          ...subjectItem,
          coordinateLocations: [
            {
              latitude: -34.6037,
              longitude: -58.3816,
              precisionDegrees: 0.001,
            },
          ],
        },
        { kind: 'POINT', latitude: -34.6037, longitude: -58.3816 },
        observedAt,
      ).prominenceEvidence.map((fact) => fact.kind),
    ).toEqual(['ENCYCLOPEDIC_SITELINK_COUNT', 'HERITAGE_DESIGNATION']);
  });
});

describe('Wikidata linked facts require canonical spatial correspondence', () => {
  const observedAt = new Date('2026-10-24T00:00:00Z');
  const geoEntity = {
    kind: 'POINT' as const,
    latitude: -34.6037,
    longitude: -58.3816,
  };
  const linkedItem = (overrides: Record<string, unknown> = {}) => ({
    qid: 'Q100',
    instanceOf: ['Q33506'],
    heritageDesignations: ['Q900'],
    coordinateLocations: [
      { latitude: -34.6037, longitude: -58.3816, precisionDegrees: 0.001 },
    ],
    sitelinks: [{ site: 'eswiki', url: 'https://es.wikipedia.org/wiki/Place' }],
    ...overrides,
  });

  it('retains a person QID as link evidence without geographic semantics', () => {
    const result = wikidataStructuredFactsToCanonicalEvidence(
      linkedItem({
        instanceOf: ['Q5'],
        coordinateLocations: [],
      }),
      geoEntity,
      observedAt,
    );

    expect(result.spatialCorrespondence).toBe('UNKNOWN');
    expect(result.admissionFacts).toEqual({});
    expect(result.prominenceEvidence).toEqual([]);
    expect(result.targetObservations).toEqual([]);
  });

  it('keeps mapped linked semantics when spatial correspondence is consistent', () => {
    const result = wikidataStructuredFactsToCanonicalEvidence(
      linkedItem(),
      geoEntity,
      observedAt,
    );

    expect(result.spatialCorrespondence).toBe('CONSISTENT');
    expect(result.admissionFacts).toEqual({
      instanceOf: ['Q33506'],
      heritageDesignation: ['Q900'],
      sitelinkCount: 1,
    });
    expect(result.prominenceEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ENCYCLOPEDIC_SITELINK_COUNT' }),
      ]),
    );
    expect(result.targetObservations).toHaveLength(1);
  });

  it('ignores every linked semantic fact for a grossly conflicting location', () => {
    const result = wikidataStructuredFactsToCanonicalEvidence(
      linkedItem({
        coordinateLocations: [
          {
            latitude: 39.7392,
            longitude: -104.9903,
            precisionDegrees: 0.001,
          },
        ],
      }),
      geoEntity,
      observedAt,
    );

    expect(result.spatialCorrespondence).toBe('CONFLICTING');
    expect(result.admissionFacts).toEqual({});
    expect(result.prominenceEvidence).toEqual([]);
    expect(result.targetObservations).toEqual([]);
  });

  it('keeps missing P625 spatial evidence unknown rather than negative', () => {
    const result = wikidataStructuredFactsToCanonicalEvidence(
      linkedItem({ coordinateLocations: [] }),
      geoEntity,
      observedAt,
    );

    expect(result.spatialCorrespondence).toBe('UNKNOWN');
    expect(result.admissionFacts).toEqual({});
  });

  it('keeps a linked item with multiple distinct locations ambiguous', () => {
    const result = wikidataStructuredFactsToCanonicalEvidence(
      linkedItem({
        coordinateLocations: [
          { latitude: -34.6037, longitude: -58.3816, precisionDegrees: 0.001 },
          { latitude: 39.7392, longitude: -104.9903, precisionDegrees: 0.001 },
        ],
      }),
      geoEntity,
      observedAt,
    );

    expect(result.spatialCorrespondence).toBe('AMBIGUOUS');
    expect(result.admissionFacts).toEqual({});
    expect(result.prominenceEvidence).toEqual([]);
    expect(result.targetObservations).toEqual([]);
  });
});
