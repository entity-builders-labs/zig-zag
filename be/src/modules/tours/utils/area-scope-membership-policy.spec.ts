import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { evaluateAreaScopeMembership } from './area-scope-membership-policy';

const area: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

describe('area scope membership policy', () => {
  it('accepts strict contained components', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          { required: true, role: 'venue', latitude: 2, longitude: 2 },
          { required: true, role: 'venue', latitude: 8, longitude: 8 },
        ],
        'AREA_CONTAINED',
      ).passes,
    ).toBe(true);
  });

  it('rejects strict containment when a required component is outside', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          { required: true, role: 'venue', latitude: 2, longitude: 2 },
          { required: true, role: 'venue', latitude: 20, longitude: 20 },
        ],
        'AREA_CONTAINED',
      ).passes,
    ).toBe(false);
  });

  it('accepts an anchored route whose canonical geometry enters the area', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          { required: true, role: 'waypoint', latitude: 20, longitude: 20 },
          {
            required: true,
            role: 'route',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-2, 5],
                [5, 5],
              ],
            },
          },
        ],
        'AREA_ANCHORED_ROUTE',
      ).passes,
    ).toBe(true);
  });

  it('rejects an unrelated route and bare AREA', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          {
            required: true,
            role: 'route',
            geometry: {
              type: 'LineString',
              coordinates: [
                [20, 20],
                [30, 30],
              ],
            },
          },
        ],
        'AREA_ANCHORED_ROUTE',
      ).passes,
    ).toBe(false);
    expect(
      evaluateAreaScopeMembership(
        area,
        [{ required: true, role: 'area', latitude: 5, longitude: 5 }],
        'AREA_ANCHORED_ROUTE',
      ).passes,
    ).toBe(false);
  });

  /**
   * Stage 1 characterization lock (component-resolution-and-partial-
   * composite-recovery-plan.md, Case C/D). The real San Telmo boundary
   * polygon and Calle Defensa LineString coordinates are not present in the
   * forensic corpus (spikes/rw1-san-telmo-historical-walk/forensic-rerun-
   * 2026-09-22/ intentionally omits raw geometry coordinates from the
   * bitácora -- only `{"type":"Polygon"}`/entity ids are recorded). These
   * fixtures therefore use a small deterministic synthetic polygon standing
   * in for the real San Telmo boundary, while the entity identities quoted
   * in comments (osm:relation:2223069 for San Telmo, osm:way:38536550 /
   * wikidata Q5740483 for "Defensa") are real, captured in
   * cold-2/generation-trace.json's entity_resolution and catalog-after.json.
   */
  describe('RW1 forensic-rerun-2026-09-22 characterization (Stage 1)', () => {
    // A synthetic stand-in for the San Telmo relation boundary
    // (osm:relation:2223069). Coordinates are illustrative only.
    const sanTelmoArea: GeoJsonGeometry = {
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

    // Case D - Calle Defensa: in cold-2's real entity_resolution audit, the
    // "calle-defensa" hint (role: route, expectedKind: ROUTE) resolved via
    // LOCAL_OSM_POOL to the real OSM way osm:way:38536550 ("Defensa",
    // wikidata Q5740483) with verificationDecision VERIFIED. That candidate
    // was never geographically re-validated in any RW1 run because the
    // composite it belonged to ("San Telmo Historic Self-Guided Route") was
    // already rejected at entity_resolution for its OTHER required
    // components (Case B). This fixture exercises the SAME canonical
    // AREA_ANCHORED_ROUTE policy Calle Defensa would go through, proving the
    // real LineString/polygon segment-intersection logic
    // (geometryHasPointInArea + segmentsIntersect) already exists and does
    // not need a second geometry engine -- only `required`-gating removal
    // (Stage 4) stands between this policy and Calle Defensa's real
    // resolved geometry.
    it('Case D: a Calle-Defensa-shaped ROUTE entering the San Telmo area polygon passes via real LineString/polygon intersection', () => {
      const decision = evaluateAreaScopeMembership(
        sanTelmoArea,
        [
          {
            required: true,
            role: 'route',
            // Enters from outside (west of the polygon, like Defensa
            // approaching from Plaza de Mayo) and crosses into it.
            geometry: {
              type: 'LineString',
              coordinates: [
                [-58.3745, -34.6195],
                [-58.3695, -34.6195],
              ],
            },
          },
        ],
        'AREA_ANCHORED_ROUTE',
      );
      expect(decision.routeIntersectsArea).toBe(true);
      expect(decision.passes).toBe(true);
    });

    it('Case D: a route entirely outside the San Telmo area polygon does not intersect and does not pass', () => {
      const decision = evaluateAreaScopeMembership(
        sanTelmoArea,
        [
          {
            required: true,
            role: 'route',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-58.39, -34.6],
                [-58.38, -34.6],
              ],
            },
          },
        ],
        'AREA_ANCHORED_ROUTE',
      );
      expect(decision.routeIntersectsArea).toBe(false);
      expect(decision.passes).toBe(false);
    });

    // Case C - Plaza de Mayo geographic DESIGN fixture. This is NOT the
    // observed RW1 acquisition failure (Case B): in the real corrected
    // runs, the "Plaza de Mayo" hint never reached a correctly-resolved
    // geometry at all -- it acquired the wrong local candidate (Plaza
    // Dorrego) and was rejected before any AREA relation was evaluated (see
    // experience-proposal-resolver.service.spec.ts). This fixture instead
    // characterizes the FUTURE-relevant architectural scenario the amendment
    // describes in §9: a correctly-resolved Plaza-de-Mayo-shaped point that
    // sits OUTSIDE the San Telmo polygon, connected into it only through a
    // Calle-Defensa-shaped route that intersects the boundary. Current
    // AREA_ANCHORED_ROUTE policy already accepts this shape via
    // `routeIntersectsArea` even though the point itself never satisfies
    // `requiredPointInside` -- freezing that CURRENT behavior, not a new one.
    it('Case C (design fixture, not the observed RW1 failure): a resolved point outside San Telmo plus a connecting route into it already passes AREA_ANCHORED_ROUTE', () => {
      const plazaDeMayoShapedPoint = {
        required: true,
        role: 'waypoint' as const,
        // Outside sanTelmoArea's bounds (west of the polygon).
        latitude: -34.6195,
        longitude: -58.3755,
      };
      const calleDefensaShapedRoute = {
        required: true,
        role: 'route' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [-58.3745, -34.6195],
            [-58.3695, -34.6195],
          ],
        },
      };

      const decision = evaluateAreaScopeMembership(
        sanTelmoArea,
        [plazaDeMayoShapedPoint, calleDefensaShapedRoute],
        'AREA_ANCHORED_ROUTE',
      );

      expect(decision.requiredPointInside).toBe(false);
      expect(decision.routeIntersectsArea).toBe(true);
      expect(decision.passes).toBe(true);

      // Strict per-point containment (AREA_CONTAINED) would reject this
      // same evidence-backed shape, which is exactly why the amendment
      // requires AREA_ANCHORED_ROUTE semantics for a walk/route intent
      // instead of blanket per-component containment.
      expect(
        evaluateAreaScopeMembership(
          sanTelmoArea,
          [plazaDeMayoShapedPoint, calleDefensaShapedRoute],
          'AREA_CONTAINED',
        ).passes,
      ).toBe(false);
    });
  });
});
