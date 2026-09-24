import {
  RouteSegment,
  clusterRouteSegments,
} from './route-segment-clustering.util';

// ~0.001 deg latitude ~= 111 m; longitude at -34.6 ~= 91 m per 0.001 deg.
const seg = (
  osmId: number,
  nodes: number[],
  points: Array<[number, number]>,
  name = 'Defensa',
  highway = 'residential',
): RouteSegment => ({
  osmId,
  name,
  highway,
  nodes,
  geometry: points.map(([lat, lon]) => ({ lat, lon })),
});

describe('clusterRouteSegments', () => {
  it('collapses OSM ways that share a node into one cluster (one real street, many ways)', () => {
    const clusters = clusterRouteSegments([
      seg(
        3,
        [1, 2],
        [
          [-34.61, -58.37],
          [-34.611, -58.37],
        ],
      ),
      seg(
        1,
        [2, 3],
        [
          [-34.611, -58.37],
          [-34.612, -58.37],
        ],
      ),
      seg(
        2,
        [3, 4],
        [
          [-34.612, -58.37],
          [-34.613, -58.37],
        ],
      ),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].segmentExternalIds).toEqual([
      'osm:way:1',
      'osm:way:2',
      'osm:way:3',
    ]);
    expect(clusters[0].canonicalName).toBe('Defensa');
    expect(clusters[0].geometryFacts.segmentCount).toBe(3);
    expect(clusters[0].geometryFacts.highwayTypes).toEqual(['residential']);
  });

  it('keeps disconnected same-name ways as separate clusters when no gap tolerance is given', () => {
    const clusters = clusterRouteSegments([
      seg(
        1,
        [1, 2],
        [
          [-34.61, -58.37],
          [-34.611, -58.37],
        ],
      ),
      // 20 m further along the same line, but no shared node.
      seg(
        2,
        [3, 4],
        [
          [-34.61118, -58.37],
          [-34.612, -58.37],
        ],
      ),
    ]);

    expect(clusters).toHaveLength(2);
  });

  it('bridges an intersection-scale endpoint gap only when a continuity tolerance is explicitly given', () => {
    const segments = [
      seg(
        1,
        [1, 2],
        [
          [-34.61, -58.37],
          [-34.611, -58.37],
        ],
      ),
      seg(
        2,
        [3, 4],
        [
          [-34.61118, -58.37],
          [-34.612, -58.37],
        ],
      ),
    ];

    expect(
      clusterRouteSegments(segments, { continuityGapMeters: 60 }),
    ).toHaveLength(1);
  });

  it('never bridges a gap larger than the tolerance', () => {
    const clusters = clusterRouteSegments(
      [
        seg(
          1,
          [1, 2],
          [
            [-34.61, -58.37],
            [-34.611, -58.37],
          ],
        ),
        // ~7 km away: a different real street with the same name.
        seg(
          2,
          [3, 4],
          [
            [-34.65, -58.44],
            [-34.651, -58.44],
          ],
        ),
      ],
      { continuityGapMeters: 60 },
    );

    expect(clusters).toHaveLength(2);
  });

  it('never groups ways with different exact names, even when they share a node', () => {
    const clusters = clusterRouteSegments([
      seg(
        1,
        [1, 2],
        [
          [-34.61, -58.37],
          [-34.611, -58.37],
        ],
      ),
      seg(
        2,
        [2, 3],
        [
          [-34.611, -58.37],
          [-34.612, -58.37],
        ],
        'San Lorenzo',
      ),
    ]);

    expect(clusters.map((c) => c.canonicalName).sort()).toEqual([
      'Defensa',
      'San Lorenzo',
    ]);
  });

  it('picks the representative segment deterministically by length, never by distance to anything', () => {
    const clusters = clusterRouteSegments([
      seg(
        9,
        [1, 2],
        [
          [-34.61, -58.37],
          [-34.6101, -58.37],
        ],
      ),
      seg(
        5,
        [2, 3],
        [
          [-34.6101, -58.37],
          [-34.615, -58.37],
        ],
      ),
    ]);

    expect(clusters[0].representativeSegment.externalId).toBe('osm:way:5');
  });

  it('is order-independent (same clusters for any input permutation)', () => {
    const a = seg(
      1,
      [1, 2],
      [
        [-34.61, -58.37],
        [-34.611, -58.37],
      ],
    );
    const b = seg(
      2,
      [2, 3],
      [
        [-34.611, -58.37],
        [-34.612, -58.37],
      ],
    );
    const c = seg(
      3,
      [9, 10],
      [
        [-34.7, -58.5],
        [-34.701, -58.5],
      ],
    );

    expect(clusterRouteSegments([c, b, a])).toEqual(
      clusterRouteSegments([a, b, c]),
    );
  });

  it('reports geometry facts: total length, bbox, and an on-line probe point per segment', () => {
    const [cluster] = clusterRouteSegments([
      seg(
        1,
        [1, 2, 3],
        [
          [-34.61, -58.37],
          [-34.611, -58.37],
          [-34.612, -58.37],
        ],
      ),
    ]);

    expect(cluster.geometryFacts.totalLengthMeters).toBeGreaterThan(200);
    expect(cluster.geometryFacts.totalLengthMeters).toBeLessThan(250);
    expect(cluster.geometryFacts.bbox).toEqual({
      minLat: -34.612,
      maxLat: -34.61,
      minLon: -58.37,
      maxLon: -58.37,
    });
    // A real vertex of the line itself (not a centroid that could fall off it).
    expect(cluster.representativeSegment.probePoint).toEqual({
      latitude: -34.611,
      longitude: -58.37,
    });
  });
});
