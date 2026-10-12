import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Record/replay boundary for every external call the spike makes (search,
 * fetch, LLM, OSM/Nominatim). `record` calls live and stores the result
 * (including failures), `replay` never calls the underlying function and
 * fails on a miss, `live` calls without storing.
 */
export type RecorderMode = 'live' | 'record' | 'replay';

export class ReplayMissError extends Error {}

export interface ProviderCallCounts {
  live: number;
  replayed: number;
  failed: number;
}

interface RecordedCall {
  provider: string;
  operation: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export class Recorder {
  readonly counts: Record<string, ProviderCallCounts> = {};

  constructor(
    private readonly directory: string,
    readonly mode: RecorderMode,
  ) {
    if (mode !== 'live') mkdirSync(directory, { recursive: true });
  }

  private bump(provider: string, field: keyof ProviderCallCounts) {
    const c = (this.counts[provider] ??= { live: 0, replayed: 0, failed: 0 });
    c[field] += 1;
  }

  private pathFor(provider: string, operation: string, args: unknown): string {
    const hash = createHash('sha256')
      .update(JSON.stringify({ provider, operation, args }))
      .digest('hex')
      .slice(0, 24);
    return join(this.directory, `${provider}.${operation.replace(/[^a-z0-9_-]/gi, '_')}.${hash}.json`);
  }

  async call<T>(
    provider: string,
    operation: string,
    args: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    const path = this.pathFor(provider, operation, args);
    if (this.mode === 'replay') {
      if (!existsSync(path)) {
        this.bump(provider, 'failed');
        throw new ReplayMissError(`replay miss: ${provider}.${operation}`);
      }
      const recorded = JSON.parse(readFileSync(path, 'utf8')) as RecordedCall;
      this.bump(provider, 'replayed');
      if (recorded.error !== undefined) throw new Error(recorded.error);
      return recorded.result as T;
    }
    try {
      const result = await fn();
      this.bump(provider, 'live');
      if (this.mode === 'record') {
        writeFileSync(path, JSON.stringify({ provider, operation, args, result } satisfies RecordedCall));
      }
      return result;
    } catch (error) {
      this.bump(provider, 'failed');
      if (this.mode === 'record') {
        const message = error instanceof Error ? error.message : String(error);
        writeFileSync(path, JSON.stringify({ provider, operation, args, error: message } satisfies RecordedCall));
      }
      throw error;
    }
  }

  /** Wraps the named async methods of a service so they route through `call`. */
  wrap<T extends object>(service: T, provider: string, methods: Array<keyof T & string>): T {
    const recorder = this;
    return new Proxy(service, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof property === 'string' && methods.includes(property as keyof T & string) && typeof value === 'function') {
          return (...args: unknown[]) =>
            recorder.call(provider, property, args, () => value.apply(target, args));
        }
        return value;
      },
    });
  }

  totals(): ProviderCallCounts {
    return Object.values(this.counts).reduce(
      (acc, c) => ({ live: acc.live + c.live, replayed: acc.replayed + c.replayed, failed: acc.failed + c.failed }),
      { live: 0, replayed: 0, failed: 0 },
    );
  }
}

/**
 * Spike stand-in for the backend's AiCacheService: never hits, never
 * stores, so every LLM call is visible to the Recorder and the dev DB cache
 * is neither read nor polluted.
 */
export class SpikeNoopAiCache {
  isEnabled(): boolean {
    return false;
  }
  async getCachedResponse(): Promise<null> {
    return null;
  }
  async cacheResponse(): Promise<void> {
    return undefined;
  }
}
