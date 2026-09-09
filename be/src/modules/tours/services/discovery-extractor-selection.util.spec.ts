import { selectDiscoveryExtractor } from './discovery-extractor-selection.util';

describe('selectDiscoveryExtractor', () => {
  const impls = {
    gemini: { extractExperiences: jest.fn(), _tag: 'gemini' } as any,
    groq: { extractExperiences: jest.fn(), _tag: 'groq' } as any,
    ollama: { extractExperiences: jest.fn(), _tag: 'ollama' } as any,
  };

  it('maps each DISCOVERY_EXTRACTOR_PROVIDER value to its own implementation', () => {
    expect(selectDiscoveryExtractor('gemini', impls)).toBe(impls.gemini);
    expect(selectDiscoveryExtractor('groq', impls)).toBe(impls.groq);
    expect(selectDiscoveryExtractor('ollama', impls)).toBe(impls.ollama);
  });

  it('throws on an unsupported provider', () => {
    expect(() => selectDiscoveryExtractor('openai' as any, impls)).toThrow(
      /Unsupported DISCOVERY_EXTRACTOR_PROVIDER: openai/,
    );
  });

  it('depends only on its two arguments — never on AI_PROVIDER or other env', () => {
    const prev = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = 'gemini';
    try {
      // discovery provider is groq; AI_PROVIDER says gemini; groq must win
      expect(selectDiscoveryExtractor('groq', impls)).toBe(impls.groq);
    } finally {
      if (prev === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = prev;
    }
  });
});
