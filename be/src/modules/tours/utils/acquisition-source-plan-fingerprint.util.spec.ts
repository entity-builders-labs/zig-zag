import {
  acquisitionSourcePlanFingerprint,
  AcquisitionExecutionLedger,
} from './acquisition-source-plan-fingerprint.util';
import {
  ExperienceAcquisitionPlan,
  SourcePlan,
} from '../interfaces/experience-acquisition-plan.interface';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';

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

  describe('anchor context (audit fields never affect execution)', () => {
    const caminito = (
      overrides: Partial<Extract<ResolvedAnchor, { status: 'resolved' }>> = {},
    ): ResolvedAnchor => ({
      status: 'resolved',
      rawName: 'Caminito',
      usage: 'named_path',
      priority: 'must',
      canonicalName: 'Caminito',
      kind: 'route',
      geoEntityId: 'geo-caminito',
      provider: 'openstreetmap',
      externalId: 'osm:way:144844726',
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-58.3633, -34.6394],
            [-58.3618, -34.6391],
          ],
        ],
      },
      ...overrides,
    });
    const web: SourcePlan = {
      provider: 'web',
      web: { query: 'Buenos Aires Caminito walks', anchorNames: ['Caminito'] },
    };
    const withAnchors = (anchors: ResolvedAnchor[]) =>
      acquisitionSourcePlanFingerprint(web, {
        destination: { destinationName: 'Buenos Aires' },
        evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
        relevantDeficits: [],
        relevantAnchors: anchors,
      });

    it('is identical when only candidateFacts differ (B1)', () => {
      const selectedOnly = caminito({
        candidateFacts: [
          {
            branch: 'route',
            discoveryStatus: 'match',
            eligibility: 'ELIGIBLE',
            decision: 'SELECTED',
          },
        ],
      });
      const withRejectedHomonyms = caminito({
        candidateFacts: [
          {
            branch: 'route',
            discoveryStatus: 'match',
            eligibility: 'ELIGIBLE',
            decision: 'SELECTED',
          },
          {
            branch: 'place',
            discoveryStatus: 'rejected',
            eligibility: 'REJECTED_DESTINATION_INCOMPATIBLE',
            externalId: 'osm:way:269972048',
            compatibility: {
              verdict: 'INCOMPATIBLE',
              reason: 'OUTSIDE_DESTINATION_BOUNDARY',
            },
          },
        ],
      });
      expect(withAnchors([selectedOnly])).toBe(
        withAnchors([withRejectedHomonyms]),
      );
      expect(withAnchors([selectedOnly])).toBe(withAnchors([caminito()]));
    });

    it('is identical for unresolved anchors whose diagnostics differ', () => {
      const unresolved = (reason: string): ResolvedAnchor => ({
        status: 'unresolved',
        rawName: 'Caminito',
        usage: 'named_path',
        priority: 'must',
        unresolvedReason: reason,
      });
      expect(withAnchors([unresolved('NO_CONFIDENT_GEO_ENTITY_MATCH')])).toBe(
        withAnchors([unresolved('DESTINATION_INCOMPATIBLE')]),
      );
    });

    it('changes when the material anchor identity changes (B2)', () => {
      expect(withAnchors([caminito()])).not.toBe(
        withAnchors([
          caminito({ externalId: 'osm:way:1', geoEntityId: 'geo-2' }),
        ]),
      );
    });

    it('changes when the material route geometry changes (B2)', () => {
      expect(withAnchors([caminito()])).not.toBe(
        withAnchors([
          caminito({
            geometry: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [-58.37, -34.63],
                  [-58.36, -34.62],
                ],
              ],
            },
          }),
        ]),
      );
    });
  });
});
