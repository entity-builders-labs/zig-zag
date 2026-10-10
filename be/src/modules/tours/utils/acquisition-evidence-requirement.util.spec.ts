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
    ).toEqual(['SINGLE_PLACE', 'MULTI_COMPONENT_EXPERIENCE']);
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
    ).toEqual(['MULTI_COMPONENT_EXPERIENCE']);
  });

  it('allows semantic facets to be covered by either structural shape', () => {
    expect(
      deriveAcquisitionEvidenceRequirements([
        deficit('theme', 'history'),
        deficit('intent', 'walk'),
      ]),
    ).toEqual(['SINGLE_PLACE', 'MULTI_COMPONENT_EXPERIENCE']);
  });

  it.each([
    ['global_capacity', 'capacity'],
    ['theme', 'history'],
    ['trait', 'local'],
    ['intent', 'day_trip'],
    ['intent', 'food'],
    ['intent', 'nightlife'],
    ['intent', 'other'],
  ])('%s:%s permits both structural shapes', (dimension, key) => {
    expect(
      deriveAcquisitionEvidenceRequirements([
        dimension === 'global_capacity'
          ? {
              origin: 'global_capacity',
              reason: 'test',
              currentEligibleCount: 0,
              requiredEligibleCount: 1,
            }
          : deficit(dimension, key),
      ]),
    ).toEqual(['SINGLE_PLACE', 'MULTI_COMPONENT_EXPERIENCE']);
  });
});
