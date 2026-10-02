import { ownedAuthorization } from '../fixtures/geographic-authorization.fixture';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { candidateSatisfiesEvidenceRequirement } from '../utils/acquisition-candidate-requirement.util';
import { checkHardConstraints } from '../utils/daily-planning-placement.util';
import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { WorkUnitAnchorScope } from '../interfaces/experience-geographic-scope.interface';

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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
            kind: 'ROUTE',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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

  it('rejects a DEFAULT candidate whose canonical route lies entirely beyond the destination: a beyond-destination scope is not admissible without ROUTE_LIKE (no radius involved)', () => {
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
            kind: 'ROUTE',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
    expect(result.rejectionReasons).toEqual(['geographic_scope_unknown']);
    expect(result.experienceScope).toEqual({
      kind: 'UNKNOWN',
      unknownReason: 'SCOPE_BEYOND_DESTINATION_NOT_AUTHORIZED',
      destinationRelation: 'OUTSIDE',
    });
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
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Plaza Dorrego',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
          evidenceKeys: ['e1'],
        },
        {
          key: 'b',
          name: 'Museum B',
          role: 'venue',
          expectedKind: 'PLACE',
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
          evidenceKeys: ['e1'],
        },
        {
          key: 'b',
          name: 'Museum B',
          role: 'venue',
          expectedKind: 'PLACE',
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'unresolved',
            reason: 'NO_OSM_MATCH',
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('incomplete_source_composition');
  });

  it('does not reject dispersed components inside the destination: dispersion is planning feasibility, not validity (no coherence radius, spec Part II §P2-8)', () => {
    const candidate: ExperienceCandidate = {
      name: 'Dispersed but destination-local composite',
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
          evidenceKeys: ['e1'],
        },
        {
          key: 'b',
          name: 'Place B',
          role: 'venue',
          expectedKind: 'PLACE',
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
            hintName: 'Place A',
            provider: 'osm',
            externalId: 'node:a',
            role: 'waypoint',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -34.65,
            longitude: -58.45,
          },
        ],
        rejectionReasons: [],
      },
      boundary,
    );

    expect(result.accepted).toBe(true);
    expect(result.experienceScope).toEqual(
      expect.objectContaining({ provenance: 'DESTINATION_AREA' }),
    );
    expect(result.destinationRelation?.relation).toBe('WITHIN_DESTINATION');
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
      nameEvidenceMultiplicity: {
        exactName: 'UNKNOWN',
        declaredAlias: 'UNKNOWN',
      } as const,
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
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'MALBA',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
      expect(result.rejectionReasons).toEqual(['outside_experience_scope']);
    });

    it('rejects when a source (non-area) hint is unresolved, even with a valid canonical area', () => {
      const candidate = areaCandidate([
        {
          key: 'a',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Mercado de San Telmo',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
        'incomplete_source_composition',
      );
    });

    it('does not force a multi-area walk (2 required AREA hints) into a single-area containment shortcut', () => {
      const laBocaArea = {
        hintKey: 'a2',
        hintName: 'La Boca',
        provider: 'osm',
        externalId: 'relation:2',
        role: 'area' as const,
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'UNKNOWN',
        } as const,
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
          evidenceKeys: ['e'],
        },
        {
          key: 'a2',
          name: 'La Boca',
          role: 'area',
          expectedKind: 'AREA',
          evidenceKeys: ['e'],
        },
        {
          key: 'w1',
          name: 'Plaza Dorrego',
          role: 'waypoint',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
        {
          key: 'w2',
          name: 'Caminito',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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

    // Stage 2 migration seam (geo-entity-hint-required-migration.util.ts):
    // `GeoEntityHint.required` is no longer LLM-authored -- there is no more
    // "optional (non-required) AREA hint" to construct. A single AREA hint
    // alongside waypoint hints is now unconditionally treated as required,
    // so the canonical-area shortcut DOES trigger here (Stage 4 owns the
    // real per-component-outcome redesign of this strategy selection).
    it('triggers the canonical-area shortcut for a single AREA hint (no more optional/required distinction pre-Stage-4)', () => {
      const candidate = areaCandidate([
        {
          key: 'a',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          evidenceKeys: ['e'],
        },
        {
          key: 'w1',
          name: 'Plaza Dorrego',
          role: 'waypoint',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
        {
          key: 'w2',
          name: 'Parque Lezama',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.628,
              longitude: -58.371,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.strategy).toBe('canonical_area');
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
      kind: 'ROUTE' as const,
      nameEvidenceMultiplicity: {
        exactName: 'UNKNOWN',
        declaredAlias: 'UNKNOWN',
      } as const,
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

    it('rejects a canonical ROUTE candidate whose waypoint has no topological relation to the route and lies outside the destination (S-c membership, no radius)', () => {
      const candidate = routeCandidate([
        {
          key: 'r',
          name: 'Caminito',
          role: 'route',
          expectedKind: 'ROUTE',
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Far waypoint',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
      expect(result.rejectionReasons).toEqual(['outside_experience_scope']);
      expect(result.experienceScope).toEqual(
        expect.objectContaining({ provenance: 'CANDIDATE_ROUTE' }),
      );
      expect(
        result.decisionEntities?.find((entity) => entity.hintKey === 'w'),
      ).toEqual(
        expect.objectContaining({
          relation: 'offending',
          decisionReason: 'OUTSIDE_EXPERIENCE_ROUTE_SCOPE',
        }),
      );
    });

    it('rejects a canonical ROUTE candidate with an unresolved source waypoint (incomplete composition)', () => {
      const candidate = routeCandidate([
        {
          key: 'r',
          name: 'Caminito',
          role: 'route',
          expectedKind: 'ROUTE',
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Missing waypoint',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
        'incomplete_source_composition',
      );
    });

    it('accepts a canonical ROUTE candidate whose waypoint is a destination-compatible extension of the route', () => {
      const candidate = routeCandidate([
        {
          key: 'r',
          name: 'Caminito',
          role: 'route',
          expectedKind: 'ROUTE',
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'Fundación Proa',
          role: 'waypoint',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
    // that two points ~78 km apart both stay inside it: proves no
    // coherence radius decides validity any more (spec Part II §P2-8).
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
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'UNKNOWN',
        } as const,
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
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'UNKNOWN',
        } as const,
        status: 'resolved' as const,
        latitude: -34.85,
        longitude: -58.4,
      },
    ];

    it('authorization never selects a radius: two venues ~78 km apart inside ONE destination polygon are accepted under DEFAULT and ROUTE_LIKE alike', () => {
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
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Winery B',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['e'],
          },
        ],
      };
      for (const authorization of [
        undefined,
        ownedAuthorization('route_like'),
      ]) {
        const result = new CompositeGeographicValidationService().validate(
          {
            candidate,
            status: 'accepted',
            resolvedEntities: wideSpreadEntities,
            rejectionReasons: [],
          },
          wideBoundary,
          undefined,
          authorization,
        );
        expect(result.accepted).toBe(true);
        expect(result.strategy).toBe('component_defined');
        expect(result.experienceScope?.provenance).toBe('DESTINATION_AREA');
      }
    });

    it('candidate.intents never selects the policy: a DEFAULT candidate claiming route_like with venues beyond the destination is a plain destination mismatch, never a regional scope', () => {
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
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Winery B',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['e'],
          },
        ],
      };
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: wideSpreadEntities,
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['destination_mismatch']);
    });

    it('E: a ROUTE_LIKE candidate with a stop beyond the destination and no verified scope is GEOGRAPHIC_SCOPE_UNKNOWN (PD2 fail-closed, no circle)', () => {
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
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Far winery',
            role: 'venue',
            expectedKind: 'PLACE',
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
          nameEvidenceMultiplicity: {
            exactName: 'UNKNOWN',
            declaredAlias: 'UNKNOWN',
          } as const,
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
          nameEvidenceMultiplicity: {
            exactName: 'UNKNOWN',
            declaredAlias: 'UNKNOWN',
          } as const,
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
        ownedAuthorization('route_like'),
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['geographic_scope_unknown']);
      expect(result.experienceScope).toEqual(
        expect.objectContaining({ provenance: 'DESTINATION_AREA' }),
      );
      expect(result.destinationRelation?.relation).toBe(
        'EXTENDS_BEYOND_DESTINATION',
      );
      expect(
        result.decisionEntities?.find((entity) => entity.hintKey === 'w2')
          ?.decisionReason,
      ).toBe('GEOGRAPHIC_SCOPE_UNKNOWN');
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
            evidenceKeys: ['e'],
          },
          {
            key: 'w2',
            name: 'Caminito',
            role: 'waypoint',
            expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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

    it('rejects (before persistence) when a component is outside the external AREA scope, even with NO AREA hint on the candidate', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
        {
          key: 'p2',
          name: 'Mercado de San Telmo',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
        {
          key: 'p3',
          name: 'MALBA',
          role: 'venue',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
      expect(result.areaScopeMembership).toMatchObject({
        policy: 'AREA_CONTAINED',
        routeGeometryPresent: false,
        evaluatedComponentCount: 3,
        decision: {
          routeIntersectsArea: false,
          pointComponentInside: true,
          passes: false,
        },
      });
      expect(result.decisionEntities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ hintKey: 'p1', relation: 'evaluated' }),
          expect.objectContaining({ hintKey: 'p3', relation: 'offending' }),
        ]),
      );
    });

    it('accepts when every component (no AREA hint on the candidate) is genuinely inside the external AREA scope', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
        {
          key: 'p2',
          name: 'Mercado de San Telmo',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
        {
          key: 'p3',
          name: 'Pasaje Defensa',
          role: 'venue',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
      expect(result.areaScopeMembership).toMatchObject({
        policy: 'AREA_CONTAINED',
        routeGeometryPresent: false,
        evaluatedComponentCount: 3,
        decision: {
          routeIntersectsArea: false,
          pointComponentInside: true,
          passes: true,
        },
      });
    });

    it('rejects with incomplete_source_composition when a source hint is unresolved, before checking the scope geometry', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
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
        'incomplete_source_composition',
      );
    });

    it('fails closed (rejects) when the AREA validationScope has no usable geometry', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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

    it('rejects (N1 / M2) when a required component is genuinely close to the external ROUTE scope but lacks the anchor component (proximity does not satisfy anchor)', () => {
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Fundación Proa',
          role: 'venue',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
      const offending = result.decisionEntities?.find(
        (e) => e.relation === 'offending',
      );
      expect(offending).toBeDefined();
      expect(offending?.decisionReason).toBe('NO_MATERIAL_ANCHOR_RELATION');
      expect(offending?.distanceFromRouteMeters).toBeLessThan(20);
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
            evidenceKeys: ['e'],
          },
          {
            key: 'p1',
            name: 'Fundación Proa',
            role: 'venue',
            expectedKind: 'PLACE',
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
              kind: 'ROUTE',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
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

    it('fails closed on a malformed AREA scope geometry regardless of required-entity count (review fix; Stage 2: every hint is now required, so this exercises the count=1 case, not count=0)', () => {
      // The scope-geometry-usability check runs unconditionally, BEFORE any
      // per-entity distance check that would depend on `requiredEntities`
      // -- so it must fail closed here whether the required-entity count is
      // 0 (pre-Stage-2, with an LLM-authored optional hint) or 1 (Stage 2:
      // no more optional hints, see geo-entity-hint-required-migration.util.ts).
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
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
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.621,
              longitude: -58.371,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        // A LineString where an AREA scope was declared -- a real
        // malformed-kind mismatch, not just a missing geometry.
        { ...areaScope, geometry: caminitoScopeGeometry },
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
    });

    it('fails closed on a malformed ROUTE scope geometry even when the only required hint is the route itself (no point-like entities to check)', () => {
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
              kind: 'ROUTE',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6,
              longitude: -58.42,
              geometry: caminitoScopeGeometry,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        // A Polygon (or a degenerate single-point LineString) where a real
        // usable ROUTE LineString was required.
        { ...routeScopeObj, geometry: sanTelmoScopeGeometry },
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
    });

    it('fails closed on a degenerate single-point LineString ROUTE scope, no point-like entities required', () => {
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
              kind: 'ROUTE',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6,
              longitude: -58.42,
              geometry: caminitoScopeGeometry,
            },
          ],
          rejectionReasons: [],
        },
        boundary,
        {
          ...routeScopeObj,
          geometry: { type: 'LineString', coordinates: [[-58.363, -34.638]] },
        },
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
    });
  });
});

describe('Regression tests for forensic geographic trace evidence', () => {
  const destinationBoundary: any = {
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
    nameEvidenceMultiplicity: {
      exactName: 'SINGLE',
      declaredAlias: 'UNKNOWN',
    } as const,
  };

  it('rejects when one component is inside and another is outside the destination polygon', () => {
    const candidate: ExperienceCandidate = {
      name: 'Two component walk',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e1', 'e2'],
      shortReason: 'grounded composite',
      componentHints: [
        {
          key: 'inside',
          name: 'Inside Place',
          role: 'waypoint',
          expectedKind: 'PLACE',
          evidenceKeys: ['e1'],
        },
        {
          key: 'outside',
          name: 'Outside Place',
          role: 'venue',
          expectedKind: 'PLACE',
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
            hintKey: 'inside',
            hintName: 'Inside Place',
            provider: 'osm',
            externalId: 'node:inside',
            role: 'waypoint',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -34.6,
            longitude: -58.4,
          },
          {
            hintKey: 'outside',
            hintName: 'Outside Place',
            provider: 'osm',
            externalId: 'node:outside',
            role: 'venue',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -35.0,
            longitude: -59.0,
          },
        ],
        rejectionReasons: [],
      },
      destinationBoundary,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('destination_mismatch');

    const outsideEntity = result.decisionEntities!.find(
      (e) => e.hintKey === 'outside',
    );
    expect(outsideEntity).toBeDefined();
    expect(outsideEntity!.relation).toBe('offending');
    expect(outsideEntity!.decisionReason).toBe('OUTSIDE_DESTINATION_BOUNDARY');
    expect(outsideEntity!.distanceToBoundaryMeters).toBeDefined();
    expect(Number.isFinite(outsideEntity!.distanceToBoundaryMeters!)).toBe(
      true,
    );
    expect(outsideEntity!.distanceToBoundaryMeters! > 0).toBe(true);

    const insideEntity = result.decisionEntities!.find(
      (e) => e.hintKey === 'inside',
    );
    expect(insideEntity).toBeDefined();
    expect(insideEntity!.relation).not.toBe('offending');
  });

  it('marks all multiple outside components as offending with distinct distances', () => {
    const candidate: ExperienceCandidate = {
      name: 'Three outside places',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e1', 'e2', 'e3'],
      shortReason: 'grounded composite',
      componentHints: [
        {
          key: 'o1',
          name: 'Outside 1',
          role: 'waypoint',
          expectedKind: 'PLACE',
          evidenceKeys: ['e1'],
        },
        {
          key: 'o2',
          name: 'Outside 2',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e2'],
        },
        {
          key: 'o3',
          name: 'Outside 3',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e3'],
        },
      ],
    };

    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'o1',
            hintName: 'Outside 1',
            provider: 'osm',
            externalId: 'node:o1',
            role: 'waypoint',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -35.0,
            longitude: -59.0,
          },
          {
            hintKey: 'o2',
            hintName: 'Outside 2',
            provider: 'osm',
            externalId: 'node:o2',
            role: 'venue',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -35.1,
            longitude: -59.1,
          },
          {
            hintKey: 'o3',
            hintName: 'Outside 3',
            provider: 'osm',
            externalId: 'node:o3',
            role: 'venue',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -35.2,
            longitude: -59.2,
          },
        ],
        rejectionReasons: [],
      },
      destinationBoundary,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('destination_mismatch');

    const offendingEntities = result.decisionEntities!.filter(
      (e) => e.relation === 'offending',
    );
    expect(offendingEntities.length).toBe(3);
    for (const entity of offendingEntities) {
      expect(entity.decisionReason).toBe('OUTSIDE_DESTINATION_BOUNDARY');
      expect(entity.distanceToBoundaryMeters).toBeDefined();
      expect(Number.isFinite(entity.distanceToBoundaryMeters!)).toBe(true);
      expect(entity.distanceToBoundaryMeters! > 0).toBe(true);
    }
  });

  it('uses OUTSIDE_CANONICAL_AREA_BOUNDARY (not OUTSIDE_DESTINATION_BOUNDARY) when component is outside canonical area', () => {
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
          evidenceKeys: ['e'],
        },
        {
          key: 'w',
          name: 'MALBA',
          role: 'waypoint',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
      ],
    };

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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -34.58,
            longitude: -58.4,
          },
        ],
        rejectionReasons: [],
      },
      destinationBoundary,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toEqual(['outside_experience_scope']);

    const outsideEntity = result.decisionEntities!.find(
      (e) => e.hintKey === 'w',
    );
    expect(outsideEntity).toBeDefined();
    expect(outsideEntity!.relation).toBe('offending');
    expect(outsideEntity!.decisionReason).toBe(
      'OUTSIDE_CANONICAL_AREA_BOUNDARY',
    );
    expect(outsideEntity!.decisionReason).not.toBe(
      'OUTSIDE_DESTINATION_BOUNDARY',
    );
    expect(outsideEntity!.distanceToBoundaryMeters).toBeDefined();
    expect(Number.isFinite(outsideEntity!.distanceToBoundaryMeters!)).toBe(
      true,
    );
    expect(outsideEntity!.distanceToBoundaryMeters! > 0).toBe(true);
  });

  it('uses OUTSIDE_POINT_RADIUS_SCOPE (not EXTERNAL_AREA_SCOPE_MISMATCH) and has no distance for point radius rejection', () => {
    const candidate: ExperienceCandidate = {
      name: 'Point radius walk',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'v',
          name: 'Far Place',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
      ],
    };

    const pointRadiusScope: GeographicScope = {
      kind: 'POINT_RADIUS',
      latitude: -34.6,
      longitude: -58.4,
      radiusMeters: 1000,
    };

    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'v',
            hintName: 'Far Place',
            provider: 'osm',
            externalId: 'node:far',
            role: 'venue',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -35.0,
            longitude: -59.0,
          },
        ],
        rejectionReasons: [],
      },
      undefined,
      undefined,
      undefined,
      pointRadiusScope,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('external_scope_mismatch');

    const outsideEntity = result.decisionEntities!.find(
      (e) => e.hintKey === 'v',
    );
    expect(outsideEntity).toBeDefined();
    expect(outsideEntity!.relation).toBe('offending');
    expect(outsideEntity!.decisionReason).toBe('OUTSIDE_POINT_RADIUS_SCOPE');
    expect(outsideEntity!.decisionReason).not.toBe(
      'EXTERNAL_AREA_SCOPE_MISMATCH',
    );
    expect(outsideEntity!.distanceToBoundaryMeters).toBeUndefined();
  });

  it('uses EXTERNAL_ROUTE_SCOPE_MISMATCH (not EXTERNAL_AREA_SCOPE_MISMATCH) for invalid route scope geometry', () => {
    const candidate: ExperienceCandidate = {
      name: 'Route scope test',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'p1',
          name: 'Place',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['e'],
        },
      ],
    };

    const invalidRouteScope: WorkUnitAnchorScope = {
      kind: 'ROUTE',
      anchorName: 'Caminito',
      geoEntityId: 'geo-caminito',
      geometry: { type: 'Point', coordinates: [-58.363, -34.638] },
    };

    const result = new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          {
            hintKey: 'p1',
            hintName: 'Place',
            provider: 'osm',
            externalId: 'node:p1',
            role: 'venue',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -34.621,
            longitude: -58.371,
          },
        ],
        rejectionReasons: [],
      },
      destinationBoundary,
      invalidRouteScope,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('external_scope_mismatch');

    const offendingEntity = result.decisionEntities!.find(
      (e) => e.relation === 'offending',
    );
    expect(offendingEntity).toBeDefined();
    expect(offendingEntity!.decisionReason).toBe(
      'EXTERNAL_ROUTE_SCOPE_MISMATCH',
    );
    expect(offendingEntity!.decisionReason).not.toBe(
      'EXTERNAL_AREA_SCOPE_MISMATCH',
    );
  });

  it('preserves EXTERNAL_ROUTE_SCOPE_MISMATCH reason without distance for route corridor rejection', () => {
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

    const candidate: ExperienceCandidate = {
      name: 'Caminito Area Walk',
      themes: [],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'p1',
          name: 'Far Stop',
          role: 'venue',
          expectedKind: 'PLACE',
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
            hintKey: 'p1',
            hintName: 'Far Stop',
            provider: 'osm',
            externalId: 'node:p1',
            role: 'venue',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -34.6,
            longitude: -58.42,
          },
        ],
        rejectionReasons: [],
      },
      destinationBoundary,
      routeScopeObj,
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('external_scope_mismatch');

    const offendingEntity = result.decisionEntities!.find(
      (e) => e.relation === 'offending',
    );
    expect(offendingEntity).toBeDefined();
    expect(offendingEntity!.decisionReason).toBe('NO_MATERIAL_ANCHOR_RELATION');
    expect(offendingEntity!.distanceToBoundaryMeters).toBeUndefined();
    expect(offendingEntity!.distanceFromRouteMeters).toBeGreaterThan(1000);
  });

  it('never stores non-finite distance for degenerate polygon', () => {
    const degenerateBoundary: any = {
      geometry: {
        type: 'Polygon',
        coordinates: [],
      },
    };

    const candidate: ExperienceCandidate = {
      name: 'Degenerate test',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: [
        {
          key: 'v',
          name: 'Venue',
          role: 'venue' as const,
          expectedKind: 'PLACE' as const,
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
            externalId: 'node:v',
            role: 'venue',
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: 1,
            longitude: 1,
          },
        ],
        rejectionReasons: [],
      },
      degenerateBoundary,
    );

    expect(result.accepted).toBe(false);

    const offendingEntity = result.decisionEntities!.find(
      (e) => e.relation === 'offending',
    );
    expect(offendingEntity).toBeDefined();
    // The rejection should be for destination boundary mismatch
    expect(offendingEntity!.decisionReason).toBe(
      'OUTSIDE_DESTINATION_BOUNDARY',
    );
    // Non-finite distance must be omitted (undefined), not serialized as null/0/Infinity/NaN
    expect(offendingEntity!.distanceToBoundaryMeters).toBeUndefined();

    // JSON serialization must not silently turn non-finite into null or include Infinity/NaN
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('"distanceToBoundaryMeters":null');
    expect(serialized).not.toContain('Infinity');
    expect(serialized).not.toContain('NaN');
  });

  it('accepted candidate has no bogus offending evidence', () => {
    const candidate: ExperienceCandidate = {
      name: 'Accepted walk',
      themes: ['culture'],
      traits: [],
      evidenceKeys: ['e1', 'e2'],
      shortReason: 'grounded composite',
      componentHints: [
        {
          key: 'a',
          name: 'Plaza A',
          role: 'waypoint',
          expectedKind: 'PLACE',
          evidenceKeys: ['e1'],
        },
        {
          key: 'b',
          name: 'Museum B',
          role: 'venue',
          expectedKind: 'PLACE',
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
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
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            } as const,
            status: 'resolved',
            latitude: -34.601,
            longitude: -58.401,
          },
        ],
        rejectionReasons: [],
      },
      destinationBoundary,
    );

    expect(result.accepted).toBe(true);
    expect(result.rejectionReasons).toHaveLength(0);

    for (const entity of result.decisionEntities!) {
      expect(entity.relation).not.toBe('offending');
      expect(entity.decisionReason).toBeUndefined();
      expect(entity.distanceToBoundaryMeters).toBeUndefined();
    }
  });

  /**
   * Stage 4: component relation vs composite coherence are separate
   * decisions, both through the single area-membership policy, over the
   * FULL source composition.
   */
  describe('Stage 4: structural composite geography', () => {
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
    const sanTelmo: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-58.373, -34.622],
          [-58.368, -34.622],
          [-58.368, -34.617],
          [-58.373, -34.617],
          [-58.373, -34.622],
        ],
      ],
    };
    const sanTelmoScope: WorkUnitAnchorScope = {
      kind: 'AREA',
      anchorName: 'San Telmo',
      geoEntityId: 'geo-san-telmo',
      geometry: sanTelmo,
    };
    const multiplicity = {
      exactName: 'SINGLE',
      declaredAlias: 'UNKNOWN',
    } as const;
    const entity = (
      hintKey: string,
      role: 'area' | 'waypoint' | 'route' | 'venue',
      place: Record<string, unknown>,
    ) => ({
      hintKey,
      hintName: hintKey,
      provider: 'openstreetmap',
      externalId: `osm:${hintKey}`,
      geoEntityId: `geo-${hintKey}`,
      role,
      nameEvidenceMultiplicity: multiplicity,
      status: 'resolved' as const,
      ...place,
    });
    const walk = (
      hints: Array<[string, 'area' | 'waypoint' | 'route' | 'venue']>,
    ): ExperienceCandidate => ({
      name: 'San Telmo Historic Walk',
      themes: ['history'],
      traits: [],
      evidenceKeys: ['e'],
      shortReason: 'grounded',
      componentHints: hints.map(([key, role]) => ({
        key,
        name: key,
        role,
        expectedKind:
          role === 'route' ? 'ROUTE' : role === 'area' ? 'AREA' : 'PLACE',
        evidenceKeys: ['e'],
      })),
    });
    // Plaza de Mayo DESIGN fixture: resolved point outside San Telmo.
    const plazaDeMayo = entity('plaza-de-mayo', 'waypoint', {
      kind: 'PLACE',
      latitude: -34.6195,
      longitude: -58.3755,
    });
    const calleDefensa = entity('calle-defensa', 'route', {
      kind: 'ROUTE',
      latitude: -34.6195,
      longitude: -58.372,
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-58.3745, -34.6195],
            [-58.3715, -34.6195],
          ],
          [
            [-58.3715, -34.6195],
            [-58.3695, -34.6195],
          ],
        ],
      },
    });
    const zanjon = entity('el-zanjon', 'venue', {
      kind: 'PLACE',
      latitude: -34.6195,
      longitude: -58.3705,
    });
    const hints: Array<[string, 'area' | 'waypoint' | 'route' | 'venue']> = [
      ['plaza-de-mayo', 'waypoint'],
      ['calle-defensa', 'route'],
      ['el-zanjon', 'venue'],
    ];

    it('an OUTSIDE component can belong to a coherent walk anchored by a route INTERSECTING the area', () => {
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate: walk(hints),
          status: 'accepted',
          resolvedEntities: [plazaDeMayo, calleDefensa, zanjon] as any,
          rejectionReasons: [],
        },
        boundary,
        sanTelmoScope,
        ownedAuthorization('walk', 'AREA_ROUTE_WALK'),
      );
      expect(result.accepted).toBe(true);
      expect(result.areaScopeMembership).toMatchObject({
        policy: 'AREA_ANCHORED_ROUTE',
        routeGeometryPresent: true,
        evaluatedComponentCount: 3,
        decision: {
          passes: true,
          routeIntersectsArea: true,
          pointComponentInside: true,
          components: [
            expect.objectContaining({
              hintKey: 'plaza-de-mayo',
              relation: 'OUTSIDE',
            }),
            expect.objectContaining({
              hintKey: 'calle-defensa',
              basis: 'LINE',
              relation: 'INTERSECTS',
            }),
            expect.objectContaining({
              hintKey: 'el-zanjon',
              relation: 'INSIDE',
            }),
          ],
        },
      });
    });

    it('the same component facts fail strict containment: coherence is a separate decision', () => {
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate: walk(hints),
          status: 'accepted',
          resolvedEntities: [plazaDeMayo, calleDefensa, zanjon] as any,
          rejectionReasons: [],
        },
        boundary,
        sanTelmoScope,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['external_scope_mismatch']);
      expect(
        result.decisionEntities
          ?.filter((item) => item.relation === 'offending')
          .map((item) => item.hintKey),
      ).toEqual(['plaza-de-mayo', 'calle-defensa']);
    });

    it('never validates a trimmed subset: one unresolved source component rejects the composition', () => {
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate: walk([...hints, ['pasaje-san-lorenzo', 'waypoint']]),
          status: 'accepted',
          resolvedEntities: [plazaDeMayo, calleDefensa, zanjon] as any,
          rejectionReasons: [],
        },
        boundary,
        sanTelmoScope,
        ownedAuthorization('walk', 'AREA_ROUTE_WALK'),
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual([
        'incomplete_source_composition',
      ]);
      expect(result.areaScopeMembership).toBeUndefined();
    });

    it('a resolved component with no canonical geography is not treated as coherent', () => {
      const result = new CompositeGeographicValidationService().validate(
        {
          candidate: walk(hints),
          status: 'accepted',
          resolvedEntities: [
            plazaDeMayo,
            calleDefensa,
            { ...zanjon, latitude: undefined, longitude: undefined },
          ] as any,
          rejectionReasons: [],
        },
        boundary,
      );
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['missing_coordinates']);
    });

    describe('canonical AREA shortcut uses the same relation policy', () => {
      const area = entity('san-telmo', 'area', {
        kind: 'AREA',
        latitude: -34.6195,
        longitude: -58.3705,
        geometry: sanTelmo,
      });
      // A passage resolved as a real ROUTE line, playing a waypoint role.
      const pasaje = entity('pasaje', 'waypoint', {
        kind: 'ROUTE',
        latitude: -34.6195,
        longitude: -58.3725,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-58.3735, -34.6195],
            [-58.3715, -34.6195],
          ],
        },
      });
      const candidateHints: Array<
        [string, 'area' | 'waypoint' | 'route' | 'venue']
      > = [
        ['san-telmo', 'area'],
        ['pasaje', 'waypoint'],
        ['el-zanjon', 'venue'],
      ];

      it('accepts a real line entering the canonical area', () => {
        const result = new CompositeGeographicValidationService().validate(
          {
            candidate: walk(candidateHints),
            status: 'accepted',
            resolvedEntities: [area, pasaje, zanjon] as any,
            rejectionReasons: [],
          },
          boundary,
        );
        expect(result.accepted).toBe(true);
        expect(result.strategy).toBe('canonical_area');
      });

      it('rejects a ROUTE-kind component without line geometry instead of trusting its representative point', () => {
        const result = new CompositeGeographicValidationService().validate(
          {
            candidate: walk(candidateHints),
            status: 'accepted',
            resolvedEntities: [
              area,
              { ...pasaje, geometry: undefined, longitude: -58.3705 },
              zanjon,
            ] as any,
            rejectionReasons: [],
          },
          boundary,
        );
        expect(result.accepted).toBe(false);
        expect(
          result.decisionEntities?.find((item) => item.hintKey === 'pasaje'),
        ).toMatchObject({
          relation: 'offending',
          decisionReason: 'OUTSIDE_CANONICAL_AREA_BOUNDARY',
        });
      });
    });
  });

  describe('Route-anchor geographic coherence & walking feasibility separation (G1-G6)', () => {
    const destinationBoundary: any = {
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
    const caminitoLineGeometry: GeoJsonGeometry = {
      type: 'LineString',
      coordinates: [
        [-58.36306, -34.63935],
        [-58.36287, -34.63972],
        [-58.36268, -34.6401],
      ],
    };
    const routeScope: WorkUnitAnchorScope = {
      kind: 'ROUTE',
      anchorName: 'Caminito',
      geoEntityId: 'geo-caminito',
      geometry: caminitoLineGeometry,
    };

    // G1: No 300m cliff — components at 299m and 301m both pass
    it('G1: proves no 300m cliff — components at 299m and 301m both pass without threshold-based rejection', () => {
      const validator = new CompositeGeographicValidationService();

      const candidate299: ExperienceCandidate = {
        name: 'Caminito Walk 299m',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'anchor',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'stop1',
            name: 'Nearby Spot',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const candidate301: ExperienceCandidate = {
        name: 'Caminito Walk 301m',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'anchor',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'stop1',
            name: 'Slightly Further Spot',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result299 = validator.validate(
        {
          candidate: candidate299,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'anchor',
              hintName: 'Caminito',
              role: 'route',
              provider: 'osm',
              externalId: 'way:144844726',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.63972,
              longitude: -58.36287,
              geometry: caminitoLineGeometry,
            },
            {
              hintKey: 'stop1',
              hintName: 'Nearby Spot',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:299',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.63972 + 0.00268,
              longitude: -58.36287,
            },
          ],
          rejectionReasons: [],
        },
        destinationBoundary,
        routeScope,
      );

      const result301 = validator.validate(
        {
          candidate: candidate301,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'anchor',
              hintName: 'Caminito',
              role: 'route',
              provider: 'osm',
              externalId: 'way:144844726',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.63972,
              longitude: -58.36287,
              geometry: caminitoLineGeometry,
            },
            {
              hintKey: 'stop1',
              hintName: 'Slightly Further Spot',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:301',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.63972 + 0.00272,
              longitude: -58.36287,
            },
          ],
          rejectionReasons: [],
        },
        destinationBoundary,
        routeScope,
      );

      expect(result299.accepted).toBe(true);
      expect(result299.status).toBe('GEO_VERIFIED');
      expect(result301.accepted).toBe(true);
      expect(result301.status).toBe('GEO_VERIFIED');

      // Observability: diagnostic distance recorded, NOT semantic reject authority
      const entity299 = result299.decisionEntities?.find(
        (e) => e.hintKey === 'stop1',
      );
      const entity301 = result301.decisionEntities?.find(
        (e) => e.hintKey === 'stop1',
      );
      expect(entity299?.distanceFromRouteMeters).toBeGreaterThan(250);
      expect(entity299?.distanceFromRouteMeters).toBeLessThan(350);
      expect(entity301?.distanceFromRouteMeters).toBeGreaterThan(250);
      expect(entity301?.distanceFromRouteMeters).toBeLessThan(350);
    });

    // G2: Real Caminito/Bombonera case
    it('G2: accepts real Caminito route + Quinquela Martín (~188m) + La Bombonera (~428m)', () => {
      const validator = new CompositeGeographicValidationService();
      const candidate: ExperienceCandidate = {
        name: 'Caminito & La Boca Iconic Walk',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'caminito',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'quinquela',
            name: 'Museo Benito Quinquela Martín',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'bombonera',
            name: 'Estadio La Bombonera',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = validator.validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'caminito',
              hintName: 'Caminito',
              role: 'route',
              provider: 'osm',
              externalId: 'way:144844726',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.63972,
              longitude: -58.36287,
              geometry: caminitoLineGeometry,
              adminContext: {
                locality: 'La Boca',
                municipality: 'Buenos Aires',
              },
            },
            {
              hintKey: 'quinquela',
              hintName: 'Museo Benito Quinquela Martín',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:quinquela',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6385,
              longitude: -58.3611, // ~188m
              adminContext: {
                locality: 'La Boca',
                municipality: 'Buenos Aires',
              },
            },
            {
              hintKey: 'bombonera',
              hintName: 'Estadio La Bombonera',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:bombonera',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6356,
              longitude: -58.3648, // ~428m
              adminContext: {
                locality: 'La Boca',
                municipality: 'Buenos Aires',
              },
            },
          ],
          rejectionReasons: [],
        },
        destinationBoundary,
        routeScope,
      );

      expect(result.accepted).toBe(true);
      expect(result.status).toBe('GEO_VERIFIED');
      expect(result.routeScopeMembership).toBeDefined();
      expect(result.routeScopeMembership?.decision.passes).toBe(true);

      const quinquelaFact =
        result.routeScopeMembership?.decision.components.find(
          (c) => c.hintKey === 'quinquela',
        );
      const bomboneraFact =
        result.routeScopeMembership?.decision.components.find(
          (c) => c.hintKey === 'bombonera',
        );
      expect(quinquelaFact?.distanceFromRouteMeters).toBeGreaterThan(150);
      expect(quinquelaFact?.distanceFromRouteMeters).toBeLessThan(250);
      expect(bomboneraFact?.distanceFromRouteMeters).toBeGreaterThan(400);
      expect(bomboneraFact?.distanceFromRouteMeters).toBeLessThan(500);
    });

    // G3: Anchor required
    it('G3: rejects unrelated Buenos Aires components with NO_MATERIAL_ANCHOR_RELATION when anchor is missing', () => {
      const validator = new CompositeGeographicValidationService();
      const candidate: ExperienceCandidate = {
        name: 'Downtown BA Walk',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'obelisco',
            name: 'Obelisco',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'colon',
            name: 'Teatro Colón',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = validator.validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'obelisco',
              hintName: 'Obelisco',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:obelisco',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6037,
              longitude: -58.3816,
            },
            {
              hintKey: 'colon',
              hintName: 'Teatro Colón',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:colon',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6011,
              longitude: -58.3831,
            },
          ],
          rejectionReasons: [],
        },
        destinationBoundary,
        routeScope,
      );

      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('external_scope_mismatch');
      const offending = result.decisionEntities?.find(
        (e) => e.relation === 'offending',
      );
      expect(offending?.decisionReason).toBe('NO_MATERIAL_ANCHOR_RELATION');
    });

    // G4: Destination mismatch
    it('G4: rejects component outside the destination boundary with OUTSIDE_DESTINATION_BOUNDARY', () => {
      const validator = new CompositeGeographicValidationService();
      const candidate: ExperienceCandidate = {
        name: 'Caminito to Far Destination Homonym',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'anchor',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'remote',
            name: 'Remote Stop',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = validator.validate(
        {
          candidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'anchor',
              hintName: 'Caminito',
              role: 'route',
              provider: 'osm',
              externalId: 'way:144844726',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6379,
              longitude: -58.3632,
              geometry: caminitoLineGeometry,
            },
            {
              hintKey: 'remote',
              hintName: 'Remote Stop',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:remote',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -31.42, // Córdoba - far outside Buenos Aires boundary
              longitude: -64.18,
            },
          ],
          rejectionReasons: [],
        },
        destinationBoundary,
        routeScope,
      );

      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain('destination_mismatch');
      const remoteEntity = result.decisionEntities?.find(
        (e) => e.hintKey === 'remote',
      );
      expect(remoteEntity?.relation).toBe('offending');
      expect(remoteEntity?.decisionReason).toBe('OUTSIDE_DESTINATION_BOUNDARY');
      expect(remoteEntity?.distanceToBoundaryMeters).toBeGreaterThan(100000);
    });

    // G5: Area context does not fake cardinality
    it('G5: proves area context does not count toward multi-component cardinality', () => {
      const singleStopWithArea: ExperienceCandidate = {
        name: 'Caminito in La Boca',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'caminito',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'boca',
            name: 'La Boca',
            role: 'area',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const twoStopsWithArea: ExperienceCandidate = {
        name: 'Caminito & Bombonera in La Boca',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'caminito',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'boca',
            name: 'La Boca',
            role: 'area',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'bombonera',
            name: 'La Bombonera',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      // 1 real stop + 1 area fails multi-component requirement
      expect(
        candidateSatisfiesEvidenceRequirement(
          singleStopWithArea,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(false);

      // 2 real stops + 1 area satisfies multi-component requirement
      expect(
        candidateSatisfiesEvidenceRequirement(
          twoStopsWithArea,
          'MULTI_COMPONENT_EXPERIENCE',
        ),
      ).toBe(true);
    });

    // G6: Planner owns walking feasibility
    it('G6: proves geographic validation passes long walk while planner rejects via mobility constraints', async () => {
      const validator = new CompositeGeographicValidationService();

      const longWalkCandidate: ExperienceCandidate = {
        name: 'Across Buenos Aires Epic Walk',
        themes: ['culture'],
        traits: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'caminito',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'belgrano',
            name: 'Belgrano Landmark',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      // 1. Geographic validation passes because both belong to Buenos Aires and anchor is satisfied
      const geoResult = validator.validate(
        {
          candidate: longWalkCandidate,
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'caminito',
              hintName: 'Caminito',
              role: 'route',
              provider: 'osm',
              externalId: 'way:144844726',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.6379,
              longitude: -58.3632,
              geometry: caminitoLineGeometry,
            },
            {
              hintKey: 'belgrano',
              hintName: 'Belgrano Landmark',
              role: 'venue',
              provider: 'osm',
              externalId: 'node:belgrano',
              nameEvidenceMultiplicity: {
                exactName: 'UNKNOWN',
                declaredAlias: 'UNKNOWN',
              } as const,
              status: 'resolved',
              latitude: -34.56,
              longitude: -58.45, // ~12km away in Buenos Aires
            },
          ],
          rejectionReasons: [],
        },
        destinationBoundary,
        routeScope,
      );

      expect(geoResult.accepted).toBe(true);
      expect(geoResult.status).toBe('GEO_VERIFIED');

      // 2. Planner evaluates walking feasibility and rejects with canonical MAX_WALKING_PER_DAY_EXCEEDED
      const plannerCandidate: PlanningExperienceCandidate = {
        experienceId: 'exp-long-walk',
        title: 'Across Buenos Aires Epic Walk',
        durationMinutes: 90,
        semanticScore: 1,
        spatialFootprint: {
          type: 'POINT',
          centroid: { lat: -34.56, lng: -58.45 },
        },
        startFootprint: {
          type: 'POINT',
          centroid: { lat: -34.6379, lng: -58.3632 },
        },
        endFootprint: {
          type: 'POINT',
          centroid: { lat: -34.56, lng: -58.45 },
        },
        mobility: {
          internalWalkingDistanceMeters: 12500, // 12.5km internal walk
        },
      };

      const dayAcc = {
        dayNumber: 1,
        assigned: [] as PlanningExperienceCandidate[],
        totalExperienceMinutes: 0,
        totalWalkingMeters: 0,
      };

      const planningContext = {
        policy: {
          paceTargets: {
            relaxed: { preferredExperiencesMin: 2, preferredExperiencesMax: 4 },
            moderate: {
              preferredExperiencesMin: 3,
              preferredExperiencesMax: 5,
            },
            fast: { preferredExperiencesMin: 4, preferredExperiencesMax: 7 },
          },
          travel: {
            detourFactor: 1.3,
            walkingSpeedKmh: 4.5,
            bikeSpeedKmh: 13,
            carUrbanSpeedKmh: 25,
          },
          internalWalking: { unknownFallbackMinutes: 20 },
          compositeDefaultDurationMinutes: 90,
          scoring: {
            semanticWeight: 1,
            qualityWeight: 0.5,
            dayBalanceWeight: 0.25,
          },
          localImprovement: { maxIterations: 50 },
          backfill: {
            minimumUsefulResidualMinutes: 60,
            maxReservoirPromotionAttempts: 50,
            maxAcquisitionPasses: 1,
          },
          window: {
            startMinutesFromMidnight: 540,
            endMinutesFromMidnight: 1200,
          },
        },
        mobility: {
          allowedTransportationModes: [TransportationMode.WALKING],
          maxWalkingDistancePerDayMeters: 8000, // 8km limit
          maxContinuousWalkingDistanceMeters: 5000,
          travelPace: 'moderate' as any,
          accessibilityNeeds: [] as string[],
        },
        planningWindow: {
          startMinutesFromMidnight: 540,
          endMinutesFromMidnight: 1200,
        },
        travelEstimateProvider: {
          estimate: jest.fn().mockResolvedValue({
            durationMinutes: 15,
            walkingDistanceMeters: 500,
            mode: TransportationMode.WALKING,
          }),
        },
        startDates: [] as string[],
      };

      const plannerResult = await checkHardConstraints(
        plannerCandidate,
        dayAcc,
        planningContext,
      );
      expect(plannerResult.feasible).toBe(false);
      expect(plannerResult.reasons).toContain('MAX_WALKING_PER_DAY_EXCEEDED');
      expect(
        plannerResult.walkingDiagnostics?.dailyWalkingMeters,
      ).toBeGreaterThan(8000);
    });
  });
});

describe('CompositeGeographicValidationService · canonical physical ROUTE authority vs hint role (matrix F/G)', () => {
  // Wide destination: two venues ~78km apart stay inside it and within the
  // route-scale radius, so ONLY the threshold set chosen decides.
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
  const venue = (key: string, latitude: number) => ({
    hintKey: key,
    hintName: `Winery ${key}`,
    provider: 'osm',
    externalId: `node:${key}`,
    role: 'venue' as const,
    nameEvidenceMultiplicity: {
      exactName: 'UNKNOWN',
      declaredAlias: 'UNKNOWN',
    } as const,
    status: 'resolved' as const,
    latitude,
    longitude: -58.4,
  });
  const routeHintCandidate = (intents: string[] = []): ExperienceCandidate => ({
    name: 'Wine road',
    themes: [],
    traits: [],
    intents,
    evidenceKeys: ['e'],
    shortReason: 'grounded',
    componentHints: [
      {
        key: 'r',
        name: 'Wine road',
        role: 'route',
        expectedKind: 'ROUTE',
        evidenceKeys: ['e'],
      },
      {
        key: 'w1',
        name: 'Winery w1',
        role: 'venue',
        expectedKind: 'PLACE',
        evidenceKeys: ['e'],
      },
      {
        key: 'w2',
        name: 'Winery w2',
        role: 'venue',
        expectedKind: 'PLACE',
        evidenceKeys: ['e'],
      },
    ],
  });
  const routeRoleEntity = (facts: {
    kind?: 'ROUTE' | 'PLACE';
    geometry?: unknown;
  }) => ({
    hintKey: 'r',
    hintName: 'Wine road',
    provider: 'osm',
    externalId: 'way:wine',
    role: 'route' as const,
    nameEvidenceMultiplicity: {
      exactName: 'UNKNOWN',
      declaredAlias: 'UNKNOWN',
    } as const,
    status: 'resolved' as const,
    latitude: -34.5,
    longitude: -58.4,
    ...(facts.kind ? { kind: facts.kind } : {}),
    ...(facts.geometry ? { geometry: facts.geometry } : {}),
  });
  // w2 at -35.5 lies beyond the destination: only a real canonical route
  // scope (never a role) could have related it -- and here none exists.
  const validate = (
    routeEntity: ReturnType<typeof routeRoleEntity>,
    candidate = routeHintCandidate(),
    w2Latitude = -35.5,
  ) =>
    new CompositeGeographicValidationService().validate(
      {
        candidate,
        status: 'accepted',
        resolvedEntities: [
          routeEntity,
          venue('w1', -34.15),
          venue('w2', w2Latitude),
        ],
        rejectionReasons: [],
      },
      wideBoundary,
    );

  it.each([
    [
      'resolved to a PLACE',
      {
        kind: 'PLACE' as const,
        geometry: { type: 'Point', coordinates: [-58.4, -34.5] },
      },
    ],
    ['resolved to a ROUTE without geometry', { kind: 'ROUTE' as const }],
    [
      'resolved to a ROUTE with a non-line geometry',
      {
        kind: 'ROUTE' as const,
        geometry: { type: 'Point', coordinates: [-58.4, -34.5] },
      },
    ],
    [
      'with a line geometry but no canonical ROUTE kind',
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [-58.4, -34.5],
            [-58.39, -34.51],
          ],
        },
      },
    ],
    [
      'resolved to a ROUTE with a degenerate one-point line',
      {
        kind: 'ROUTE' as const,
        geometry: { type: 'LineString', coordinates: [[-58.4, -34.5]] },
      },
    ],
  ])(
    'F: a route-role hint %s grants NO route scope (fails closed to the destination scope)',
    (_label, facts) => {
      const result = validate(routeRoleEntity(facts));
      expect(result.strategy).not.toBe('canonical_geometry');
      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toEqual(['destination_mismatch']);
      expect(result.experienceScope?.provenance).toBe('DESTINATION_AREA');
    },
  );

  it('F+E: a route-role hint plus candidate.intents route_like still cannot widen a DEFAULT candidate', () => {
    const result = validate(
      routeRoleEntity({
        kind: 'PLACE',
        geometry: { type: 'Point', coordinates: [-58.4, -34.5] },
      }),
      routeHintCandidate(['route_like']),
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toEqual(['destination_mismatch']);
  });

  it('G: a VERIFIED canonical ROUTE GeoEntity with usable line geometry keeps canonical route-geometry validation, independent of any request intent', () => {
    const result = validate(
      routeRoleEntity({
        kind: 'ROUTE',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-58.4, -34.5],
              [-58.39, -34.51],
            ],
          ],
        },
      }),
      routeHintCandidate(),
      -34.85,
    );
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('canonical_geometry');
    expect(result.experienceScope?.provenance).toBe('CANDIDATE_ROUTE');
    expect(result.kind).toBe('ROUTE');
  });
});
