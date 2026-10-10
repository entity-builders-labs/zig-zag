import { GeminiGroundedSearchService } from './gemini-grounded-search.service';

describe('GeminiGroundedSearchService', () => {
  let tavilyExtract: { extract: jest.Mock };
  let fetchMock: jest.Mock;

  const config = (hasApiKey: boolean = true) => ({
    discoveryExtractor: {
      gemini: {
        apiKey: hasApiKey ? 'test-gemini-key' : undefined,
        model: 'gemini-3.5-flash-lite',
      },
    },
    geminiGroundedSearchModel: 'gemini-3.5-flash',
  });

  beforeEach(() => {
    tavilyExtract = { extract: jest.fn().mockResolvedValue(new Map()) };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('returns unavailable without calling anything when no Gemini API key is configured', async () => {
    const service = new GeminiGroundedSearchService(
      config(false) as any,
      tavilyExtract as any,
    );

    const result = await service.search({
      destinationName: 'San Juan',
      destinationCountry: 'Argentina',
      requestedThemes: ['nature'],
      query: 'San Juan Argentina nature',
    });

    expect(result).toMatchObject({
      groundingStatus: 'unavailable',
      failureReason: 'missing_gemini_api_key',
      evidence: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a real instruction built from the request, not the flat keyword query alone', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] as unknown[] }),
    });
    const service = new GeminiGroundedSearchService(
      config() as any,
      tavilyExtract as any,
    );

    await service.search({
      destinationName: 'San Juan',
      destinationCountry: 'Argentina',
      requestedThemes: ['nature', 'culture'],
      additionalPreferences: 'poca exigencia física',
      query: 'San Juan Argentina nature culture day trip',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ google_search: {} }]);
    const promptText = body.contents[0].parts[0].text;
    expect(promptText).toContain('San Juan, Argentina');
    expect(promptText).toContain('nature, culture');
    expect(promptText).toContain('poca exigencia física');
  });

  it('recovers original page content via Tavily extract for cited URLs (evidenceQuality: original_content)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: 'Ischigualasto is a real park.' }] },
            groundingMetadata: {
              webSearchQueries: ['San Juan Argentina nature'],
              groundingChunks: [
                {
                  web: {
                    uri: 'https://real-source.example/ischigualasto',
                    title: 'Ischigualasto Provincial Park',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: { text: 'Ischigualasto is a real park.' },
                  groundingChunkIndices: [0],
                },
              ],
            },
          },
        ],
      }),
    });
    tavilyExtract.extract.mockResolvedValue(
      new Map([
        [
          'https://real-source.example/ischigualasto',
          { status: 'success', content: 'The real, original page content.' },
        ],
      ]),
    );
    const service = new GeminiGroundedSearchService(
      config() as any,
      tavilyExtract as any,
    );

    const result = await service.search({
      destinationName: 'San Juan',
      destinationCountry: 'Argentina',
      requestedThemes: ['nature'],
      query: 'San Juan Argentina nature',
    });

    expect(tavilyExtract.extract).toHaveBeenCalledWith([
      'https://real-source.example/ischigualasto',
    ]);
    expect(result.groundingStatus).toBe('applied');
    expect(result.evidence).toEqual([
      {
        key: 'ev-gemini-1',
        source: 'Ischigualasto Provincial Park',
        snippet: 'The real, original page content.',
        title: 'Ischigualasto Provincial Park',
        url: 'https://real-source.example/ischigualasto',
      },
    ]);
    expect(result.evidenceProvenance).toEqual([
      expect.objectContaining({
        extractionProvider: 'tavily',
        extractionStatus: 'success',
        evidenceQuality: 'original_content',
        evidenceKeys: ['ev-gemini-1'],
      }),
    ]);
  });

  it('falls back to the grounding-support segment text when Tavily extract fails (evidenceQuality: reduced)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: 'Full synthesized answer.' }] },
            groundingMetadata: {
              webSearchQueries: ['San Juan Argentina nature'],
              groundingChunks: [
                {
                  web: {
                    uri: 'https://unreachable.example/page',
                    title: 'Some Source',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: { text: "Gemini's own synthesized claim text." },
                  groundingChunkIndices: [0],
                },
              ],
            },
          },
        ],
      }),
    });
    tavilyExtract.extract.mockResolvedValue(
      new Map([
        [
          'https://unreachable.example/page',
          { status: 'failed', error: 'tavily_extract_no_response' },
        ],
      ]),
    );
    const service = new GeminiGroundedSearchService(
      config() as any,
      tavilyExtract as any,
    );

    const result = await service.search({
      destinationName: 'San Juan',
      destinationCountry: 'Argentina',
      requestedThemes: ['nature'],
      query: 'San Juan Argentina nature',
    });

    expect(result.evidence).toEqual([
      {
        key: 'ev-gemini-1',
        source: 'Some Source',
        snippet: "Gemini's own synthesized claim text.",
        title: 'Some Source',
        url: 'https://unreachable.example/page',
      },
    ]);
    expect(result.evidenceProvenance).toEqual([
      expect.objectContaining({
        extractionProvider: 'gemini-model-output',
        extractionStatus: 'fallback',
        evidenceQuality: 'reduced',
        groundingSupportIndices: [0],
      }),
    ]);
  });

  it('reports no_usable_evidence when the response has no grounding metadata at all', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Ungrounded answer.' }] } }],
      }),
    });
    const service = new GeminiGroundedSearchService(
      config() as any,
      tavilyExtract as any,
    );

    const result = await service.search({
      destinationName: 'San Juan',
      requestedThemes: [],
      query: 'San Juan',
    });

    expect(result.groundingStatus).toBe('no_usable_evidence');
    expect(result.evidence).toEqual([]);
    expect(tavilyExtract.extract).not.toHaveBeenCalled();
  });

  it('reports failed on a non-ok HTTP response from Gemini', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'quota exceeded',
    });
    const service = new GeminiGroundedSearchService(
      config() as any,
      tavilyExtract as any,
    );

    const result = await service.search({
      destinationName: 'San Juan',
      requestedThemes: [],
      query: 'San Juan',
    });

    expect(result.groundingStatus).toBe('failed');
    expect(result.failureReason).toContain('429');
  });

  it('reports failed on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = new GeminiGroundedSearchService(
      config() as any,
      tavilyExtract as any,
    );

    const result = await service.search({
      destinationName: 'San Juan',
      requestedThemes: [],
      query: 'San Juan',
    });

    expect(result.groundingStatus).toBe('failed');
    expect(result.failureReason).toBe('network down');
  });
});
