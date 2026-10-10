import { OverpassConcurrencyLimiter } from './overpass-concurrency.util';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('OverpassConcurrencyLimiter', () => {
  it('never lets more than maxConcurrency tasks run at once', async () => {
    const limiter = new OverpassConcurrencyLimiter(2);
    let active = 0;
    let maxObservedActive = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const runs = gates.map((gate, i) =>
      limiter.run(async () => {
        active++;
        maxObservedActive = Math.max(maxObservedActive, active);
        await gate.promise;
        active--;
        return i;
      }),
    );

    // Let the microtask queue settle so every task that's allowed to start
    // has started.
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2); // only the first 2 of 5 are running

    gates.forEach((g) => g.resolve());
    const results = await Promise.all(runs);

    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(maxObservedActive).toBe(2);
  });

  it('a failing task releases its slot instead of blocking the queue', async () => {
    const limiter = new OverpassConcurrencyLimiter(1);

    const failing = limiter.run(async () => {
      throw new Error('overpass down');
    });
    await expect(failing).rejects.toThrow('overpass down');

    // If the slot weren't released, this would hang forever.
    const result = await limiter.run(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('runs tasks sequentially when maxConcurrency is 1', async () => {
    const limiter = new OverpassConcurrencyLimiter(1);
    const order: number[] = [];

    await Promise.all([
      limiter.run(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 5));
        order.push(2);
      }),
      limiter.run(async () => {
        order.push(3);
      }),
    ]);

    // The second task's body can only start once the first one fully
    // finished (including its internal await) — never interleaved.
    expect(order).toEqual([1, 2, 3]);
  });
});
