import { parseJsonObject, withRateLimitRetry } from '../src/research/llm';

describe('LLM adapter resilience (infrastructure only)', () => {
  it('retries rate limits after the suggested delay', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('Groq error 429: rate_limit_exceeded. Please try again in 2.5s'))
      .mockResolvedValueOnce('ok');
    await expect(withRateLimitRetry(fn, sleep)).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('does not retry a request-too-large or other failure', async () => {
    const sleep = jest.fn();
    await expect(withRateLimitRetry(() => Promise.reject(new Error('Groq error 413: Request too large')), sleep)).rejects.toThrow('413');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after bounded retries', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
    await expect(withRateLimitRetry(fn, sleep)).rejects.toThrow('429');
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('parses fenced and bare JSON replies', () => {
    expect(parseJsonObject('```json\n{"action":"finish"}\n```')).toEqual({ action: 'finish' });
    expect(parseJsonObject('thinking... {"action":"search","query":"x"} done')).toEqual({ action: 'search', query: 'x' });
    expect(parseJsonObject('no json')).toBeUndefined();
  });
});
