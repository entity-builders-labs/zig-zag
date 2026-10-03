/**
 * Caps how many Overpass requests are in flight at once, app-wide. The
 * public overpass-api.de instance enforces strict per-IP fair-use slot
 * limits — without this, two tours generating concurrently is already
 * enough to start getting 429/503 from the shared instance.
 *
 * A failing task still releases its slot (via `finally`), so one failure
 * never blocks the queue for subsequent callers.
 */
export class OverpassConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
