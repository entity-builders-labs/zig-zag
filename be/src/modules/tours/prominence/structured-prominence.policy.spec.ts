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
const heritage = () =>
  fact('HERITAGE_DESIGNATION', { designationLevel: 'level-x' });
const visitorClass = () =>
  fact('EXPLICIT_VISITOR_CLASSIFICATION', { textValue: 'class-x' });

describe('structured prominence policy (design C17, tasks 39.3/39.4)', () => {
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

  it('compares levels lexicographically: heritage, then visitor class, then sitelinks', () => {
    const heritageOnly = prominenceProfile([heritage()]);
    const visitorWithManyLinks = prominenceProfile([
      visitorClass(),
      sitelinks(80),
    ]);
    expect(compareProminence(heritageOnly, visitorWithManyLinks)).toEqual({
      order: -1,
      decidingLevel: 'HERITAGE_DESIGNATION',
    });
    expect(
      compareProminence(
        prominenceProfile([visitorClass()]),
        prominenceProfile([sitelinks(80)]),
      ).decidingLevel,
    ).toBe('EXPLICIT_VISITOR_CLASSIFICATION');
    expect(
      compareProminence(
        prominenceProfile([sitelinks(12)]),
        prominenceProfile([sitelinks(5)]),
      ),
    ).toEqual({ order: -7, decidingLevel: 'ENCYCLOPEDIC_SITELINKS' });
  });

  it('heritage values from different sources are not compared: presence only in v1', () => {
    expect(
      compareProminence(
        prominenceProfile([
          fact('HERITAGE_DESIGNATION', { designationLevel: '1' }),
        ]),
        prominenceProfile([
          fact('HERITAGE_DESIGNATION', {
            designationLevel: '4',
            sourceProvider: 'provider-b',
          }),
        ]),
      ),
    ).toEqual({ order: 0 });
  });
});
