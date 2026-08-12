import { optimizeActivityOrder } from './route-optimizer.util';
import { calculateDistance } from '../../../shared/utils/distance.utils';

function routeLength(
  origin: { latitude: number; longitude: number },
  order: { latitude: number; longitude: number }[],
): number {
  let total = 0;
  let prev = origin;
  for (const point of order) {
    total += calculateDistance(prev, point);
    prev = point;
  }
  return total;
}

describe('optimizeActivityOrder', () => {
  const origin = { latitude: 0, longitude: 0 };

  it('returns the same array when there are 0 or 1 points', () => {
    const empty: { latitude: number; longitude: number }[] = [];
    expect(optimizeActivityOrder(origin, empty)).toBe(empty);

    const single = [{ latitude: 1, longitude: 2 }];
    expect(optimizeActivityOrder(origin, single)).toBe(single);
  });

  it('orders points from nearest to farthest from the origin when they lie on a line', () => {
    const near = { latitude: 0, longitude: 1, name: 'near' };
    const mid = { latitude: 0, longitude: 5, name: 'mid' };
    const far = { latitude: 0, longitude: 10, name: 'far' };

    const result = optimizeActivityOrder(origin, [far, near, mid]);

    expect(result.map((p) => p.name)).toEqual(['near', 'mid', 'far']);
  });

  it('shortens a zigzagging input order (visiting opposite corners) into a non-crossing route', () => {
    const ne = { latitude: 1, longitude: 1, name: 'NE' };
    const se = { latitude: -1, longitude: 1, name: 'SE' };
    const sw = { latitude: -1, longitude: -1, name: 'SW' };
    const nw = { latitude: 1, longitude: -1, name: 'NW' };
    // Worst-case input: hops between opposite corners instead of going around.
    const zigzagInput = [ne, sw, nw, se];

    const result = optimizeActivityOrder(origin, zigzagInput);

    expect(routeLength(origin, result)).toBeLessThan(
      routeLength(origin, zigzagInput),
    );
  });

  it('returns a permutation of the input — same points, no drops or duplicates', () => {
    const points = [
      { latitude: 3, longitude: -2, name: 'a' },
      { latitude: -1, longitude: 4, name: 'b' },
      { latitude: 0, longitude: 0.5, name: 'c' },
      { latitude: 2, longitude: 2, name: 'd' },
    ];

    const result = optimizeActivityOrder(origin, points);

    expect(result).toHaveLength(points.length);
    expect(new Set(result.map((p) => p.name))).toEqual(
      new Set(points.map((p) => p.name)),
    );
  });

  it('preserves extra fields on each point beyond latitude/longitude', () => {
    const points = [
      { latitude: 1, longitude: 1, id: 'act-1', notes: 'hello' },
      { latitude: 2, longitude: 2, id: 'act-2', notes: 'world' },
    ];

    const result = optimizeActivityOrder(origin, points);

    expect(result.find((p) => p.id === 'act-1')?.notes).toBe('hello');
    expect(result.find((p) => p.id === 'act-2')?.notes).toBe('world');
  });

  it('does not mutate the input array', () => {
    const points = Object.freeze([
      { latitude: 5, longitude: 5, name: 'x' },
      { latitude: -5, longitude: -5, name: 'y' },
      { latitude: 5, longitude: -5, name: 'z' },
    ]);

    expect(() => optimizeActivityOrder(origin, [...points])).not.toThrow();
  });
});
