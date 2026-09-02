import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { ActivityProposal } from '../interfaces/activity-discovery.interface';
import {
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';

const destination: OsmCandidate = {
  id: 'osm:relation:1',
  name: 'Mendoza',
  osmType: 'relation',
  osmId: 1,
  tags: { name: 'Mendoza', boundary: 'administrative', admin_level: '8' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-68.95, -33.0],
        [-68.75, -33.0],
        [-68.75, -32.75],
        [-68.95, -32.75],
        [-68.95, -33.0],
      ],
    ],
  },
};

function proposal(
  kind: ActivityProposal['kind'],
  hints: ActivityProposal['entityHints'],
  evidenceKeys: string[] = ['ev-1'],
): ActivityProposal {
  return {
    name:
      kind === 'ROUTE' ? 'Ruta del Vino de Mendoza' : 'Experiencia mendocina',
    kind,
    themes: kind === 'ROUTE' ? ['food'] : ['culture'],
    entityHints: hints,
    suggestedDurationMinutes: 180,
    shortReason: 'Grounded proposal',
    evidenceKeys,
  };
}

function resolvedEntity(
  key: string,
  latitude: number,
  longitude: number,
  overrides: Partial<ResolvedGeoEntity> = {},
): ResolvedGeoEntity {
  return {
    hintKey: key,
    hintName: key,
    role: 'venue',
    expectedType: 'Winery',
    status: 'resolved',
    provider: 'google',
    externalId: `place:${key}`,
    canonicalName: key,
    latitude,
    longitude,
    adminContext: {
      region: 'Mendoza',
      country: 'Argentina',
    },
    evidence: [
      {
        provider: 'google',
        externalId: `place:${key}`,
        canonicalName: key,
        latitude,
        longitude,
      },
    ],
    ...overrides,
  };
}

function resolved(
  activityProposal: ActivityProposal,
  entities: ResolvedGeoEntity[],
): ResolvedExperienceCandidate {
  return {
    proposal: activityProposal,
    status: 'accepted',
    resolvedEntities: entities,
    rejectionReasons: [],
  };
}

describe('CompositeGeographicValidationService regional route policy', () => {
  const service = new CompositeGeographicValidationService();

  it('accepts a component-defined regional route whose real anchors extend beyond the city polygon but remain in the destination region', () => {
    const routeProposal = proposal('ROUTE', []);
    const result = service.validate(
      resolved(routeProposal, [
        resolvedEntity('Bodega Lujan A', -33.04, -68.88, {
          adminContext: {
            municipality: 'Luján de Cuyo',
            region: 'Mendoza',
            country: 'Argentina',
          },
        }),
        resolvedEntity('Bodega Maipu B', -32.99, -68.79, {
          adminContext: {
            municipality: 'Maipú',
            region: 'Mendoza',
            country: 'Argentina',
          },
        }),
        resolvedEntity('Bodega Lujan C', -33.12, -68.91, {
          adminContext: {
            municipality: 'Luján de Cuyo',
            region: 'Mendoza',
            country: 'Argentina',
          },
        }),
      ]),
      destination,
    );

    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('component_defined');
    expect(result.anchors).toHaveLength(3);
  });

  it('rejects a regional route when resolved components contradict each other administratively', () => {
    const routeProposal = proposal('ROUTE', []);
    const result = service.validate(
      resolved(routeProposal, [
        resolvedEntity('Bodega Mendoza A', -33.04, -68.88),
        resolvedEntity('Bodega Mendoza B', -32.99, -68.79),
        resolvedEntity('Winery Spain', 40.42, -3.7, {
          adminContext: { region: 'Madrid', country: 'Spain' },
        }),
      ]),
      destination,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('destination_mismatch');
  });

  it('rejects a venue-centric EXPERIENCE when the venue resolves but grounded proposal evidence is absent', () => {
    const experienceProposal = proposal(
      'EXPERIENCE',
      [
        {
          key: 'venue',
          name: 'Cooking School',
          role: 'venue',
          expectedType: 'Cooking School',
          required: true,
          evidenceKeys: [],
        },
      ],
      [],
    );

    const result = service.validate(
      resolved(experienceProposal, [
        resolvedEntity('venue', -32.89, -68.84, {
          expectedType: 'Cooking School',
        }),
      ]),
      destination,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('grounded_evidence_missing');
  });
});
