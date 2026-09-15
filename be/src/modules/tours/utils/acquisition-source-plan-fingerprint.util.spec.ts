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

const fingerprint = (sourcePlan: SourcePlan, p = plan('Buenos Aires walks')) =>
  acquisitionSourcePlanFingerprint(sourcePlan, {
    destination: p.destination,
    evidenceRequirements: p.evidenceRequirements,
    relevantDeficits: p.deficits,
    relevantAnchors: [],
  });

describe('acquisitionSourcePlanFingerprint', () => {
  it('is stable for equivalent plans and excludes pass identity', () => {
    const firstPlan = plan('Buenos Aires walks');
    const secondPlan = plan(' Buenos Aires walks ');
    const first = fingerprint(firstPlan.sourcePlans[0], firstPlan);
    const second = fingerprint(secondPlan.sourcePlans[0], secondPlan);
    expect(first).toBe(second);
    expect(first).not.toContain('passNumber');
  });

  it('changes when a material source-plan field changes', () => {
    expect(fingerprint(plan('Buenos Aires walks').sourcePlans[0])).not.toBe(
      fingerprint(
        plan('Buenos Aires history walks').sourcePlans[0],
        plan('Buenos Aires history walks'),
      ),
    );
  });

  it('supports request-scoped duplicate execution tracking', () => {
    const ledger: AcquisitionExecutionLedger = {
      executedSourcePlanFingerprints: new Set(),
    };
    const value = fingerprint(plan('Buenos Aires walks').sourcePlans[0]);
    expect(ledger.executedSourcePlanFingerprints.has(value)).toBe(false);
    ledger.executedSourcePlanFingerprints.add(value);
    expect(ledger.executedSourcePlanFingerprints.has(value)).toBe(true);
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
    expect(fingerprint(firstPass[0])).toBe(fingerprint(secondPass[0]));
    expect(fingerprint(firstPass[1])).not.toBe(fingerprint(secondPass[1]));
  });
});
