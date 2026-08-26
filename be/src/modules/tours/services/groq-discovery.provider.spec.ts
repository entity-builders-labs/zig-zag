import { Test, TestingModule } from '@nestjs/testing';
import { LangChainService } from '@shared/ai/langchain.service';
import { GroqDiscoveryProvider } from './groq-discovery.provider';
import { GroundedSearchResult } from '../interfaces/activity-discovery.interface';

describe('GroqDiscoveryProvider', () => {
  let provider: GroqDiscoveryProvider;
  let langChainService: any;

  const searchResult: GroundedSearchResult = {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
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

  beforeEach(async () => {
    langChainService = { generateChatResponse: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroqDiscoveryProvider,
        { provide: LangChainService, useValue: langChainService },
      ],
    }).compile();
    provider = module.get(GroqDiscoveryProvider);
  });

  it('parses valid proposals referencing provider-owned evidence keys', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'San Telmo',
            kind: 'AREA',
            themes: ['culture'],
            entityHints: [
              {
                key: 'san-telmo',
                name: 'San Telmo',
                role: 'area',
                expectedType: 'neighborhood',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
            suggestedDurationMinutes: 120,
            shortReason: 'Historic neighborhood with Sunday market',
            evidenceKeys: ['ev-1'],
          },
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
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        destinationCountry: 'Argentina',
        requestedThemes: ['culture', 'photography'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(2);
    expect(response.proposals[0].evidenceKeys).toEqual(['ev-1']);
    expect(response.proposals[0].entityHints[0].required).toBe(true);
    expect(response.groundingStatus).toBe('applied');
    expect(response.groundingEvidence).toHaveLength(2);
  });

  it('rejects proposals referencing unknown evidence keys', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
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
              },
            ],
            suggestedDurationMinutes: 60,
            shortReason: 'Made up',
            evidenceKeys: ['ev-999'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('unknown evidence key');
  });

  it('rejects proposals with no evidenceKeys', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'No Evidence',
            kind: 'POI',
            themes: ['culture'],
            entityHints: [
              {
                key: 'x',
                name: 'X',
                role: 'venue',
                expectedType: 'museum',
                required: true,
              },
            ],
            suggestedDurationMinutes: 60,
            shortReason: 'No evidence cited',
            evidenceKeys: [],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Test',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('missing evidenceKeys');
  });

  it('rejects hints missing required boolean', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'Bad Hint',
            kind: 'POI',
            themes: ['culture'],
            entityHints: [
              { key: 'x', name: 'X', role: 'venue', expectedType: 'museum' },
            ],
            suggestedDurationMinutes: 60,
            shortReason: 'No required flag',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Test',
        requestedThemes: ['culture'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('missing required');
  });

  it('enforces NEIGHBORHOOD_WALK has a required area hint', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'Bad Walk',
            kind: 'NEIGHBORHOOD_WALK',
            themes: ['history'],
            entityHints: [
              {
                key: 'p1',
                name: 'POI 1',
                role: 'waypoint',
                expectedType: 'museum',
                required: false,
              },
              {
                key: 'p2',
                name: 'POI 2',
                role: 'waypoint',
                expectedType: 'church',
                required: false,
              },
            ],
            suggestedDurationMinutes: 120,
            shortReason: 'No area hint',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Test',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('required area hint');
  });

  it('enforces ROUTE has a required route hint', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'Bad Route',
            kind: 'ROUTE',
            themes: ['outdoor'],
            entityHints: [
              {
                key: 'a',
                name: 'Area',
                role: 'area',
                expectedType: 'neighborhood',
                required: true,
              },
            ],
            suggestedDurationMinutes: 60,
            shortReason: 'No route hint',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Test',
        requestedThemes: ['outdoor'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('required route hint');
  });

  it('handles non-JSON responses gracefully', async () => {
    langChainService.generateChatResponse.mockResolvedValue('Not JSON at all');

    const response = await provider.discover(
      {
        destinationName: 'Test',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors).toContain(
      'Failed to parse JSON response',
    );
    expect(response.groundingStatus).toBe('applied');
  });

  it('accepts a NEIGHBORHOOD_WALK with more than 5 additional hints', async () => {
    const additionalHints = Array.from({ length: 6 }, (_, i) => ({
      key: `wp-${i}`,
      name: `Stop ${i}`,
      role: 'waypoint',
      expectedType: 'landmark',
      required: false,
      evidenceKeys: ['ev-2'],
    }));

    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'San Telmo Walk',
            kind: 'NEIGHBORHOOD_WALK',
            themes: ['history'],
            entityHints: [
              {
                key: 'area-1',
                name: 'San Telmo',
                role: 'area',
                expectedType: 'neighborhood',
                required: true,
                evidenceKeys: ['ev-1'],
              },
              ...additionalHints,
            ],
            suggestedDurationMinutes: 150,
            shortReason: 'A long, representative walk',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(1);
    expect(response.proposals[0].entityHints).toHaveLength(7);
  });

  it('rejects a proposal exceeding the technical hint cap', async () => {
    const tooManyHints = Array.from({ length: 9 }, (_, i) => ({
      key: `wp-${i}`,
      name: `Stop ${i}`,
      role: 'waypoint',
      expectedType: 'landmark',
      required: false,
      evidenceKeys: ['ev-2'],
    }));

    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'Overloaded Walk',
            kind: 'NEIGHBORHOOD_WALK',
            themes: ['history'],
            entityHints: [
              {
                key: 'area-1',
                name: 'San Telmo',
                role: 'area',
                expectedType: 'neighborhood',
                required: true,
                evidenceKeys: ['ev-1'],
              },
              ...tooManyHints,
            ],
            suggestedDurationMinutes: 150,
            shortReason: 'Too many stops',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('too many entity hints');
  });

  it('rejects a required entity hint with no evidenceKeys', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
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
                evidenceKeys: [],
              },
            ],
            suggestedDurationMinutes: 60,
            shortReason: 'Colorful pedestrian street',
            evidenceKeys: ['ev-2'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['photography'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('missing evidenceKeys');
  });

  it('rejects a required entity hint with an unknown evidence key', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
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
                evidenceKeys: ['ev-999'],
              },
            ],
            suggestedDurationMinutes: 60,
            shortReason: 'Colorful pedestrian street',
            evidenceKeys: ['ev-2'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['photography'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors![0]).toContain('unknown evidence key');
  });

  it('accepts a required entity hint with valid evidenceKeys', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
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
      }),
    );

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
    expect(response.proposals[0].entityHints[0].evidenceKeys).toEqual(['ev-2']);
  });

  it('accepts an optional entity hint with no evidenceKeys', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'San Telmo Walk',
            kind: 'NEIGHBORHOOD_WALK',
            themes: ['history'],
            entityHints: [
              {
                key: 'area-1',
                name: 'San Telmo',
                role: 'area',
                expectedType: 'neighborhood',
                required: true,
                evidenceKeys: ['ev-1'],
              },
              {
                key: 'wp-1',
                name: 'Plaza Dorrego',
                role: 'waypoint',
                expectedType: 'square',
                required: false,
                evidenceKeys: [],
              },
              {
                key: 'wp-2',
                name: 'Some Church',
                role: 'waypoint',
                expectedType: 'church',
                required: false,
              },
            ],
            suggestedDurationMinutes: 120,
            shortReason: 'A walk with an optional unsupported stop',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(1);
    expect(response.proposals[0].entityHints).toHaveLength(3);
  });

  it('lets a waypoint hint inside a NEIGHBORHOOD_WALK carry its own evidence', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'San Telmo Walk',
            kind: 'NEIGHBORHOOD_WALK',
            themes: ['history'],
            entityHints: [
              {
                key: 'area-1',
                name: 'San Telmo',
                role: 'area',
                expectedType: 'neighborhood',
                required: true,
                evidenceKeys: ['ev-1'],
              },
              {
                key: 'plaza-dorrego',
                name: 'Plaza Dorrego',
                role: 'waypoint',
                expectedType: 'square',
                required: true,
                evidenceKeys: ['ev-2'],
              },
              {
                key: 'wp-2',
                name: 'Some Church',
                role: 'waypoint',
                expectedType: 'church',
                required: false,
                evidenceKeys: [],
              },
              {
                key: 'wp-3',
                name: 'Some Market',
                role: 'waypoint',
                expectedType: 'market',
                required: false,
                evidenceKeys: [],
              },
            ],
            suggestedDurationMinutes: 120,
            shortReason: 'A coherent walk',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(1);
    const plaza = response.proposals[0].entityHints.find(
      (h) => h.key === 'plaza-dorrego',
    );
    expect(plaza?.evidenceKeys).toEqual(['ev-2']);
  });

  it('lets a route hint inside a NEIGHBORHOOD_WALK carry its own evidence', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'San Telmo Walk',
            kind: 'NEIGHBORHOOD_WALK',
            themes: ['history'],
            entityHints: [
              {
                key: 'area-1',
                name: 'San Telmo',
                role: 'area',
                expectedType: 'neighborhood',
                required: true,
                evidenceKeys: ['ev-1'],
              },
              {
                key: 'defensa',
                name: 'Defensa',
                role: 'route',
                expectedType: 'street',
                required: true,
                evidenceKeys: ['ev-2'],
              },
              {
                key: 'wp-2',
                name: 'Some Church',
                role: 'waypoint',
                expectedType: 'church',
                required: false,
                evidenceKeys: [],
              },
              {
                key: 'wp-3',
                name: 'Some Market',
                role: 'waypoint',
                expectedType: 'market',
                required: false,
                evidenceKeys: [],
              },
            ],
            suggestedDurationMinutes: 120,
            shortReason: 'A coherent walk',
            evidenceKeys: ['ev-1'],
          },
        ],
      }),
    );

    const response = await provider.discover(
      {
        destinationName: 'Buenos Aires',
        requestedThemes: ['history'],
        mode: { type: 'gap_fill', deficits: [] },
        maxProposals: 8,
      },
      searchResult,
    );

    expect(response.proposals).toHaveLength(1);
    const street = response.proposals[0].entityHints.find(
      (h) => h.key === 'defensa',
    );
    expect(street?.evidenceKeys).toEqual(['ev-2']);
  });

  it('reports unavailable when no search result is provided', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({ proposals: [] }),
    );

    const response = await provider.discover({
      destinationName: 'Salta',
      destinationCountry: 'Argentina',
      requestedThemes: ['history'],
      mode: { type: 'bootstrap', reason: 'new_destination' },
      maxProposals: 8,
    });

    expect(response.groundingStatus).toBe('unavailable');
    expect(response.proposals).toEqual([]);
  });
});
