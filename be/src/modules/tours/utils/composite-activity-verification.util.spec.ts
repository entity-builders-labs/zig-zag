import {
  verifyAndDedupeCompositeActivities,
  verifySelectedWaypointSubset,
  RawCompositeActivity,
} from './composite-activity-verification.util';

describe('verifyAndDedupeCompositeActivities', () => {
  const AREA_ID = 'osm:relation:49518';
  const activityIds = new Set(['poi-1', 'poi-2', 'poi-3']);
  const osmFeatureIds = new Set(['osm:way:1', 'osm:way:2']);

  const base = (
    overrides: Partial<RawCompositeActivity> = {},
  ): RawCompositeActivity => ({
    name: 'San Telmo Historic Walk',
    kind: 'NEIGHBORHOOD_WALK',
    variantTheme: 'HISTORY',
    areaId: AREA_ID,
    waypointIds: ['poi-1', 'poi-2'],
    ...overrides,
  });

  it('accepts a valid NEIGHBORHOOD_WALK with real waypoints', () => {
    const { verified, hallucinatedWaypointCount, invalidCompositeCount } =
      verifyAndDedupeCompositeActivities(
        [base()],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

    expect(verified).toHaveLength(1);
    expect(verified[0].waypointIds).toEqual(['poi-1', 'poi-2']);
    expect(hallucinatedWaypointCount).toBe(0);
    expect(invalidCompositeCount).toBe(0);
  });

  it('drops a hallucinated waypoint id but keeps the composite if enough real ones remain', () => {
    const { verified, hallucinatedWaypointCount } =
      verifyAndDedupeCompositeActivities(
        [base({ waypointIds: ['poi-1', 'poi-2', 'invented-place'] })],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

    expect(verified).toHaveLength(1);
    expect(verified[0].waypointIds).toEqual(['poi-1', 'poi-2']);
    expect(hallucinatedWaypointCount).toBe(1);
  });

  it('drops the whole composite when fewer than 2 real waypoints survive (NEIGHBORHOOD_WALK/EXPERIENCE)', () => {
    const { verified, invalidCompositeCount } =
      verifyAndDedupeCompositeActivities(
        [base({ waypointIds: ['poi-1', 'invented-a', 'invented-b'] })],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

    expect(verified).toHaveLength(0);
    expect(invalidCompositeCount).toBe(1);
  });

  it('preserves waypoint order and dedupes repeats within one composite (not counted as hallucinated)', () => {
    const { verified, hallucinatedWaypointCount } =
      verifyAndDedupeCompositeActivities(
        [base({ waypointIds: ['poi-2', 'poi-1', 'poi-2', 'poi-3'] })],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

    expect(verified[0].waypointIds).toEqual(['poi-2', 'poi-1', 'poi-3']);
    expect(hallucinatedWaypointCount).toBe(0);
  });

  it('dedupes separate OSM segments that represent the same named street', () => {
    const { verified, hallucinatedWaypointCount } =
      verifyAndDedupeCompositeActivities(
        [
          base({
            waypointIds: ['osm:way:1', 'osm:way:2', 'poi-1'],
          }),
        ],
        activityIds,
        osmFeatureIds,
        AREA_ID,
        undefined,
        new Map([
          ['osm:way:1', 'Carlos Calvo'],
          ['osm:way:2', 'Cárlos-Calvo'],
        ]),
      );

    expect(verified).toHaveLength(1);
    expect(verified[0].waypointIds).toEqual(['osm:way:1', 'poi-1']);
    expect(hallucinatedWaypointCount).toBe(0);
  });

  it('rejects an invalid kind', () => {
    const { verified, invalidCompositeCount } =
      verifyAndDedupeCompositeActivities(
        [base({ kind: 'NOT_A_KIND' })],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

    expect(verified).toHaveLength(0);
    expect(invalidCompositeCount).toBe(1);
  });

  it('rejects kind: POI or AREA proposed as a composite (those are not variants)', () => {
    const { invalidCompositeCount } = verifyAndDedupeCompositeActivities(
      [base({ kind: 'POI' }), base({ kind: 'AREA' })],
      activityIds,
      osmFeatureIds,
      AREA_ID,
    );

    expect(invalidCompositeCount).toBe(2);
  });

  it('rejects an invalid variantTheme', () => {
    const { invalidCompositeCount } = verifyAndDedupeCompositeActivities(
      [base({ variantTheme: 'NOT_A_THEME' })],
      activityIds,
      osmFeatureIds,
      AREA_ID,
    );

    expect(invalidCompositeCount).toBe(1);
  });

  it('rejects a composite whose areaId does not match the one candidate actually offered', () => {
    const { invalidCompositeCount } = verifyAndDedupeCompositeActivities(
      [base({ areaId: 'osm:relation:invented' })],
      activityIds,
      osmFeatureIds,
      AREA_ID,
    );

    expect(invalidCompositeCount).toBe(1);
  });

  it('rejects every composite when no area candidate was offered at all', () => {
    const { invalidCompositeCount } = verifyAndDedupeCompositeActivities(
      [base()],
      activityIds,
      osmFeatureIds,
      null,
    );

    expect(invalidCompositeCount).toBe(1);
  });

  it('drops waypoints from a different neighborhood and rejects the composite when too few in-area stops remain', () => {
    const otherAreaId = 'osm:relation:other';
    const result = verifyAndDedupeCompositeActivities(
      [base({ waypointIds: ['poi-1', 'poi-2'] })],
      activityIds,
      osmFeatureIds,
      new Set([AREA_ID, otherAreaId]),
      new Map([
        ['poi-1', new Set([AREA_ID])],
        ['poi-2', new Set([otherAreaId])],
      ]),
    );

    expect(result.verified).toHaveLength(0);
    expect(result.outOfAreaWaypointCount).toBe(1);
    expect(result.invalidCompositeCount).toBe(1);
  });

  describe('kind: ROUTE — different validity rule', () => {
    it('accepts a ROUTE with zero waypoints as long as it has a real OSM geometry source', () => {
      const { verified, invalidCompositeCount } =
        verifyAndDedupeCompositeActivities(
          [
            base({
              kind: 'ROUTE',
              name: 'Pasear por Caminito',
              waypointIds: ['osm:way:1'],
            }),
          ],
          activityIds,
          osmFeatureIds,
          AREA_ID,
        );

      expect(verified).toHaveLength(1);
      expect(verified[0].waypointIds).toEqual(['osm:way:1']);
      expect(invalidCompositeCount).toBe(0);
    });

    it('does NOT require the 2-waypoint minimum that applies to NEIGHBORHOOD_WALK/EXPERIENCE', () => {
      const { verified } = verifyAndDedupeCompositeActivities(
        [base({ kind: 'ROUTE', waypointIds: ['osm:way:1'] })],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

      expect(verified).toHaveLength(1);
    });

    it('rejects a ROUTE with no waypoints at all (no geometry source)', () => {
      const { invalidCompositeCount } = verifyAndDedupeCompositeActivities(
        [base({ kind: 'ROUTE', waypointIds: [] })],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

      expect(invalidCompositeCount).toBe(1);
    });

    it('rejects a ROUTE whose waypoints are all POIs with no OSM geometry source at all', () => {
      const { invalidCompositeCount } = verifyAndDedupeCompositeActivities(
        [base({ kind: 'ROUTE', waypointIds: ['poi-1', 'poi-2'] })],
        activityIds,
        osmFeatureIds,
        AREA_ID,
      );

      expect(invalidCompositeCount).toBe(1);
    });
  });
});

describe('verifySelectedWaypointSubset', () => {
  const actualWaypointIds = new Set(['wp-1', 'wp-2', 'wp-3', 'wp-4']);

  it('returns null when nothing was requested (no override, use the full snapshot)', () => {
    expect(
      verifySelectedWaypointSubset(undefined, actualWaypointIds),
    ).toBeNull();
    expect(verifySelectedWaypointSubset([], actualWaypointIds)).toBeNull();
  });

  it('returns the valid subset, preserving order, when it meets the minimum', () => {
    const result = verifySelectedWaypointSubset(
      ['wp-3', 'wp-1'],
      actualWaypointIds,
    );
    expect(result).toEqual(['wp-3', 'wp-1']);
  });

  it('drops a waypoint id that does not belong to this variant, even if it is a real Activity id elsewhere', () => {
    const result = verifySelectedWaypointSubset(
      ['wp-1', 'wp-2', 'some-other-activity-id'],
      actualWaypointIds,
    );
    expect(result).toEqual(['wp-1', 'wp-2']);
  });

  it('falls back to null (full snapshot) when the valid subset drops below the minimum of 2', () => {
    const result = verifySelectedWaypointSubset(['wp-1'], actualWaypointIds);
    expect(result).toBeNull();
  });

  it('falls back to null when every requested id is foreign to this variant', () => {
    const result = verifySelectedWaypointSubset(
      ['not-mine-1', 'not-mine-2'],
      actualWaypointIds,
    );
    expect(result).toBeNull();
  });

  it('dedupes repeated ids in the request', () => {
    const result = verifySelectedWaypointSubset(
      ['wp-1', 'wp-1', 'wp-2'],
      actualWaypointIds,
    );
    expect(result).toEqual(['wp-1', 'wp-2']);
  });
});
