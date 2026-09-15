import { deriveAcquisitionEvidenceRequirements } from './acquisition-evidence-requirement.util';
import { AcquisitionDeficit } from '../interfaces/experience-acquisition-plan.interface';

const deficit = (dimension: string, key: string): AcquisitionDeficit => ({
  origin: 'preference_facet',
  dimension,
  key,
  reason: 'test',
});

describe('deriveAcquisitionEvidenceRequirements', () => {
  it('maps every supported deficit shape and deduplicates in canonical order', () => {
    expect(
      deriveAcquisitionEvidenceRequirements([
        {
          origin: 'global_capacity',
          reason: 'test',
          currentEligibleCount: 0,
          requiredEligibleCount: 1,
        },
        deficit('intent', 'visit'),
        deficit('theme', 'history'),
        deficit('intent', 'walk'),
        deficit('intent', 'route_like'),
        deficit('intent', 'day_trip'),
        deficit('intent', 'food'),
        deficit('intent', 'nightlife'),
        deficit('trait', 'local'),
        deficit('other_supported_dimension', 'value'),
      ]),
    ).toEqual([
      'COMPOSITE_WALK',
      'CANONICAL_ROUTE',
      'SINGLE_PLACE',
      'GENERAL_TOURISM_EXPERIENCE',
    ]);
  });

  it('returns no requirements for zero deficits', () => {
    expect(deriveAcquisitionEvidenceRequirements([])).toEqual([]);
  });

  it('does not inspect unrelated deficit data', () => {
    expect(
      deriveAcquisitionEvidenceRequirements([
        {
          ...deficit('intent', 'walk'),
          reason: 'provider:osm anchors:San Telmo semanticQuery:walk',
        },
      ]),
    ).toEqual(['COMPOSITE_WALK']);
  });
});
