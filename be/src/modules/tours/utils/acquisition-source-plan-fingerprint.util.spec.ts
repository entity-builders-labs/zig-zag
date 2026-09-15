import {
  acquisitionSourcePlanFingerprint,
  AcquisitionExecutionLedger,
} from './acquisition-source-plan-fingerprint.util';
import {
  ExperienceAcquisitionPlan,
  SourcePlan,
} from '../interfaces/experience-acquisition-plan.interface';

const plan = (query: string): ExperienceAcquisitionPlan => ({
  destination: { destinationName: 'Buenos Aires' },
  deficits: [
    {
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'walk',
      reason: 'gap',
    },
  ],
  evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
  breadth: 'focused',
  sourcePlans: [{ provider: 'web', web: { query } }],
});

describe('acquisitionSourcePlanFingerprint', () => {
  it('is stable for equivalent plans and excludes pass identity', () => {
    const first = acquisitionSourcePlanFingerprint(plan('Buenos Aires walks'));
    const second = acquisitionSourcePlanFingerprint(
      plan(' Buenos Aires walks '),
    );
    expect(first).toBe(second);
    expect(first).not.toContain('passNumber');
  });

  it('changes when a material source-plan field changes', () => {
    expect(
      acquisitionSourcePlanFingerprint(plan('Buenos Aires walks')),
    ).not.toBe(
      acquisitionSourcePlanFingerprint(plan('Buenos Aires history walks')),
    );
  });

  it('supports request-scoped duplicate execution tracking', () => {
    const ledger: AcquisitionExecutionLedger = {
      executedSourcePlanFingerprints: new Set(),
    };
    const fingerprint = acquisitionSourcePlanFingerprint(
      plan('Buenos Aires walks'),
    );
    expect(ledger.executedSourcePlanFingerprints.has(fingerprint)).toBe(false);
    ledger.executedSourcePlanFingerprints.add(fingerprint);
    expect(ledger.executedSourcePlanFingerprints.has(fingerprint)).toBe(true);
  });

  it('deduplicates individual source plans when a later pass changes only another source', () => {
    const wikivoyage: SourcePlan = {
      provider: 'wikivoyage',
      wikivoyage: { sections: ['SEE'], articleTargets: ['Buenos Aires'] },
    };
    const firstPass = [
      wikivoyage,
      { provider: 'web', web: { query: 'A' } } as SourcePlan,
    ];
    const secondPass = [
      wikivoyage,
      { provider: 'web', web: { query: 'B' } } as SourcePlan,
    ];
    expect(acquisitionSourcePlanFingerprint(firstPass[0], 'Buenos Aires')).toBe(
      acquisitionSourcePlanFingerprint(secondPass[0], 'Buenos Aires'),
    );
    expect(
      acquisitionSourcePlanFingerprint(firstPass[1], 'Buenos Aires'),
    ).not.toBe(acquisitionSourcePlanFingerprint(secondPass[1], 'Buenos Aires'));
  });
});
