import {
  wikidataFactsToAdmissionSignals,
  wikidataFactsToAdmissionSignalEvidence,
  wikidataStructuredFactsToAdmissionFacts,
  wikidataStructuredFactsToProminenceEvidence,
  wikipediaArticleSitelinks,
} from './wikidata-admission-adapter';

const signalTypes = (
  facts: Parameters<typeof wikidataFactsToAdmissionSignals>[0],
) => wikidataFactsToAdmissionSignals(facts).map((signal) => signal.type);

describe('Wikidata admission adapter (task 37.1)', () => {
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

describe('Wikidata structured facts → admission and prominence (task 39.3)', () => {
  const observedAt = new Date('2026-10-23T00:00:00Z');
  const item = (overrides: Record<string, unknown> = {}) => ({
    qid: 'Q10',
    instanceOf: [] as string[],
    heritageDesignations: [] as string[],
    sitelinks: [] as Array<{ site: string; url?: string }>,
    ...overrides,
  });

  it('a QID with no statements is identity only: no notability signal and no prominence fact', () => {
    expect(wikidataStructuredFactsToAdmissionFacts(item())).toEqual({
      instanceOf: [],
      heritageDesignation: [],
      sitelinkCount: 0,
    });
    expect(
      wikidataStructuredFactsToProminenceEvidence(item(), observedAt),
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
    expect(wikidataStructuredFactsToAdmissionFacts(facts).sitelinkCount).toBe(
      2,
    );
  });

  it('emits auditable sitelink, heritage and visitor-class facts with provenance', () => {
    const facts = item({
      instanceOf: ['Q33506', 'Q5'],
      heritageDesignations: ['Q900'],
      sitelinks: [{ site: 'eswiki', url: 'https://es.wikipedia.org/wiki/A' }],
    });
    expect(
      wikidataStructuredFactsToProminenceEvidence(facts, observedAt),
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
