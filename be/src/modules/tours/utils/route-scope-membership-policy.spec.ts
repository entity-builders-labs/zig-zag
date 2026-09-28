import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { evaluateRouteScopeMembership } from './route-scope-membership-policy';
import { RouteScopeComponentFact } from '../interfaces/route-scope-membership.interface';

describe('evaluateRouteScopeMembership', () => {
  // Real Caminito LineString in La Boca, Buenos Aires
  const caminitoGeometry: GeoJsonGeometry = {
    type: 'LineString',
    coordinates: [
      [-58.36306, -34.63935],
      [-58.36287, -34.63972],
      [-58.36268, -34.6401],
    ],
  };

  const routeScope = {
    anchorName: 'Caminito',
    geoEntityId: 'geo-caminito-1',
    geometry: caminitoGeometry,
  };

  // Buenos Aires polygon covering La Boca
  const buenosAiresBoundary: OsmCandidate = {
    id: 'osm:relation:1224652',
    osmType: 'relation',
    osmId: 1224652,
    name: 'Ciudad Autónoma de Buenos Aires',
    tags: { admin_level: '8' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.53, -34.53],
          [-58.35, -34.53],
          [-58.35, -34.7],
          [-58.53, -34.7],
          [-58.53, -34.53],
        ],
      ],
    },
  };

  // La Boca polygon enclosing Caminito and nearby stops
  const laBocaGeometry: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-58.37, -34.63],
        [-58.35, -34.63],
        [-58.35, -34.65],
        [-58.37, -34.65],
        [-58.37, -34.63],
      ],
    ],
  };

  it('rejects with EXTERNAL_ROUTE_SCOPE_MISMATCH when route geometry is missing or invalid', () => {
    const invalidScope = {
      anchorName: 'Caminito',
      geometry: { type: 'Point', coordinates: [-58.36, -34.64] } as any,
    };
    const components: RouteScopeComponentFact[] = [
      {
        hintKey: 'c1',
        hintName: 'Caminito',
        role: 'route',
        geoEntityId: 'geo-caminito-1',
        latitude: -34.6395,
        longitude: -58.3629,
      },
    ];

    const decision = evaluateRouteScopeMembership(
      invalidScope,
      components,
      buenosAiresBoundary,
    );
    expect(decision.passes).toBe(false);
    expect(decision.rejectionReason).toBe('EXTERNAL_ROUTE_SCOPE_MISMATCH');
  });

  it('rejects with NO_MATERIAL_ANCHOR_RELATION when Experience contains NO component satisfying the anchor (Case C / G3)', () => {
    // Unrelated stops in Buenos Aires (e.g. Obelisco & Teatro Colón)
    const unrelatedComponents: RouteScopeComponentFact[] = [
      {
        hintKey: 'obelisco',
        hintName: 'Obelisco',
        role: 'venue',
        geoEntityId: 'geo-obelisco',
        latitude: -34.6037,
        longitude: -58.3816,
      },
      {
        hintKey: 'teatro_colon',
        hintName: 'Teatro Colón',
        role: 'venue',
        geoEntityId: 'geo-teatro-colon',
        latitude: -34.6011,
        longitude: -58.3831,
      },
    ];

    const decision = evaluateRouteScopeMembership(
      routeScope,
      unrelatedComponents,
      buenosAiresBoundary,
    );
    expect(decision.passes).toBe(false);
    expect(decision.hasAnchorSatisfaction).toBe(false);
    expect(decision.rejectionReason).toBe('NO_MATERIAL_ANCHOR_RELATION');
  });

  it('rejects with OUTSIDE_DESTINATION_BOUNDARY when a component is outside the destination boundary (Case B / G4)', () => {
    const components: RouteScopeComponentFact[] = [
      {
        hintKey: 'c1',
        hintName: 'Caminito',
        role: 'route',
        geoEntityId: 'geo-caminito-1',
        latitude: -34.6395,
        longitude: -58.3629,
      },
      {
        hintKey: 'ezeiza_stop',
        hintName: 'Caminito Ezeiza Outpost',
        role: 'venue',
        latitude: -34.85, // Far outside Buenos Aires polygon
        longitude: -58.52,
      },
    ];

    const decision = evaluateRouteScopeMembership(
      routeScope,
      components,
      buenosAiresBoundary,
    );
    expect(decision.passes).toBe(false);
    expect(decision.hasDestinationMismatch).toBe(true);
    expect(decision.rejectionReason).toBe('OUTSIDE_DESTINATION_BOUNDARY');
    const outsideComp = decision.components.find(
      (c) => c.hintKey === 'ezeiza_stop',
    );
    expect(outsideComp?.relation).toBe('OUTSIDE_DESTINATION');
  });

  it('passes for components at 299m and 301m without any 300m cliff (G1)', () => {
    // Points along latitude offset from Caminito:
    // Caminito is around (-58.3629, -34.6397).
    // ~0.0027 deg latitude is ~300 meters.
    const point299m: RouteScopeComponentFact = {
      hintKey: 'p299',
      hintName: 'Near Stop 299m',
      role: 'venue',
      latitude: -34.63972 + 0.00268,
      longitude: -58.36287,
    };
    const point301m: RouteScopeComponentFact = {
      hintKey: 'p301',
      hintName: 'Near Stop 301m',
      role: 'venue',
      latitude: -34.63972 + 0.00272,
      longitude: -58.36287,
    };

    const components: RouteScopeComponentFact[] = [
      {
        hintKey: 'caminito',
        hintName: 'Caminito',
        role: 'route',
        geoEntityId: 'geo-caminito-1',
        latitude: -34.63972,
        longitude: -58.36287,
      },
      point299m,
      point301m,
    ];

    const decision = evaluateRouteScopeMembership(
      routeScope,
      components,
      buenosAiresBoundary,
    );

    expect(decision.passes).toBe(true);
    expect(decision.hasAnchorSatisfaction).toBe(true);
    expect(decision.hasDestinationMismatch).toBe(false);

    const fact299 = decision.components.find((c) => c.hintKey === 'p299');
    const fact301 = decision.components.find((c) => c.hintKey === 'p301');

    expect(fact299?.relation).toBe('DESTINATION_COMPATIBLE_EXTENSION');
    expect(fact301?.relation).toBe('DESTINATION_COMPATIBLE_EXTENSION');

    // Both have measured diagnostic distances recorded for observability
    expect(fact299?.distanceFromRouteMeters).toBeGreaterThan(250);
    expect(fact299?.distanceFromRouteMeters).toBeLessThan(350);
    expect(fact301?.distanceFromRouteMeters).toBeGreaterThan(250);
    expect(fact301?.distanceFromRouteMeters).toBeLessThan(350);
  });

  it('passes the real Caminito + Quinquela Martín + La Bombonera case (G2)', () => {
    // Real coordinates from RW3 spike:
    // Caminito: (-58.36287, -34.63972)
    // Museo Quinquela Martín: (-58.3611, -34.6385) -> ~188m
    // La Bombonera: (-58.3648, -34.6356) -> ~428m
    const components: RouteScopeComponentFact[] = [
      {
        hintKey: 'caminito',
        hintName: 'Caminito',
        role: 'route',
        geoEntityId: 'geo-caminito-1',
        latitude: -34.63972,
        longitude: -58.36287,
      },
      {
        hintKey: 'quinquela',
        hintName: 'Museo Benito Quinquela Martín',
        role: 'venue',
        latitude: -34.6385,
        longitude: -58.3611,
      },
      {
        hintKey: 'bombonera',
        hintName: 'Estadio La Bombonera',
        role: 'venue',
        latitude: -34.6356,
        longitude: -58.3648,
      },
      {
        hintKey: 'la_boca',
        hintName: 'La Boca',
        role: 'area',
        geometry: laBocaGeometry,
      },
    ];

    const decision = evaluateRouteScopeMembership(
      routeScope,
      components,
      buenosAiresBoundary,
    );

    expect(decision.passes).toBe(true);
    expect(decision.hasAnchorSatisfaction).toBe(true);
    expect(decision.hasDestinationMismatch).toBe(false);

    const caminitoFact = decision.components.find(
      (c) => c.hintKey === 'caminito',
    );
    const quinquelaFact = decision.components.find(
      (c) => c.hintKey === 'quinquela',
    );
    const bomboneraFact = decision.components.find(
      (c) => c.hintKey === 'bombonera',
    );

    expect(caminitoFact?.relation).toBe('ANCHOR_COMPONENT');
    // Both Quinquela and Bombonera sit in the enclosing La Boca neighborhood polygon
    expect(quinquelaFact?.relation).toBe('SAME_LOCAL_SCOPE');
    expect(bomboneraFact?.relation).toBe('SAME_LOCAL_SCOPE');

    // Diagnostic distance preserved:
    expect(quinquelaFact?.distanceFromRouteMeters).toBeGreaterThan(150);
    expect(quinquelaFact?.distanceFromRouteMeters).toBeLessThan(250);
    expect(bomboneraFact?.distanceFromRouteMeters).toBeGreaterThan(400);
    expect(bomboneraFact?.distanceFromRouteMeters).toBeLessThan(500);
  });
});
