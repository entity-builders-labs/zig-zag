import { Test, TestingModule } from '@nestjs/testing';
import { LangChainService } from '@shared/ai/langchain.service';
import { GroqDiscoveryProvider } from './groq-discovery.provider';

describe('GroqDiscoveryProvider', () => {
  let provider: GroqDiscoveryProvider;
  let langChainService: any;

  beforeEach(async () => {
    langChainService = {
      generateChatResponse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroqDiscoveryProvider,
        { provide: LangChainService, useValue: langChainService },
      ],
    }).compile();

    provider = module.get(GroqDiscoveryProvider);
  });

  it('parses a valid Groq response into ActivityProposal objects', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'Reserva Ecológica Costanera Sur',
            kind: 'AREA',
            themes: ['nature', 'outdoor'],
            entityHints: [
              {
                key: 'reserva-costanera',
                name: 'Costanera Sur',
                role: 'area',
                expectedType: 'nature_reserve',
              },
            ],
            suggestedDurationMinutes: 180,
            shortReason:
              'Large urban wetland with walking trails and birdwatching',
            groundingEvidence: [
              {
                source: 'Buenos Aires Government',
                snippet: '7 km of trails along the Río de la Plata',
                url: 'https://buenosaires.gob.ar/reserva',
              },
            ],
          },
          {
            name: 'Milonga Parakultural',
            kind: 'EXPERIENCE',
            themes: ['tango', 'culture'],
            entityHints: [
              {
                key: 'milonga-parakultural',
                name: 'Milonga Parakultural',
                role: 'venue',
                expectedType: 'dance_venue',
              },
            ],
            suggestedDurationMinutes: 120,
            shortReason: 'Authentic milonga in Palermo',
            groundingEvidence: [
              {
                source: 'Website',
                snippet: 'Historic tango venue in Palermo',
                url: 'https://milongaparakultural.com',
              },
            ],
          },
        ],
      }),
    );

    const response = await provider.discover({
      destinationName: 'Buenos Aires',
      destinationCountry: 'Argentina',
      requestedThemes: ['nature', 'tango'],
      mode: { type: 'gap_fill', deficits: [] },
      maxProposals: 8,
    });

    expect(response.proposals).toHaveLength(2);
    expect(response.provider).toBe('groq');
    expect(response.validationErrors).toBeUndefined();

    expect(response.proposals[0]).toMatchObject({
      name: 'Reserva Ecológica Costanera Sur',
      kind: 'AREA',
      themes: ['nature', 'outdoor'],
      suggestedDurationMinutes: 180,
    });
    expect(response.proposals[0].entityHints).toHaveLength(1);
    expect(response.proposals[0].groundingEvidence).toHaveLength(1);

    expect(response.proposals[1]).toMatchObject({
      name: 'Milonga Parakultural',
      kind: 'EXPERIENCE',
    });
  });

  it('rejects invalid proposals and returns validation errors', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        proposals: [
          {
            name: 'Valid Place',
            kind: 'POI',
            themes: ['history'],
            entityHints: [
              { key: 'x', name: 'X', role: 'venue', expectedType: 'museum' },
            ],
            suggestedDurationMinutes: 60,
            shortReason: 'A valid place',
            groundingEvidence: [{ source: 'Web', snippet: 'It exists' }],
          },
          {
            name: '',
            kind: 'INVALID',
            themes: [],
            entityHints: [],
            suggestedDurationMinutes: -1,
            shortReason: '',
            groundingEvidence: [],
          },
          { name: null, kind: null },
        ],
      }),
    );

    const response = await provider.discover({
      destinationName: 'Test',
      requestedThemes: ['history'],
      mode: { type: 'gap_fill', deficits: [] },
      maxProposals: 8,
    });

    expect(response.proposals).toHaveLength(1);
    expect(response.proposals[0].name).toBe('Valid Place');
    expect(response.validationErrors).toBeDefined();
    expect(response.validationErrors!.length).toBeGreaterThanOrEqual(1);
  });

  it('handles non-JSON responses gracefully', async () => {
    langChainService.generateChatResponse.mockResolvedValue('Not JSON at all');

    const response = await provider.discover({
      destinationName: 'Test',
      requestedThemes: ['history'],
      mode: { type: 'gap_fill', deficits: [] },
      maxProposals: 8,
    });

    expect(response.proposals).toHaveLength(0);
    expect(response.validationErrors).toContain(
      'Failed to parse JSON response',
    );
  });

  it('builds a bootstrap request correctly', async () => {
    langChainService.generateChatResponse.mockResolvedValue(
      JSON.stringify({ proposals: [] }),
    );

    const response = await provider.discover({
      destinationName: 'Salta',
      destinationCountry: 'Argentina',
      requestedThemes: ['history', 'nature', 'food'],
      mode: { type: 'bootstrap', reason: 'new_destination' },
      maxProposals: 8,
    });

    expect(response.provider).toBe('groq');
    expect(response.proposals).toEqual([]);
  });
});
