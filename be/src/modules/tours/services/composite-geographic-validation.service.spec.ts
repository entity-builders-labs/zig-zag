import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';

describe('CompositeGeographicValidationService', () => {
  const boundary: any = {
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.5, -34.7],
          [-58.3, -34.7],
          [-58.3, -34.5],
          [-58.5, -34.5],
          [-58.5, -34.7],
        ],
      ],
    },
  };

  it('accepts a venue-centric Experience with one grounded component', () => {
    const candidate: ExperienceCandidate = {
      name: 'Museum visit',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'v',
          name: 'Museum',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ],
    };

    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'v',
            hintName: 'Museum',
            provider: 'osm',
            externalId: 'node:1',
            role: 'venue',
            status: 'resolved',
            latitude: -34.6,
            longitude: -58.4,
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );

    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('venue_centric');
  });

  it('accepts a resolved route component without requiring a second anchor', () => {
    const candidate: ExperienceCandidate = {
      name: 'Costanera route',
      themes: ['nature'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'r',
          name: 'Costanera',
          role: 'route',
          expectedKind: 'ROUTE',
          required: true,
          evidenceKeys: ['e'],
        },
      ],
    };
    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'r',
            hintName: 'Costanera',
            provider: 'osm',
            externalId: 'way:1',
            role: 'route',
            status: 'resolved',
            latitude: -34.6,
            longitude: -58.4,
            geometry: {
              type: 'LineString',
              coordinates: [
                [-58.4, -34.6],
                [-58.39, -34.61],
              ],
            },
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('component_defined');
  });

  it('accepts a coherent Experience with two required components', () => {
    const candidate: ExperienceCandidate = {
      name: 'Historic center highlights',
      themes: ['history'],
      traits: ['walkable'],
      evidenceKeys: ['e1', 'e2'],
      shortReason: 'grounded composite',
      componentHints: [
        {
          key: 'a',
          name: 'Plaza A',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e1'],
        },
        {
          key: 'b',
          name: 'Museum B',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e2'],
        },
      ],
    };

    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'a',
            hintName: 'Plaza A',
            provider: 'osm',
            externalId: 'node:a',
            role: 'waypoint',
            status: 'resolved',
            latitude: -34.6,
            longitude: -58.4,
          },
          {
            hintKey: 'b',
            hintName: 'Museum B',
            provider: 'osm',
            externalId: 'node:b',
            role: 'venue',
            status: 'resolved',
            latitude: -34.601,
            longitude: -58.401,
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );

    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('component_defined');
    expect(result.anchors).toHaveLength(2);
  });

  it('rejects an inherently multi-component Experience when fewer than two components resolve', () => {
    const candidate: ExperienceCandidate = {
      name: 'Incomplete historic walk',
      themes: ['history'],
      traits: [],
      evidenceKeys: ['e1'],
      shortReason: 'requires two places',
      componentHints: [
        {
          key: 'a',
          name: 'Plaza A',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e1'],
        },
        {
          key: 'b',
          name: 'Museum B',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e2'],
        },
      ],
    };

    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'a',
            hintName: 'Plaza A',
            provider: 'osm',
            externalId: 'node:a',
            role: 'waypoint',
            status: 'resolved',
            latitude: -34.6,
            longitude: -58.4,
          },
          {
            hintKey: 'b',
            hintName: 'Museum B',
            provider: 'osm',
            externalId: '',
            role: 'venue',
            status: 'unresolved',
            reason: 'NO_OSM_MATCH',
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('unresolved_required_component');
  });

  it('rejects geographically incoherent resolved components', () => {
    const candidate: ExperienceCandidate = {
      name: 'Impossible composite',
      themes: ['history'],
      traits: [],
      evidenceKeys: ['e1', 'e2'],
      shortReason: 'grounded but dispersed',
      componentHints: [
        {
          key: 'a',
          name: 'Place A',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e1'],
        },
        {
          key: 'b',
          name: 'Place B',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e2'],
        },
      ],
    };

    const result = new CompositeGeographicValidationService({
      experience: {
        minAnchors: 2,
        maxRadiusMeters: 100,
        maxPairwiseDistanceMeters: 200,
      },
      neighborhoodWalk: {
        minAnchors: 2,
        maxRadiusMeters: 100,
        maxPairwiseDistanceMeters: 200,
      },
      route: {
        minAnchors: 2,
        maxRadiusMeters: 100,
        maxPairwiseDistanceMeters: 200,
      },
    } as any).validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'a',
            hintName: 'Place A',
            provider: 'osm',
            externalId: 'node:a',
            role: 'waypoint',
            status: 'resolved',
            latitude: -34.6,
            longitude: -58.4,
          },
          {
            hintKey: 'b',
            hintName: 'Place B',
            provider: 'osm',
            externalId: 'node:b',
            role: 'venue',
            status: 'resolved',
            latitude: -34.65,
            longitude: -58.45,
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('geographic_incoherence');
  });

  it('rejects a resolved venue outside the destination boundary', () => {
    const candidate: ExperienceCandidate = {
      name: 'Outside',
      themes: [],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'v',
          name: 'Venue',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ],
    };
    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'v',
            hintName: 'Venue',
            provider: 'osm',
            externalId: 'node:1',
            role: 'venue',
            status: 'resolved',
            latitude: -35,
            longitude: -59,
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('destination_mismatch');
  });
});
