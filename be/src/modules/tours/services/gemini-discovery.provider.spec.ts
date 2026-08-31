import { Test, TestingModule } from '@nestjs/testing';
import aiConfig from '@shared/ai/ai.config';
import { GeminiDiscoveryProvider } from './gemini-discovery.provider';
import { GroundedSearchResult } from '../interfaces/activity-discovery.interface';

describe('GeminiDiscoveryProvider', () => {
  let provider: GeminiDiscoveryProvider;
  let fetchSpy: jest.SpyInstance;

  const searchResult: GroundedSearchResult = {
    provider: 'serpapi',
    model: 'google-ai-mode',
    groundingStatus: 'applied',
    evidence: [
      {
        key: 'ev-1',
        source: 'wikipedia',
        snippet: 'San Telmo is the oldest barrio of Buenos Aires.',
      },
      {
        key: 'ev-2',
        source: 'travel-guide',
        snippet: 'Caminito in La Boca is a colorful pedestrian street.',
      },
    ],
  };

  async function buildProvider(apiKey: string | undefined) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiDiscoveryProvider,
        {
          provide: aiConfig.KEY,
          useValue: {
            discoveryExtractor: {
              provider: 'gemini',
              gemini: { apiKey, model: 'gemini-3.5-flash-lite' },
              groq: { model: 'openai/gpt-oss-120b' },
            },
          },
        },
      ],
    }).compile();
    return module.get(GeminiDiscoveryProvider);
  }

  function mockInteractionOk(proposalsJson: object) {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'completed',
        steps: [
          { type: 'thought', signature: 'abc' },
          {
            type: 'model_output',
            content: [{ type: 'text', text: JSON.stringify(proposalsJson) }],
          },
        ],
      }),
    } as any);
  }

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  beforeEach(async () => {
    provider = await buildProvider('test-key');
  });

  it('reports unavailable when no Gemini API key is configured', async () => {
    const noKeyProvider = await buildProvider(undefined);
    const response = await noKeyProvider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.groundingStatus).toBe('unavailable');
    expect(response.proposals).toEqual([]);
    expect(response.validationErrors).toContain('Missing Gemini API key');
  });

  it('builds the request with model, system_instruction, input, and response_format', async () => {
    mockInteractionOk({ proposals: [] });

    await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain(
      'https://generativelanguage.googleapis.com/v1beta/interactions?key=test-key',
    );
    const body = JSON.parse(init.body);
    expect(body.model).toBe('models/gemini-3.5-flash-lite');
    expect(typeof body.system_instruction).toBe('string');
    expect(typeof body.input).toBe('string');
    expect(body.response_format).toEqual(
      expect.objectContaining({ type: 'object' }),
    );
    // No redundant "return valid JSON" prose — response_format already
    // enforces shape, and the shared instructions never mention it either.
    expect(body.system_instruction).not.toContain('valid JSON');
    expect(body.input).not.toContain('valid JSON');
  });

  it('parses a realistic steps[] response into ActivityProposal[]', async () => {
    mockInteractionOk({
      proposals: [
        {
          name: 'Caminito',
          kind: 'POI',
          themes: ['photography'],
          entityHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              role: 'venue',
              expectedType: 'street_museum',
              required: true,
              evidenceKeys: ['ev-2'],
            },
          ],
          suggestedDurationMinutes: 60,
          shortReason: 'Colorful pedestrian street',
          evidenceKeys: ['ev-2'],
        },
      ],
    });

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['photography'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(1);
    expect(response.provider).toBe('gemini');
    expect(response.model).toBe('gemini-3.5-flash-lite');
    expect(response.proposals[0].name).toBe('Caminito');
  });

  it('handles malformed model_output JSON gracefully, not as a thrown exception', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'completed',
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: 'not json at all {{{' }],
          },
        ],
      }),
    } as any);

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toEqual([]);
    expect(response.validationErrors).toContain(
      'Failed to parse JSON response',
    );
  });

  it('rejects a proposal citing an evidence key that was never supplied', async () => {
    mockInteractionOk({
      proposals: [
        {
          name: 'Fake Place',
          kind: 'POI',
          themes: ['culture'],
          entityHints: [
            {
              key: 'x',
              name: 'Fake',
              role: 'venue',
              expectedType: 'museum',
              required: true,
              evidenceKeys: ['ev-does-not-exist'],
            },
          ],
          suggestedDurationMinutes: 60,
          shortReason: 'Made up',
          evidenceKeys: ['ev-does-not-exist'],
        },
      ],
    });

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toEqual([]);
    expect(response.validationErrors![0]).toContain('unknown evidence key');
  });

  it('rejects a NEIGHBORHOOD_WALK missing the required area hint even though it is schema-valid (live semantic-omission finding)', async () => {
    // Reproduces the real Gemini response observed live this session: all
    // hints required=false, no role="area" hint supplied at all.
    mockInteractionOk({
      proposals: [
        {
          name: 'San Telmo Historic Walk',
          kind: 'NEIGHBORHOOD_WALK',
          themes: ['history'],
          entityHints: [
            {
              key: 'plaza-dorrego',
              name: 'Plaza Dorrego',
              role: 'waypoint',
              expectedType: 'square',
              required: false,
              evidenceKeys: ['ev-1'],
            },
            {
              key: 'calle-defensa',
              name: 'Calle Defensa',
              role: 'route',
              expectedType: 'street',
              required: false,
              evidenceKeys: ['ev-1'],
            },
          ],
          suggestedDurationMinutes: 90,
          shortReason: 'A compact walk through San Telmo',
          evidenceKeys: ['ev-1'],
        },
      ],
    });

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toEqual([]);
    expect(response.validationErrors![0]).toContain('required area hint');
  });

  it('accepts a venue-centric EXPERIENCE with one required real venue', async () => {
    mockInteractionOk({
      proposals: [
        {
          name: 'Caminito cultural experience',
          kind: 'EXPERIENCE',
          themes: ['culture'],
          entityHints: [
            {
              key: 'caminito-venue',
              name: 'Caminito',
              role: 'venue',
              expectedType: 'street_museum',
              required: true,
              evidenceKeys: ['ev-2'],
            },
          ],
          suggestedDurationMinutes: 90,
          shortReason: 'A venue-centric cultural experience',
          evidenceKeys: ['ev-2'],
        },
      ],
    });

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        requestedExperienceFormats: ['experiences'],
        targetKind: 'EXPERIENCE' as any,
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 4,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(1);
    expect(response.proposals[0].kind).toBe('EXPERIENCE');
    expect(response.validationErrors).toBeUndefined();
  });

  it('respects maxProposals, discarding extras beyond the cap', async () => {
    const proposal = (i: number) => ({
      name: `Place ${i}`,
      kind: 'POI',
      themes: ['culture'],
      entityHints: [
        {
          key: `p${i}`,
          name: `Place ${i}`,
          role: 'venue',
          expectedType: 'museum',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      suggestedDurationMinutes: 60,
      shortReason: 'A place',
      evidenceKeys: ['ev-1'],
    });
    mockInteractionOk({
      proposals: [proposal(1), proposal(2), proposal(3)],
    });

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 2,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(2);
  });

  it('returns no provider-specific transport fields on ActivityProposal', async () => {
    mockInteractionOk({
      proposals: [
        {
          name: 'Caminito',
          kind: 'POI',
          themes: ['photography'],
          entityHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              role: 'venue',
              expectedType: 'street_museum',
              required: true,
              evidenceKeys: ['ev-2'],
            },
          ],
          suggestedDurationMinutes: 60,
          shortReason: 'Colorful pedestrian street',
          evidenceKeys: ['ev-2'],
        },
      ],
    });

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['photography'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(Object.keys(response.proposals[0]).sort()).toEqual(
      [
        'name',
        'kind',
        'themes',
        'entityHints',
        'suggestedDurationMinutes',
        'shortReason',
        'evidenceKeys',
      ].sort(),
    );
  });

  it('retries once on a timeout, then succeeds', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'completed',
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'text', text: JSON.stringify({ proposals: [] }) },
              ],
            },
          ],
        }),
      } as any);

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(response.validationErrors).toBeUndefined();
  });

  it('fails cleanly (not hanging) after a second consecutive timeout', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(response.proposals).toEqual([]);
    expect(response.validationErrors![0]).toContain(
      'Gemini discovery call failed',
    );
  });

  it('reports failed when Gemini returns a non-200 response', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"bad request"}}',
    } as any);

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toEqual([]);
    expect(response.validationErrors![0]).toContain(
      'Gemini discovery call failed',
    );
  });
});