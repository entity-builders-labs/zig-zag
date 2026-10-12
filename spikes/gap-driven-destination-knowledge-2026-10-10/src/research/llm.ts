import { LangChainService } from '../../../../be/src/shared/ai/langchain.service';
import { Recorder } from '../recording';

/** The LLM boundary used by the research agent and the support verifier. */
export interface LlmPort {
  readonly identity: { provider: string; model: string };
  complete(prompt: string, purpose: string): Promise<string>;
}

/**
 * Adapter over the backend's LangChainService. The prompt is passed as a
 * single template variable so braces in JSON instructions are never parsed
 * as template placeholders.
 */
export function langChainLlm(
  recorder: Recorder,
  service: LangChainService,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): LlmPort {
  const identity = service.getProviderMetadata();
  return {
    identity,
    complete(prompt, purpose) {
      return recorder.call('llm', purpose, { identity, prompt }, () =>
        withRateLimitRetry(() => service.generateCompletionResponse('{prompt}', { prompt }), sleep),
      );
    },
  };
}

const MAX_RATE_LIMIT_RETRIES = 4;

/**
 * Infrastructure-only resilience: provider rate limits (HTTP 429 /
 * RESOURCE_EXHAUSTED) are retried after the provider's suggested delay.
 * Anything else, including "request too large", surfaces as a failure.
 */
export async function withRateLimitRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = /\b429\b|rate_limit|RESOURCE_EXHAUSTED/i.test(message);
      if (!rateLimited || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      const suggested = /try again in ([\d.]+)\s*(ms|s)/i.exec(message);
      const delay = suggested ? Number(suggested[1]) * (suggested[2].toLowerCase() === 'ms' ? 1 : 1000) : 15_000 * (attempt + 1);
      await sleep(Math.min(Math.ceil(delay) + 500, 90_000));
    }
  }
}

/** Extracts the first JSON object from a model response (fenced or bare). */
export function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const candidate = fenced ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
