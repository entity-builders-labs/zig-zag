import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

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
    // A resolved route entity with real canonical LineString geometry is
    // authoritative — accepted via the canonical-geometry short-circuit
    // (CP3-1), not the anchor-count/coherence fallback path.
    expect(result.strategy).toBe('canonical_geometry');
  });

  it('rejects a canonical route whose geometry falls outside the route-scale destination radius', () => {
    const candidate: ExperienceCandidate = {
      name: 'Faraway route',
      themes: ['nature'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'r',
          name: 'Faraway',
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
            hintName: 'Faraway',
            provider: 'osm',
            externalId: 'way:2',
            role: 'route',
            status: 'resolved',
            latitude: 10,
            longitude: 10,
            geometry: {
              type: 'LineString',
              coordinates: [
                [10, 10],
                [10.01, 10.01],
              ],
            },
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );
    expect(result.accepted).toBe(false);
    expect(result.kind).toBe('ROUTE');
    expect(result.rejectionReasons).toContain('destination_mismatch');
  });

  it('accepts a canonical AREA polygon paired with a waypoint hint as a neighborhood walk', () => {
    const candidate: ExperienceCandidate = {
      name: 'San Telmo walk',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'a',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Plaza Dorrego',
          role: 'waypoint',
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
            hintKey: 'a',
            hintName: 'San Telmo',
            provider: 'osm',
            externalId: 'relation:1',
            role: 'area',
            status: 'resolved',
            latitude: -34.62,
            longitude: -58.37,
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
          },
          {
            hintKey: 'w',
            hintName: 'Plaza Dorrego',
            provider: 'osm',
            externalId: 'node:2',
            role: 'waypoint',
            status: 'resolved',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );
    expect(result.accepted).toBe(true);
    // Task B5, Cleanup 1: NEIGHBORHOOD_WALK is not a real structural type
    // anymore -- this canonical-area accept path now reports 'EXPERIENCE'.
    expect(result.kind).toBe('EXPERIENCE');
    expect(result.strategy).toBe('canonical_area');
  });

  it('does not short-circuit a canonical AREA polygon with no waypoint/venue hint — falls through unchanged', () => {
    // An area alone (no waypoint hint) isn't a walk — this must fall through
    // to validateExperience's existing anchor logic, which filters out
    // role==='area' entities entirely, rather than being force-accepted here.
    const candidate: ExperienceCandidate = {
      name: 'Area only',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'a',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
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
            hintKey: 'a',
            hintName: 'San Telmo',
            provider: 'osm',
            externalId: 'relation:1',
            role: 'area',
            status: 'resolved',
            latitude: -34.62,
            longitude: -58.37,
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
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );
    expect(result.accepted).toBe(false);
    expect(result.strategy).not.toBe('canonical_area');
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

  describe('Task B5: AREA/ROUTE shortcut hardening', () => {
    const sanTelmoArea = {
      hintKey: 'a',
      hintName: 'San Telmo',
      provider: 'osm',
      externalId: 'relation:1',
      role: 'area' as const,
      status: 'resolved' as const,
      latitude: -34.62,
      longitude: -58.37,
      geometry: {
        type: 'Polygon' as const,
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
    };

    function areaCandidate(
      componentHints: ExperienceCandidate['componentHints'],
    ): ExperienceCandidate {
      return {
        name: 'San Telmo walk',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints,
      };
    }

    it('rejects when a required waypoint resolves OUTSIDE the canonical area', () => {
      const candidate = areaCandidate([
        {
          key: 'a',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'MALBA',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            sanTelmoArea,
            {
              hintKey: 'w',
              hintName: 'MALBA',
              provider: 'osm',
              externalId: 'node:malba',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.58,
              longitude: -58.4,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('destination_mismatch');
    });

    it('rejects when a required (non-area) hint is unresolved, even with a valid canonical area', () => {
      const candidate = areaCandidate([
        {
          key: 'a',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Mercado de San Telmo',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [sanTelmoArea],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain(
        'unresolved_required_component',
      );
    });

    it('does not force a multi-area walk (2 required AREA hints) into a single-area containment shortcut', () => {
      const laBocaArea = {
        hintKey: 'a2',
        hintName: 'La Boca',
        provider: 'osm',
        externalId: 'relation:2',
        role: 'area' as const,
        status: 'resolved' as const,
        latitude: -34.635,
        longitude: -58.363,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-58.37, -34.64],
              [-58.355, -34.64],
              [-58.355, -34.63],
              [-58.37, -34.63],
              [-58.37, -34.64],
            ],
          ],
        },
      };
      const candidate = areaCandidate([
        {
          key: 'a1',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'a2',
          name: 'La Boca',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w1',
          name: 'Plaza Dorrego',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w2',
          name: 'Caminito',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            { ...sanTelmoArea, hintKey: 'a1' },
            laBocaArea,
            {
              hintKey: 'w1',
              hintName: 'Plaza Dorrego',
              provider: 'osm',
              externalId: 'node:w1',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.621,
              longitude: -58.371,
            },
            {
              hintKey: 'w2',
              hintName: 'Caminito',
              provider: 'osm',
              externalId: 'node:w2',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.636,
              longitude: -58.363,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
      );
      // Falls through to validateExperience's destination+coherence path
      // (the canonical-area shortcut never applies with 2 required AREA
      // hints) -- accepts on ordinary coherence, never rejected for
      // "crossing between San Telmo and La Boca."
      expect(result.accepted).toBe(true);
      expect(result.strategy).toBe('component_defined');
    });

    it('does not trigger the canonical-area shortcut for an optional (non-required) AREA hint', () => {
      const candidate = areaCandidate([
        {
          key: 'a',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: false,
          evidenceKeys: ['e'],
        },
        {
          key: 'w1',
          name: 'Plaza Dorrego',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w2',
          name: 'Parque Lezama',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            sanTelmoArea,
            {
              hintKey: 'w1',
              hintName: 'Plaza Dorrego',
              provider: 'osm',
              externalId: 'node:w1',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.621,
              longitude: -58.371,
            },
            {
              hintKey: 'w2',
              hintName: 'Parque Lezama',
              provider: 'osm',
              externalId: 'node:w2',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.628,
              longitude: -58.371,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.strategy).not.toBe('canonical_area');
    });

    function routeCandidate(
      componentHints: ExperienceCandidate['componentHints'],
    ): ExperienceCandidate {
      return {
        name: 'Caminito route',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints,
      };
    }

    const caminitoRoute = {
      hintKey: 'r',
      hintName: 'Caminito',
      provider: 'osm',
      externalId: 'way:1',
      role: 'route' as const,
      status: 'resolved' as const,
      latitude: -34.6,
      longitude: -58.4,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-58.4, -34.6],
          [-58.39, -34.61],
        ],
      },
    };

    it('rejects a canonical ROUTE candidate when a required waypoint is far outside the regional coherence policy', () => {
      const candidate = routeCandidate([
        {
          key: 'r',
          name: 'Caminito',
          role: 'route',
          expectedKind: 'ROUTE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Far waypoint',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            caminitoRoute,
            {
              hintKey: 'w',
              hintName: 'Far waypoint',
              provider: 'osm',
              externalId: 'node:far',
              role: 'waypoint',
              status: 'resolved',
              latitude: 10,
              longitude: 10,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('destination_mismatch');
    });

    it('rejects a canonical ROUTE candidate with an unresolved required waypoint', () => {
      const candidate = routeCandidate([
        {
          key: 'r',
          name: 'Caminito',
          role: 'route',
          expectedKind: 'ROUTE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Missing waypoint',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [caminitoRoute],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain(
        'unresolved_required_component',
      );
    });

    it('still accepts a canonical ROUTE candidate whose required waypoints pass the existing regional thresholds', () => {
      const candidate = routeCandidate([
        {
          key: 'r',
          name: 'Caminito',
          role: 'route',
          expectedKind: 'ROUTE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Fundación Proa',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            caminitoRoute,
            {
              hintKey: 'w',
              hintName: 'Fundación Proa',
              provider: 'osm',
              externalId: 'node:proa',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.639,
              longitude: -58.364,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(true);
      expect(result.kind).toBe('ROUTE');
    });

    // A wider boundary than the shared `boundary` fixture -- big enough
    // that two points ~78km apart both stay comfortably inside it AND
    // within route-scale's regional thresholds, so the ONLY thing that
    // can fail them is the (tighter) experience-scale coherence check.
    const wideBoundary: any = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.6, -34.9],
            [-58.2, -34.9],
            [-58.2, -34.1],
            [-58.6, -34.1],
            [-58.6, -34.9],
          ],
        ],
      },
    };
    const wideSpreadEntities = [
      {
        hintKey: 'w1',
        hintName: 'Winery A',
        provider: 'osm',
        externalId: 'node:w1',
        role: 'venue' as const,
        status: 'resolved' as const,
        latitude: -34.15,
        longitude: -58.4,
      },
      {
        hintKey: 'w2',
        hintName: 'Winery B',
        provider: 'osm',
        externalId: 'node:w2',
        role: 'venue' as const,
        status: 'resolved' as const,
        latitude: -34.85,
        longitude: -58.4,
      },
    ];

    it('applies route-scale geographic thresholds when validationIntent is route_like, even with NO route component', () => {
      const candidate: ExperienceCandidate = {
        name: 'Ruta del Vino de Mendoza',
        themes: [],
        traits: [],
        intents: [],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'w1',
            name: 'Winery A',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Winery B',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['e'],
          },
        ],
      };

      const withoutValidationIntent =
        new CompositeGeographicValidationService().validate(
          {
            candidate,
            status: 'accepted',
            resolvedEntities: wideSpreadEntities,
            rejectionReasons: [],
          },
          wideBoundary,
        );
      // Sanity check: these same stops genuinely fail the tighter
      // `experience`-scale thresholds -- proves route-scale is a REAL
      // widening, not a no-op.
      expect(withoutValidationIntent.accepted).toBe(false);
      expect(withoutValidationIntent.rejectionReasons).toContain(
        'geographic_incoherence',
      );

      const withValidationIntent =
        new CompositeGeographicValidationService().validate(
          {
            candidate,
            status: 'accepted',
            resolvedEntities: wideSpreadEntities,
            rejectionReasons: [],
          },
          wideBoundary,
          undefined,
          'route_like',
        );
      expect(withValidationIntent.accepted).toBe(true);
      expect(withValidationIntent.strategy).toBe('component_defined');
    });

    it('does NOT apply route-scale thresholds from candidate.intents alone -- only validationIntent selects the policy', () => {
      const candidate: ExperienceCandidate = {
        name: 'Ruta del Vino de Mendoza',
        themes: [],
        traits: [],
        intents: ['route_like'],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'w1',
            name: 'Winery A',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Winery B',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['e'],
          },
        ],
      };
      // candidate.intents says route_like, but validationIntent is NOT
      // passed -- must still use the tighter `experience` scale (this is
      // the exact regression Task B5 point 19 guards against).
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: wideSpreadEntities,
          rejectionReasons: [],
        },
        wideBoundary,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('geographic_incoherence');
    });

    it('still rejects under route-scale policy when a stop is in a different region/country entirely', () => {
      const candidate: ExperienceCandidate = {
        name: 'Ruta del Vino de Mendoza',
        themes: [],
        traits: [],
        intents: [],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'w1',
            name: 'Winery A',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Far winery',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['e'],
          },
        ],
      };
      const entities = [
        {
          hintKey: 'w1',
          hintName: 'Winery A',
          provider: 'osm',
          externalId: 'node:w1',
          role: 'venue' as const,
          status: 'resolved' as const,
          latitude: -34.6,
          longitude: -58.4,
        },
        {
          hintKey: 'w2',
          hintName: 'Far winery',
          provider: 'osm',
          externalId: 'node:w2',
          role: 'venue' as const,
          status: 'resolved' as const,
          latitude: 10,
          longitude: 10,
        },
      ];
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: entities,
          rejectionReasons: [],
        },
        boundary,
        undefined,
        'route_like',
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('destination_mismatch');
    });

    it('leaves an ordinary multi-neighborhood walk (no AREA hint, no route_like) untouched', () => {
      const candidate: ExperienceCandidate = {
        name: 'Buenos Aires South Walk',
        themes: ['culture'],
        traits: [],
        intents: ['walk'],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'w1',
            name: 'Plaza Dorrego',
            role: 'waypoint',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Caminito',
            role: 'waypoint',
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
              hintKey: 'w1',
              hintName: 'Plaza Dorrego',
              provider: 'osm',
              externalId: 'node:w1',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.621,
              longitude: -58.371,
            },
            {
              hintKey: 'w2',
              hintName: 'Caminito',
              provider: 'osm',
              externalId: 'node:w2',
              role: 'waypoint',
              status: 'resolved',
              latitude: -34.636,
              longitude: -58.363,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(true);
      expect(result.strategy).toBe('component_defined');
    });
  });

  describe('Task B5: rejectIfExternalScopeViolated (validationScope)', () => {
    const sanTelmoScopeGeometry: GeoJsonGeometry = {
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
    };
    const areaScope = {
      kind: 'AREA' as const,
      anchorName: 'San Telmo',
      geoEntityId: 'geo-san-telmo',
      geometry: sanTelmoScopeGeometry,
    };

    function unscopedCandidate(
      componentHints: ExperienceCandidate['componentHints'],
    ): ExperienceCandidate {
      return {
        name: 'San Telmo Historical Walk',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints,
      };
    }

    it('rejects (before persistence) when a required component is outside the external AREA scope, even with NO AREA hint on the candidate', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'p2',
          name: 'Mercado de San Telmo',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'p3',
          name: 'MALBA',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'p1',
              hintName: 'Plaza Dorrego',
              provider: 'osm',
              externalId: 'node:p1',
              role: 'venue',
              status: 'resolved',
              latitude: -34.621,
              longitude: -58.371,
            },
            {
              hintKey: 'p2',
              hintName: 'Mercado de San Telmo',
              provider: 'osm',
              externalId: 'node:p2',
              role: 'venue',
              status: 'resolved',
              latitude: -34.62,
              longitude: -58.372,
            },
            {
              hintKey: 'p3',
              hintName: 'MALBA',
              provider: 'osm',
              externalId: 'node:p3',
              role: 'venue',
              status: 'resolved',
              latitude: -34.58,
              longitude: -58.4,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        areaScope,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
    });

    it('accepts when every required component (no AREA hint on the candidate) is genuinely inside the external AREA scope', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'p2',
          name: 'Mercado de San Telmo',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
        {
          key: 'p3',
          name: 'Pasaje Defensa',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'p1',
              hintName: 'Plaza Dorrego',
              provider: 'osm',
              externalId: 'node:p1',
              role: 'venue',
              status: 'resolved',
              latitude: -34.621,
              longitude: -58.371,
            },
            {
              hintKey: 'p2',
              hintName: 'Mercado de San Telmo',
              provider: 'osm',
              externalId: 'node:p2',
              role: 'venue',
              status: 'resolved',
              latitude: -34.62,
              longitude: -58.372,
            },
            {
              hintKey: 'p3',
              hintName: 'Pasaje Defensa',
              provider: 'osm',
              externalId: 'node:p3',
              role: 'venue',
              status: 'resolved',
              latitude: -34.622,
              longitude: -58.373,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        areaScope,
      );
      expect(result.accepted).toBe(true);
    });

    it('rejects with unresolved_required_component when a required hint is unresolved, before checking the scope geometry', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [],
          rejectionReasons: [],
        },
        boundary,
        areaScope,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain(
        'unresolved_required_component',
      );
    });

    it('fails closed (rejects) when the AREA validationScope has no usable geometry', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'p1',
              hintName: 'Plaza Dorrego',
              provider: 'osm',
              externalId: 'node:p1',
              role: 'venue',
              status: 'resolved',
              latitude: -34.621,
              longitude: -58.371,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        { ...areaScope, geometry: undefined as any },
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
    });

    const caminitoScopeGeometry: GeoJsonGeometry = {
      type: 'LineString',
      coordinates: [
        [-58.3634, -34.6382],
        [-58.363, -34.6376],
      ],
    };
    const routeScopeObj = {
      kind: 'ROUTE' as const,
      anchorName: 'Caminito',
      geoEntityId: 'geo-caminito',
      geometry: caminitoScopeGeometry,
    };

    it('rejects (N2) when a required component is several km from the external ROUTE scope, even within the destination boundary', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Some other stop',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'p1',
              hintName: 'Some other stop',
              provider: 'osm',
              externalId: 'node:p1',
              role: 'venue',
              status: 'resolved',
              // Several km from Caminito, but still well within the
              // destination boundary/route.maxRadiusMeters -- this is the
              // exact case that proves the check is real corridor
              // membership, not routeDestinationMismatch's regional
              // centroid-radius approximation.
              latitude: -34.6,
              longitude: -58.42,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        routeScopeObj,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
    });

    it('accepts (N1) when a required component is genuinely close to (on/adjacent to) the external ROUTE scope', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Fundación Proa',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e'],
        },
      ]);
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'p1',
              hintName: 'Fundación Proa',
              provider: 'osm',
              externalId: 'node:p1',
              role: 'venue',
              status: 'resolved',
              latitude: -34.6379,
              longitude: -58.3632,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        routeScopeObj,
      );
      expect(result.accepted).toBe(true);
    });

    it('excludes the canonical ROUTE entity itself from the corridor-distance check (its own representative point need not lie on its own line)', () => {
      const candidate: ExperienceCandidate = {
        name: 'Caminito route',
        themes: [],
        traits: [],
        evidenceKeys: ['e'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'r',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            required: true,
            evidenceKeys: ['e'],
          },
          {
            key: 'p1',
            name: 'Fundación Proa',
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
              hintKey: 'r',
              hintName: 'Caminito',
              provider: 'osm',
              externalId: 'way:1',
              role: 'route',
              status: 'resolved',
              // A representative/centroid point that is deliberately NOT
              // on the scope's own LineString (real-world routes often
              // report a centroid slightly off their own geometry).
              latitude: -34.6,
              longitude: -58.42,
              geometry: caminitoScopeGeometry,
            },
            {
              hintKey: 'p1',
              hintName: 'Fundación Proa',
              provider: 'osm',
              externalId: 'node:p1',
              role: 'venue',
              status: 'resolved',
              latitude: -34.6379,
              longitude: -58.3632,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        routeScopeObj,
      );
      // Must NOT reject on the ROUTE entity's own (off-line) representative
      // point -- only the required venue/waypoint is checked for corridor
      // membership.
      expect(result.accepted).toBe(true);
    });
  });
});
