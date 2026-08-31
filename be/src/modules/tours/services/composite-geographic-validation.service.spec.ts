import { ActivityKind } from '@prisma/client';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { ActivityProposal } from '../interfaces/activity-discovery.interface';
import { ResolvedActivityProposal, ResolvedEntity } from '../interfaces/proposal-resolution.interface';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';

const destination: OsmCandidate = {
  id: 'osm:relation:1',
  name: 'Test City',
  osmType: 'relation',
  osmId: 1,
  tags: { boundary: 'administrative', admin_level: '8' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-58.6, -34.7],
        [-58.2, -34.7],
        [-58.2, -34.3],
        [-58.6, -34.3],
        [-58.6, -34.7],
      ],
    ],
  },
};

function proposal(
  kind: ActivityProposal['kind'],
  hints: ActivityProposal['entityHints'],
  evidenceKeys = ['ev-1'],
): ActivityProposal {
  return {
    name: `${kind} proposal`,
    kind,
    themes: ['history'],
    entityHints: hints,
    suggestedDurationMinutes: 120,
    shortReason: 'grounded proposal',
    evidenceKeys,
  };
}

function entity(
  key: string,
  role: ResolvedEntity['role'],
  latitude: number,
  longitude: number,
  overrides: Partial<ResolvedEntity> = {},
): ResolvedEntity {
  return {
    hintKey: key,
    hintName: key,
    role,
    expectedType: role,
    status: 'resolved',
    externalId: `provider:${key}`,
    provider: 'osm',
    canonicalName: key,
    latitude,
    longitude,
    evidence: [
      {
        provider: 'osm',
        externalId: `provider:${key}`,
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
  entities: ResolvedEntity[],
): ResolvedActivityProposal {
  return {
    proposal: activityProposal,
    status: entities.some((candidate) => candidate.status === 'resolved')
      ? 'accepted'
      : 'rejected',
    resolvedEntities: entities,
    rejectionReasons: [],
  };
}

describe('CompositeGeographicValidationService', () => {
  const service = new CompositeGeographicValidationService();

  it('accepts a POI with one canonical resolved entity and coordinates', () => {
    const p = proposal('POI', [
      {
        key: 'poi',
        name: 'Museum',
        role: 'venue',
        expectedType: 'Museum',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ]);
    const result = service.validate(
      resolved(p, [entity('poi', 'venue', -34.5, -58.4)]),
      destination,
    );
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('GEO_VERIFIED');
    expect(result.strategy).toBe('canonical_entity');
  });

  it('rejects an unresolved POI', () => {
    const p = proposal('POI', []);
    const result = service.validate(resolved(p, []), destination);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('no_resolved_entities');
  });

  it('accepts a neighborhood walk when a canonical area resolves', () => {
    const p = proposal('NEIGHBORHOOD_WALK', [
      {
        key: 'area',
        name: 'San Telmo',
        role: 'area',
        expectedType: 'Neighborhood',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ]);
    const area = entity('area', 'area', -34.62, -58.37, {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      },
    });
    const result = service.validate(resolved(p, [area]), destination);
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('canonical_area');
  });

  it('accepts a neighborhood walk without an area when three compact anchors resolve', () => {
    const hints = ['a', 'b', 'c'].map((key) => ({
      key,
      name: key,
      role: 'waypoint' as const,
      expectedType: 'Landmark',
      required: true,
      evidenceKeys: ['ev-1'],
    }));
    const p = proposal('NEIGHBORHOOD_WALK', hints);
    const result = service.validate(
      resolved(p, [
        entity('a', 'waypoint', -34.5000, -58.4000),
        entity('b', 'waypoint', -34.5050, -58.4050),
        entity('c', 'waypoint', -34.5100, -58.4100),
      ]),
      destination,
    );
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('compact_anchors');
    expect(result.anchors).toHaveLength(3);
  });

  it('rejects a neighborhood walk with only two anchors', () => {
    const p = proposal('NEIGHBORHOOD_WALK', []);
    const result = service.validate(
      resolved(p, [
        entity('a', 'waypoint', -34.5, -58.4),
        entity('b', 'waypoint', -34.505, -58.405),
      ]),
      destination,
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('insufficient_resolved_entities');
  });

  it('rejects geographically dispersed neighborhood anchors', () => {
    const p = proposal('NEIGHBORHOOD_WALK', []);
    const result = service.validate(
      resolved(p, [
        entity('a', 'waypoint', -34.40, -58.30),
        entity('b', 'waypoint', -34.55, -58.45),
        entity('c', 'waypoint', -34.65, -58.55),
      ]),
      destination,
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('geographic_incoherence');
  });

  it('rejects neighborhood anchors with conflicting locality metadata', () => {
    const p = proposal('NEIGHBORHOOD_WALK', []);
    const result = service.validate(
      resolved(p, [
        entity('a', 'waypoint', -34.5, -58.4, {
          adminContext: { locality: 'Test City' },
        }),
        entity('b', 'waypoint', -34.505, -58.405, {
          adminContext: { locality: 'Other City' },
        }),
        entity('c', 'waypoint', -34.51, -58.41, {
          adminContext: { locality: 'Test City' },
        }),
      ]),
      destination,
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('destination_mismatch');
  });

  it('accepts a route from a canonical resolved geometry without exact proposal-name resolution', () => {
    const p = proposal('ROUTE', [
      {
        key: 'route',
        name: 'Promenade component',
        role: 'route',
        expectedType: 'Promenade',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ]);
    const route = entity('route', 'route', -34.5, -58.4, {
      canonicalName: 'Official Waterfront Avenue',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-58.41, -34.51],
          [-58.39, -34.49],
        ],
      },
    });
    const result = service.validate(resolved(p, [route]), destination);
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('canonical_geometry');
  });

  it('accepts a component-defined regional route with three coherent real entities', () => {
    const p = proposal('ROUTE', []);
    const result = service.validate(
      resolved(p, [
        entity('winery-a', 'venue', -34.45, -58.35),
        entity('winery-b', 'venue', -34.50, -58.40),
        entity('winery-c', 'venue', -34.55, -58.45),
      ]),
      destination,
    );
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('component_defined');
  });

  it('rejects a route when one component is outside the destination scope', () => {
    const p = proposal('ROUTE', []);
    const result = service.validate(
      resolved(p, [
        entity('a', 'venue', -34.45, -58.35),
        entity('b', 'venue', -34.50, -58.40),
        entity('c', 'venue', 40.4168, -3.7038),
      ]),
      destination,
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('destination_mismatch');
  });

  it('accepts a venue-centric experience with one resolved venue and grounded evidence', () => {
    const p = proposal('EXPERIENCE', [
      {
        key: 'venue',
        name: 'Cooking School',
        role: 'venue',
        expectedType: 'Cooking School',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ]);
    const result = service.validate(
      resolved(p, [entity('venue', 'venue', -34.5, -58.4)]),
      destination,
    );
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('venue_centric');
  });

  it('does not require an area hint for a multi-component experience', () => {
    const p = proposal('EXPERIENCE', [
      {
        key: 'a',
        name: 'Cafe',
        role: 'venue',
        expectedType: 'Cafe',
        required: true,
        evidenceKeys: ['ev-1'],
      },
      {
        key: 'b',
        name: 'Building',
        role: 'waypoint',
        expectedType: 'Building',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ]);
    const result = service.validate(
      resolved(p, [
        entity('a', 'venue', -34.5, -58.4),
        entity('b', 'waypoint', -34.51, -58.41),
      ]),
      destination,
    );
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('component_defined');
  });

  it('rejects a multi-component experience when a required component is unresolved', () => {
    const p = proposal('EXPERIENCE', [
      {
        key: 'a',
        name: 'Cafe',
        role: 'venue',
        expectedType: 'Cafe',
        required: true,
        evidenceKeys: ['ev-1'],
      },
      {
        key: 'b',
        name: 'Building',
        role: 'waypoint',
        expectedType: 'Building',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ]);
    const unresolvedEntity: ResolvedEntity = {
      hintKey: 'b',
      hintName: 'Building',
      role: 'waypoint',
      expectedType: 'Building',
      status: 'rejected',
      rejectionReason: 'unresolved_venue',
    };
    const result = service.validate(
      resolved(p, [entity('a', 'venue', -34.5, -58.4), unresolvedEntity]),
      destination,
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('unresolved_required_component');
  });

  it('maps proposal kinds to their canonical ActivityKind', () => {
    const p = proposal('POI', []);
    const result = service.validate(resolved(p, []), destination);
    expect(result.kind).toBe(ActivityKind.POI);
  });
});
