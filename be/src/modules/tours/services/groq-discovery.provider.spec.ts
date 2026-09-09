import { Test, TestingModule } from '@nestjs/testing';
import { LangChainService } from '@shared/ai/langchain.service';
import aiConfig from '@shared/ai/ai.config';
import {
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';
import { GroqDiscoveryProvider } from './groq-discovery.provider';

const CANONICAL_THEMES =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME];
const CANONICAL_INTENTS =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT];

describe('GroqDiscoveryProvider — controlled facet contract', () => {
  let provider: GroqDiscoveryProvider;
  let generateChatResponse: jest.Mock;

  beforeEach(async () => {
    generateChatResponse = jest.fn().mockResolvedValue('{"candidates":[]}');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroqDiscoveryProvider,
        { provide: LangChainService, useValue: { generateChatResponse } },
        {
          provide: aiConfig.KEY,
          useValue: {
            discoveryExtractor: { groq: { model: 'groq-test' } },
          },
        },
      ],
    }).compile();
    provider = module.get(GroqDiscoveryProvider);
  });

  async function capturePrompt(): Promise<string> {
    await provider.extractExperiences(
      {
        scope: { destinationName: 'Buenos Aires' },
        requestedThemes: ['history'],
        breadth: 'focused',
        maxCandidates: 8,
      } as any,
      {
        evidence: [
          { key: 'ev-1', title: 'T', source: 'S', snippet: 'snippet' },
        ],
      } as any,
    );
    return generateChatResponse.mock.calls[0][1] as string;
  }

  it('carries the canonical theme and intent vocabularies, derived centrally, into the prompt', async () => {
    const prompt = await capturePrompt();
    expect(prompt).toContain(CANONICAL_THEMES.join(', '));
    expect(prompt).toContain(CANONICAL_INTENTS.join(', '));
  });

  it('tells the model traits is the open-ended dimension for long-tail concepts', async () => {
    const prompt = await capturePrompt();
    expect(prompt).toMatch(/traits is the open-ended dimension/i);
    expect(prompt).toMatch(/craft beer/i);
    expect(prompt).toMatch(
      /never put a canonical theme or canonical intent inside traits/i,
    );
  });

  it('keeps traits strictly separate but allows the same key in both themes and intents', async () => {
    const prompt = await capturePrompt();
    expect(prompt).not.toMatch(/same concept in more than one/i);
    expect(prompt).toMatch(
      /themes and intents are separate, independent controlled dimensions/i,
    );
    expect(prompt).toMatch(
      /same canonical key MAY appear in both themes and intents/i,
    );
    expect(prompt).toMatch(/do not deduplicate across themes and intents/i);
  });
});
