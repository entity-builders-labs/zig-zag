import {
  ADMISSION_SIGNAL_STRENGTHS,
  admissionSignal,
  AdmissionExclusionClass,
  AdmissionSignalType,
  evaluateAdmissionRule,
  isExclusionOverridable,
} from './structured-admission-policy';

describe('structured admission policy (design C6/C7)', () => {
  it('assigns decisive strength only to the three decisive signal types', () => {
    expect(ADMISSION_SIGNAL_STRENGTHS.EXPLICIT_VISITOR_CLASSIFICATION).toBe(
      'decisive',
    );
    expect(ADMISSION_SIGNAL_STRENGTHS.HISTORIC_CLASSIFICATION).toBe('decisive');
    expect(ADMISSION_SIGNAL_STRENGTHS.HERITAGE_DESIGNATION).toBe('decisive');
    expect(ADMISSION_SIGNAL_STRENGTHS.VISITABLE_PLACE_CLASS).toBe('supporting');
    expect(ADMISSION_SIGNAL_STRENGTHS.ENCYCLOPEDIC_NOTABILITY).toBe(
      'supporting',
    );
    expect(ADMISSION_SIGNAL_STRENGTHS.PROVIDER_PROMINENCE).toBe('supporting');
  });

  it('marks only service/infrastructure/accommodation exclusions overridable', () => {
    expect(isExclusionOverridable('TRANSPORT_SERVICE')).toBe(true);
    expect(isExclusionOverridable('TECHNICAL_INFRASTRUCTURE')).toBe(true);
    expect(isExclusionOverridable('ACCOMMODATION')).toBe(true);
    expect(isExclusionOverridable('ADMINISTRATIVE_OR_LOCALITY')).toBe(false);
    expect(isExclusionOverridable('ROAD_OR_ROUTE')).toBe(false);
    expect(isExclusionOverridable('INFORMATION_OR_SIGNAGE')).toBe(false);
    expect(isExclusionOverridable('SUB_FEATURE')).toBe(false);
  });

  const s = (
    types: AdmissionSignalType[],
    exclusions: AdmissionExclusionClass[] = [],
  ) => evaluateAdmissionRule(types.map(admissionSignal), exclusions);

  it('admits a decisive signal on its own', () => {
    expect(s(['EXPLICIT_VISITOR_CLASSIFICATION']).admitted).toBe(true);
    expect(s(['HISTORIC_CLASSIFICATION']).admitted).toBe(true);
    expect(s(['HERITAGE_DESIGNATION']).admitted).toBe(true);
  });

  it('a decisive signal admits over an overridable exclusion (heritage station)', () => {
    expect(s(['HERITAGE_DESIGNATION'], ['TRANSPORT_SERVICE']).admitted).toBe(
      true,
    );
  });

  it('a non-overridable exclusion always rejects, even with a decisive signal', () => {
    const decision = s(['EXPLICIT_VISITOR_CLASSIFICATION'], ['ROAD_OR_ROUTE']);
    expect(decision).toEqual({
      admitted: false,
      reason: 'EXCLUDED_CATEGORY',
    });
  });

  it('a visitable class plus encyclopedic notability admits (notable stadium)', () => {
    expect(
      s(['VISITABLE_PLACE_CLASS', 'ENCYCLOPEDIC_NOTABILITY']).admitted,
    ).toBe(true);
  });

  it('a visitable class plus provider prominence admits', () => {
    expect(s(['VISITABLE_PLACE_CLASS', 'PROVIDER_PROMINENCE']).admitted).toBe(
      true,
    );
  });

  it('a bare visitable class without notability is insufficient (ordinary park)', () => {
    expect(s(['VISITABLE_PLACE_CLASS'])).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });

  it('an overridable exclusion without a decisive signal rejects', () => {
    expect(s([], ['ACCOMMODATION'])).toEqual({
      admitted: false,
      reason: 'EXCLUDED_CATEGORY',
    });
  });

  it('no signals rejects with INSUFFICIENT_ADMISSION_EVIDENCE', () => {
    expect(s([])).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });
});
