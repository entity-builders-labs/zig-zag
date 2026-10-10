import { selectWebSourceContentProvider } from './web-source-content-provider-selection.util';
import {
  WebSourceContentProvider,
  WebSourceContentResult,
} from '../interfaces/web-source-content.interface';

describe('selectWebSourceContentProvider', () => {
  const makeMock = (
    name: 'tavily' | 'cloudflare',
  ): WebSourceContentProvider & { retrieve: jest.Mock } => ({
    providerName: name,
    retrieve: jest.fn().mockResolvedValue({
      provider: name,
      requestedCount: 0,
      retrievedCount: 0,
      items: [],
      totalDurationMs: 0,
    } as WebSourceContentResult),
  });

  const impls = {
    tavily: makeMock('tavily'),
    cloudflare: makeMock('cloudflare'),
  };

  it.each(['tavily', 'cloudflare'] as const)(
    'selects exactly the %s implementation',
    (name) => {
      expect(selectWebSourceContentProvider(name, impls)).toBe(impls[name]);
    },
  );

  it('returns undefined when no provider is configured', () => {
    expect(selectWebSourceContentProvider(undefined, impls)).toBeUndefined();
    expect(selectWebSourceContentProvider('', impls)).toBeUndefined();
  });

  it('selecting tavily never touches the cloudflare implementation', async () => {
    const selected = selectWebSourceContentProvider('tavily', impls);
    expect(selected).toBeDefined();
    await selected!.retrieve({ urls: ['https://example.com'] });

    expect(impls.tavily.retrieve).toHaveBeenCalledTimes(1);
    expect(impls.cloudflare.retrieve).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider loudly instead of falling back', () => {
    expect(() =>
      selectWebSourceContentProvider('puppeteer' as any, impls),
    ).toThrow('Unsupported WEB_SOURCE_CONTENT_PROVIDER: puppeteer');
  });
});
