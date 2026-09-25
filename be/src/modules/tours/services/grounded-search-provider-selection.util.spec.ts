import { selectGroundedSearchProvider } from './grounded-search-provider-selection.util';
import { ExperienceGroundedSearchProvider } from '../interfaces/experience-grounding.interface';

describe('selectGroundedSearchProvider', () => {
  const make = (): ExperienceGroundedSearchProvider & {
    search: jest.Mock;
  } => ({
    search: jest.fn(),
  });
  const impls = {
    serpapi: make(),
    serper: make(),
    groq: make(),
    tavily: make(),
    gemini: make(),
  };

  it.each(['serpapi', 'serper', 'groq', 'tavily', 'gemini'] as const)(
    'selects exactly the %s implementation',
    (name) => {
      expect(selectGroundedSearchProvider(name, impls)).toBe(impls[name]);
    },
  );

  it('selecting serper never touches the SerpApi implementation', async () => {
    const selected = selectGroundedSearchProvider('serper', impls);
    await selected.search({
      destinationName: 'Buenos Aires',
      requestedThemes: [],
      query: 'q',
    });

    expect(impls.serper.search).toHaveBeenCalledTimes(1);
    expect(impls.serpapi.search).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider instead of falling back', () => {
    expect(() => selectGroundedSearchProvider('serper-ai-mode', impls)).toThrow(
      'Unsupported GROUNDED_SEARCH_PROVIDER: serper-ai-mode',
    );
  });
});
