import {
  compareProminence,
  ProminenceEvidenceFact,
  prominenceProfile,
  STRUCTURED_PROMINENCE_POLICY_VERSION,
  unknownProminenceProfile,
} from './structured-prominence.policy';

const observedAt = new Date('2026-10-23T00:00:00Z');
const fact = (
  kind: ProminenceEvidenceFact['kind'],
  extra: Partial<ProminenceEvidenceFact> = {},
): ProminenceEvidenceFact => ({
  kind,
  sourceProvider: 'provider-a',
  providerIdentity: 'item-1',
  sourceRecordId: 'record-1',
  fieldPath: 'field',
  observedAt,
  ...extra,
});
const sitelinks = (count: number, record = 'record-1') =>
  fact('ENCYCLOPEDIC_SITELINK_COUNT', {
    numericValue: count,
    sourceRecordId: record,
  });
const heritage = (
  heritageScope: ProminenceEvidenceFact['heritageScope'] = 'UNSPECIFIED',
) =>
  fact('HERITAGE_DESIGNATION', {
    designationLevel: `designation-${heritageScope}`,
    heritageScope,
  });
const visitorClass = () =>
  fact('EXPLICIT_VISITOR_CLASSIFICATION', { textValue: 'class-x' });

describe('structured prominence profile and lexicographic ordering', () => {
  it('projects absent evidence as UNKNOWN at every level, versioned', () => {
    expect(unknownProminenceProfile()).toEqual({
      policyVersion: STRUCTURED_PROMINENCE_POLICY_VERSION,
      heritageDesignation: { status: 'UNKNOWN' },
      explicitVisitorClassification: { status: 'UNKNOWN' },
      providerProminence: { status: 'UNKNOWN' },
      encyclopedicSitelinks: { status: 'UNKNOWN' },
    });
  });

  it('keeps typed evidence references and takes the strongest sitelink count without summing items', () => {
    const profile = prominenceProfile([sitelinks(4, 'b'), sitelinks(9, 'a')]);
    expect(profile.encyclopedicSitelinks).toEqual({
      status: 'KNOWN',
      count: 9,
      refs: [
        {
          kind: 'ENCYCLOPEDIC_SITELINK_COUNT',
          source: 'provider-a:a',
          field: 'field',
          value: 9,
        },
        {
          kind: 'ENCYCLOPEDIC_SITELINK_COUNT',
          source: 'provider-a:b',
          field: 'field',
          value: 4,
        },
      ],
    });
  });

  it('known positive evidence outranks UNKNOWN when higher levels are equal', () => {
    const known = prominenceProfile([sitelinks(3)]);
    const unknown = unknownProminenceProfile();
    expect(compareProminence(known, unknown)).toEqual({
      order: -3,
      decidingLevel: 'ENCYCLOPEDIC_SITELINKS',
    });
    expect(compareProminence(unknown, known).order).toBeGreaterThan(0);
  });

  it('never places UNKNOWN below a known zero: both lack positive evidence and tie', () => {
    const knownZero = prominenceProfile([sitelinks(0)]);
    expect(knownZero.encyclopedicSitelinks).toEqual({ status: 'UNKNOWN' });
    expect(compareProminence(knownZero, unknownProminenceProfile())).toEqual({
      order: 0,
    });
  });

  it('does not let a heritage designation of unspecified, subnational or national scope beat stronger encyclopedic notability', () => {
    for (const scope of ['UNSPECIFIED', 'SUBNATIONAL', 'NATIONAL'] as const) {
      expect(
        compareProminence(
          prominenceProfile([heritage(scope), sitelinks(4)]),
          prominenceProfile([sitelinks(30)]),
        ),
      ).toEqual({ order: 26, decidingLevel: 'ENCYCLOPEDIC_SITELINKS' });
    }
  });

  it('keeps an international-scope designation ahead of any sitelink count', () => {
    expect(
      compareProminence(
        prominenceProfile([heritage('INTERNATIONAL')]),
        prominenceProfile([sitelinks(90)]),
      ),
    ).toEqual({ order: -1, decidingLevel: 'INTERNATIONAL_HERITAGE' });
  });

  it('uses heritage scope to separate candidates with equal encyclopedic notability', () => {
    expect(
      compareProminence(
        prominenceProfile([heritage('NATIONAL'), sitelinks(5)]),
        prominenceProfile([heritage('SUBNATIONAL'), sitelinks(5)]),
      ),
    ).toEqual({ order: -1, decidingLevel: 'HERITAGE_SCOPE' });
    expect(
      compareProminence(
        prominenceProfile([heritage('UNSPECIFIED'), sitelinks(5)]),
        prominenceProfile([sitelinks(5)]),
      ),
    ).toEqual({ order: -1, decidingLevel: 'HERITAGE_SCOPE' });
  });

  it('treats an unspecified-scope designation as equal to a subnational one', () => {
    expect(
      compareProminence(
        prominenceProfile([heritage('UNSPECIFIED')]),
        prominenceProfile([heritage('SUBNATIONAL')]),
      ),
    ).toEqual({ order: 0 });
  });

  it('orders visitor classification after heritage scope and before identity', () => {
    expect(
      compareProminence(
        prominenceProfile([visitorClass()]),
        unknownProminenceProfile(),
      ),
    ).toEqual({ order: -1, decidingLevel: 'EXPLICIT_VISITOR_CLASSIFICATION' });
    expect(
      compareProminence(
        prominenceProfile([heritage('SUBNATIONAL')]),
        prominenceProfile([visitorClass()]),
      ).decidingLevel,
    ).toBe('HERITAGE_SCOPE');
  });

  it('records the strongest heritage scope with every designation reference', () => {
    expect(
      prominenceProfile([heritage('SUBNATIONAL'), heritage('NATIONAL')])
        .heritageDesignation,
    ).toMatchObject({ status: 'KNOWN', strongestScope: 'NATIONAL' });
  });
});
